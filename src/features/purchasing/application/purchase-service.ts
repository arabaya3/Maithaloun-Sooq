import "server-only";

import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { assertSafeAuditState } from "@/features/admin/domain/audit";
import { assertPermission, can } from "@/features/admin/domain/permissions";
import { variantDomainIdSchema } from "@/features/catalog/domain/product-variant";
import {
  applyMovementToItem,
  ensureInventoryItem,
  getDefaultLocationId,
  postStockIn,
  type Database,
  type InventoryItemRow,
} from "@/features/inventory/application/stock-ledger";
import {
  compareCostToSalePrice,
  type CostComparison,
} from "@/features/inventory/domain/pricing";
import { MAX_QUANTITY_MILLI } from "@/features/inventory/domain/quantity";
import {
  stockUnits,
  type StockUnit,
} from "@/features/inventory/domain/stock-constants";
import {
  PurchaseCalculationError,
  calculatePurchase,
  printedTotalDifference,
  resolvePaymentStatus,
  type PurchaseTotals,
} from "@/features/purchasing/domain/purchase-calculation";
import {
  purchaseSources,
  type PurchasePaymentStatus,
  type PurchaseSource,
} from "@/features/purchasing/domain/purchase-constants";
import {
  normalizeArabicText,
  normalizeReference,
} from "@/shared/lib/normalize-arabic";
import { todayInStoreZone } from "@/shared/lib/store-time";
import * as schema from "@/server/db/schema";

export type PurchaseErrorCode =
  | "invalid_input"
  | "supplier_not_found"
  | "variant_not_found"
  | "duplicate_invoice"
  | "possible_duplicate"
  | "line_discount_exceeds_line"
  | "discount_exceeds_subtotal"
  | "paid_exceeds_total"
  | "future_date";

export class PurchaseError extends Error {
  constructor(
    readonly code: PurchaseErrorCode,
    readonly detail?: string,
  ) {
    super(code);
    this.name = "PurchaseError";
  }
}

const MAX_AGOROT = 10_000_000;
const amount = z.number().int().min(0).max(MAX_AGOROT);

export const purchaseLineSchema = z
  .object({
    variantId: variantDomainIdSchema,
    unit: z.enum(stockUnits),
    quantityMilli: z.number().int().min(1).max(MAX_QUANTITY_MILLI),
    packQuantity: z.number().int().min(1).max(10_000),
    unitCostAgorot: amount,
    lineDiscountAgorot: amount,
    sourceText: z.string().trim().max(280).optional(),
  })
  .strict();

export const purchaseInputSchema = z
  .object({
    idempotencyKey: z.uuid(),
    supplierId: z.uuid().optional(),
    supplierName: z.string().trim().min(2).max(120).optional(),
    reference: z.string().trim().max(60).optional(),
    invoiceDate: z.iso.date(),
    source: z.enum(purchaseSources),
    lines: z.array(purchaseLineSchema).min(1).max(200),
    discountAgorot: amount,
    taxAgorot: amount.nullable(),
    printedTotalAgorot: z.number().int().min(0).max(1_000_000_000).nullable(),
    paidAgorot: z.number().int().min(0).max(1_000_000_000),
    notes: z.string().trim().max(500).optional(),
    documentId: z.uuid().optional(),
    extractionJobId: z.uuid().optional(),
    acknowledgeDuplicate: z.boolean(),
  })
  .strict()
  .refine((value) => Boolean(value.supplierId) !== Boolean(value.supplierName));
export type PurchaseInput = z.infer<typeof purchaseInputSchema>;

export interface PurchaseLineImpact {
  variantId: string;
  name: string;
  tracked: boolean;
  stockUnit: StockUnit;
  stockQuantityMilli: number;
  onHandBeforeMilli: number;
  onHandAfterMilli: number;
  lineTotalAgorot: number;
  comparison: CostComparison | null;
}

export interface PurchasePreview {
  totals: Omit<PurchaseTotals, "lines">;
  paymentStatus: PurchasePaymentStatus;
  printedDifferenceAgorot: number | null;
  duplicate: "none" | "exact" | "possible";
  lines: PurchaseLineImpact[];
  supplierBalance: { beforeAgorot: number; afterAgorot: number } | null;
}

export interface PurchasePostResult {
  invoiceId: string;
  totalAgorot: number;
  replayed: boolean;
  lines: PurchaseLineImpact[];
}

export interface PurchaseListItem {
  id: string;
  supplierName: string;
  reference: string | null;
  invoiceDate: string;
  source: PurchaseSource;
  lineCount: number;
  totalAgorot: number | null;
  paymentStatus: PurchasePaymentStatus;
  createdAt: string;
}

interface ResolvedVariant {
  id: string;
  domainId: string;
  name: string;
  labelAr: string;
  sku: string | null;
  barcode: string | null;
  priceAgorot: number;
}

function calculate(data: PurchaseInput): {
  totals: PurchaseTotals;
  paymentStatus: PurchasePaymentStatus;
} {
  if (data.invoiceDate > todayInStoreZone()) {
    throw new PurchaseError("future_date");
  }
  try {
    const totals = calculatePurchase({
      lines: data.lines,
      discountAgorot: data.discountAgorot,
      taxAgorot: data.taxAgorot,
    });
    return {
      totals,
      paymentStatus: resolvePaymentStatus(totals.totalAgorot, data.paidAgorot),
    };
  } catch (error) {
    if (error instanceof PurchaseCalculationError) {
      throw new PurchaseError(
        error.code,
        error.lineIndex === undefined ? undefined : String(error.lineIndex + 1),
      );
    }
    throw error;
  }
}

export class PurchaseService {
  constructor(private readonly database: Database) {}

  async preview(
    actor: AdminActor,
    input: PurchaseInput,
  ): Promise<PurchasePreview> {
    this.authorize(actor, input.source);
    const data = this.parse(input);
    const { totals, paymentStatus } = calculate(data);
    const variants = await this.resolveVariants(this.database, data);
    const locationId = await getDefaultLocationId(this.database);
    const items = await this.database
      .select()
      .from(schema.inventoryItems)
      .where(
        and(
          inArray(
            schema.inventoryItems.variantId,
            [...variants.values()].map((variant) => variant.id),
          ),
          eq(schema.inventoryItems.locationId, locationId),
        ),
      );
    const itemsByVariant = new Map(items.map((item) => [item.variantId, item]));
    const showCosts = can(actor, "stock.costs");

    const running = new Map<string, { onHand: number; cost: number | null }>();
    const lines = data.lines.map((line, index): PurchaseLineImpact => {
      const variant = variants.get(line.variantId)!;
      const item = itemsByVariant.get(variant.id);
      const state = running.get(variant.id) ?? {
        onHand: item?.onHandMilli ?? 0,
        cost: item?.avgCostAgorot ?? item?.lastPurchaseCostAgorot ?? null,
      };
      const lineTotals = totals.lines[index]!;
      const after = state.onHand + lineTotals.stockQuantityMilli;
      running.set(variant.id, {
        onHand: after,
        cost: lineTotals.stockUnitCostAgorot,
      });
      return {
        variantId: variant.domainId,
        name: variant.name,
        tracked: Boolean(item),
        stockUnit: item?.unit ?? (line.packQuantity > 1 ? "piece" : line.unit),
        stockQuantityMilli: lineTotals.stockQuantityMilli,
        onHandBeforeMilli: state.onHand,
        onHandAfterMilli: after,
        lineTotalAgorot: lineTotals.lineTotalAgorot,
        comparison: showCosts
          ? compareCostToSalePrice({
              previousCostAgorot: state.cost,
              newCostAgorot: lineTotals.stockUnitCostAgorot,
              salePriceAgorot: variant.priceAgorot,
            })
          : null,
      };
    });

    let duplicate: PurchasePreview["duplicate"] = "none";
    let supplierBalance: PurchasePreview["supplierBalance"] = null;
    if (data.supplierId) {
      duplicate = await this.findDuplicate(
        this.database,
        data.supplierId,
        data,
        totals.totalAgorot,
      );
      if (can(actor, "suppliers.balances")) {
        const beforeAgorot = await this.supplierBalance(
          this.database,
          data.supplierId,
        );
        supplierBalance = {
          beforeAgorot,
          afterAgorot: beforeAgorot + totals.totalAgorot - data.paidAgorot,
        };
      }
    } else if (can(actor, "suppliers.balances")) {
      supplierBalance = {
        beforeAgorot: 0,
        afterAgorot: totals.totalAgorot - data.paidAgorot,
      };
    }

    return {
      totals: {
        subtotalAgorot: totals.subtotalAgorot,
        discountAgorot: totals.discountAgorot,
        taxAgorot: totals.taxAgorot,
        totalAgorot: totals.totalAgorot,
      },
      paymentStatus,
      printedDifferenceAgorot: printedTotalDifference(
        totals.totalAgorot,
        data.printedTotalAgorot,
      ),
      duplicate,
      lines,
      supplierBalance,
    };
  }

  async post(
    actor: AdminActor,
    input: PurchaseInput,
  ): Promise<PurchasePostResult> {
    this.authorize(actor, input.source);
    const data = this.parse(input);
    return this.database.transaction((transaction) =>
      this.postInTransaction(transaction, actor, data),
    );
  }

  // Shared with extraction confirmation so review state and posting commit together.
  async postInTransaction(
    transaction: Database,
    actor: AdminActor,
    data: PurchaseInput,
  ): Promise<PurchasePostResult> {
    this.authorize(actor, data.source);
    const { totals, paymentStatus } = calculate(data);

    const [replay] = await transaction
      .select({
        id: schema.purchaseInvoices.id,
        totalAgorot: schema.purchaseInvoices.totalAgorot,
      })
      .from(schema.purchaseInvoices)
      .where(eq(schema.purchaseInvoices.idempotencyKey, data.idempotencyKey))
      .limit(1);
    if (replay) {
      return {
        invoiceId: replay.id,
        totalAgorot: replay.totalAgorot,
        replayed: true,
        lines: [],
      };
    }

    const supplierId = await this.resolveSupplier(transaction, data);
    const duplicate = await this.findDuplicate(
      transaction,
      supplierId,
      data,
      totals.totalAgorot,
    );
    if (duplicate === "exact") throw new PurchaseError("duplicate_invoice");
    if (duplicate === "possible" && !data.acknowledgeDuplicate) {
      throw new PurchaseError("possible_duplicate");
    }

    const variants = await this.resolveVariants(transaction, data);
    const now = new Date();
    const reference = data.reference || null;
    const [invoice] = await transaction
      .insert(schema.purchaseInvoices)
      .values({
        supplierId,
        reference,
        normalizedReference: reference ? normalizeReference(reference) : null,
        invoiceDate: data.invoiceDate,
        source: data.source,
        subtotalAgorot: totals.subtotalAgorot,
        discountAgorot: totals.discountAgorot,
        taxAgorot: totals.taxAgorot,
        totalAgorot: totals.totalAgorot,
        printedTotalAgorot: data.printedTotalAgorot,
        paymentStatus,
        paidAgorot: data.paidAgorot,
        notes: data.notes || null,
        documentId: data.documentId ?? null,
        extractionJobId: data.extractionJobId ?? null,
        idempotencyKey: data.idempotencyKey,
        createdBy: actor.id,
        createdAt: now,
      })
      .returning({ id: schema.purchaseInvoices.id });
    if (!invoice) throw new PurchaseError("invalid_input");

    const locationId = await getDefaultLocationId(transaction);
    const lockedItems = new Map<string, InventoryItemRow>();
    // Lock inventory rows in a stable order before posting any movement.
    const variantIds = [...new Set(data.lines.map((line) => line.variantId))]
      .map((domainId) => variants.get(domainId)!)
      .sort((a, b) => a.id.localeCompare(b.id));
    for (const variant of variantIds) {
      const firstLine = data.lines.find(
        (line) => line.variantId === variant.domainId,
      )!;
      lockedItems.set(
        variant.id,
        await ensureInventoryItem(
          transaction,
          variant.id,
          locationId,
          firstLine.packQuantity > 1 ? "piece" : firstLine.unit,
        ),
      );
    }

    const impacts: PurchaseLineImpact[] = [];
    for (const [index, line] of data.lines.entries()) {
      const variant = variants.get(line.variantId)!;
      const lineTotals = totals.lines[index]!;
      const item = lockedItems.get(variant.id)!;
      const [row] = await transaction
        .insert(schema.purchaseInvoiceItems)
        .values({
          invoiceId: invoice.id,
          lineNo: index + 1,
          variantId: variant.id,
          productNameSnapshot: variant.name,
          variantLabelSnapshot: variant.labelAr,
          skuSnapshot: variant.sku,
          barcodeSnapshot: variant.barcode,
          sourceText: line.sourceText || null,
          unit: line.unit,
          quantityMilli: line.quantityMilli,
          packQuantity: line.packQuantity,
          stockQuantityMilli: lineTotals.stockQuantityMilli,
          unitCostAgorot: line.unitCostAgorot,
          lineDiscountAgorot: line.lineDiscountAgorot,
          lineTotalAgorot: lineTotals.lineTotalAgorot,
          stockUnitCostAgorot: lineTotals.stockUnitCostAgorot,
        })
        .returning({ id: schema.purchaseInvoiceItems.id });
      if (!row) throw new PurchaseError("invalid_input");

      const movement = await postStockIn(transaction, {
        item,
        reason: "purchase_receipt",
        quantityMilli: lineTotals.stockQuantityMilli,
        costAgorot: lineTotals.costAgorot,
        references: { purchaseInvoiceItemId: row.id },
        idempotencyKey: `purchase-item:${row.id}`,
        actorId: actor.id,
        at: now,
      });
      lockedItems.set(variant.id, applyMovementToItem(item, movement));

      const previousCostAgorot =
        item.avgCostAgorot ?? item.lastPurchaseCostAgorot ?? null;
      const comparison = compareCostToSalePrice({
        previousCostAgorot,
        newCostAgorot: lineTotals.stockUnitCostAgorot,
        salePriceAgorot: variant.priceAgorot,
      });
      const costChanged =
        previousCostAgorot !== null &&
        previousCostAgorot !== lineTotals.stockUnitCostAgorot;
      if (costChanged || comparison.advice !== "ok") {
        await transaction.insert(schema.priceReviews).values({
          variantId: variant.id,
          purchaseInvoiceItemId: row.id,
          previousCostAgorot,
          newCostAgorot: lineTotals.stockUnitCostAgorot,
          salePriceAgorot: variant.priceAgorot,
          createdAt: now,
        });
      }

      impacts.push({
        variantId: variant.domainId,
        name: variant.name,
        tracked: true,
        stockUnit: item.unit,
        stockQuantityMilli: lineTotals.stockQuantityMilli,
        onHandBeforeMilli: item.onHandMilli,
        onHandAfterMilli: movement.onHandAfterMilli,
        lineTotalAgorot: lineTotals.lineTotalAgorot,
        comparison: can(actor, "stock.costs") ? comparison : null,
      });
    }

    if (totals.totalAgorot > 0) {
      await transaction.insert(schema.supplierLedgerEntries).values({
        supplierId,
        type: "purchase",
        amountAgorot: totals.totalAgorot,
        purchaseInvoiceId: invoice.id,
        idempotencyKey: `purchase:${invoice.id}`,
        createdBy: actor.id,
        createdAt: now,
      });
    }
    if (data.paidAgorot > 0) {
      await transaction.insert(schema.supplierLedgerEntries).values({
        supplierId,
        type: "payment",
        amountAgorot: -data.paidAgorot,
        purchaseInvoiceId: invoice.id,
        idempotencyKey: `purchase:${invoice.id}:payment`,
        createdBy: actor.id,
        createdAt: now,
      });
    }

    const afterState = {
      source: data.source,
      lineCount: data.lines.length,
      totalAgorot: totals.totalAgorot,
      paymentStatus,
    };
    assertSafeAuditState(afterState);
    await transaction.insert(schema.adminAuditEvents).values({
      adminUserId: actor.id,
      actionType: "purchase_post",
      entityType: "purchase_invoice",
      entityId: invoice.id,
      beforeState: null,
      afterState,
      createdAt: now,
    });

    return {
      invoiceId: invoice.id,
      totalAgorot: totals.totalAgorot,
      replayed: false,
      lines: impacts,
    };
  }

  async list(actor: AdminActor, limit = 20): Promise<PurchaseListItem[]> {
    assertPermission(actor, "purchase.record");
    const showCosts = can(actor, "stock.costs");
    const rows = await this.database
      .select({
        id: schema.purchaseInvoices.id,
        supplierName: schema.suppliers.nameAr,
        reference: schema.purchaseInvoices.reference,
        invoiceDate: schema.purchaseInvoices.invoiceDate,
        source: schema.purchaseInvoices.source,
        totalAgorot: schema.purchaseInvoices.totalAgorot,
        paymentStatus: schema.purchaseInvoices.paymentStatus,
        createdAt: schema.purchaseInvoices.createdAt,
        lineCount: sql<number>`(
          select count(*)::int from ${schema.purchaseInvoiceItems}
          where ${schema.purchaseInvoiceItems.invoiceId} = "purchase_invoices"."id"
        )`,
      })
      .from(schema.purchaseInvoices)
      .innerJoin(
        schema.suppliers,
        eq(schema.suppliers.id, schema.purchaseInvoices.supplierId),
      )
      .orderBy(desc(schema.purchaseInvoices.createdAt))
      .limit(Math.min(Math.max(limit, 1), 100));
    return rows.map((row) => ({
      ...row,
      totalAgorot: showCosts ? row.totalAgorot : null,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async getDetail(actor: AdminActor, invoiceId: string) {
    assertPermission(actor, "purchase.record");
    if (!z.uuid().safeParse(invoiceId).success) return null;
    const [invoice] = await this.database
      .select({
        invoice: schema.purchaseInvoices,
        supplierName: schema.suppliers.nameAr,
        createdByName: schema.adminUsers.displayName,
      })
      .from(schema.purchaseInvoices)
      .innerJoin(
        schema.suppliers,
        eq(schema.suppliers.id, schema.purchaseInvoices.supplierId),
      )
      .innerJoin(
        schema.adminUsers,
        eq(schema.adminUsers.id, schema.purchaseInvoices.createdBy),
      )
      .where(eq(schema.purchaseInvoices.id, invoiceId))
      .limit(1);
    if (!invoice) return null;
    // Operators see amounts only on documents they recorded themselves.
    const showCosts =
      can(actor, "stock.costs") || invoice.invoice.createdBy === actor.id;
    const lines = await this.database
      .select()
      .from(schema.purchaseInvoiceItems)
      .where(eq(schema.purchaseInvoiceItems.invoiceId, invoiceId))
      .orderBy(schema.purchaseInvoiceItems.lineNo);
    return {
      id: invoice.invoice.id,
      supplierId: invoice.invoice.supplierId,
      supplierName: invoice.supplierName,
      createdByName: invoice.createdByName,
      reference: invoice.invoice.reference,
      invoiceDate: invoice.invoice.invoiceDate,
      source: invoice.invoice.source,
      paymentStatus: invoice.invoice.paymentStatus,
      notes: invoice.invoice.notes,
      documentId: invoice.invoice.documentId,
      createdAt: invoice.invoice.createdAt.toISOString(),
      showCosts,
      subtotalAgorot: showCosts ? invoice.invoice.subtotalAgorot : null,
      discountAgorot: showCosts ? invoice.invoice.discountAgorot : null,
      taxAgorot: showCosts ? invoice.invoice.taxAgorot : null,
      totalAgorot: showCosts ? invoice.invoice.totalAgorot : null,
      paidAgorot: showCosts ? invoice.invoice.paidAgorot : null,
      lines: lines.map((line) => ({
        lineNo: line.lineNo,
        name: line.productNameSnapshot,
        variantLabel: line.variantLabelSnapshot,
        unit: line.unit,
        quantityMilli: line.quantityMilli,
        packQuantity: line.packQuantity,
        stockQuantityMilli: line.stockQuantityMilli,
        unitCostAgorot: showCosts ? line.unitCostAgorot : null,
        lineTotalAgorot: showCosts ? line.lineTotalAgorot : null,
      })),
    };
  }

  private authorize(actor: AdminActor, source: PurchaseSource) {
    assertPermission(actor, "purchase.record");
    if (source === "excel") assertPermission(actor, "purchase.import");
  }

  private parse(input: PurchaseInput): PurchaseInput {
    const parsed = purchaseInputSchema.safeParse(input);
    if (!parsed.success) throw new PurchaseError("invalid_input");
    return parsed.data;
  }

  private async resolveSupplier(
    transaction: Database,
    data: PurchaseInput,
  ): Promise<string> {
    if (data.supplierId) {
      const [supplier] = await transaction
        .select({ id: schema.suppliers.id })
        .from(schema.suppliers)
        .where(eq(schema.suppliers.id, data.supplierId))
        .limit(1);
      if (!supplier) throw new PurchaseError("supplier_not_found");
      return supplier.id;
    }
    const nameAr = data.supplierName!;
    const normalizedName = normalizeArabicText(nameAr);
    if (normalizedName.length < 2) throw new PurchaseError("invalid_input");
    await transaction
      .insert(schema.suppliers)
      .values({ nameAr, normalizedName })
      .onConflictDoNothing({ target: schema.suppliers.normalizedName });
    const [supplier] = await transaction
      .select({ id: schema.suppliers.id })
      .from(schema.suppliers)
      .where(eq(schema.suppliers.normalizedName, normalizedName))
      .limit(1);
    if (!supplier) throw new PurchaseError("supplier_not_found");
    return supplier.id;
  }

  private async resolveVariants(
    database: Database,
    data: PurchaseInput,
  ): Promise<Map<string, ResolvedVariant>> {
    const domainIds = [...new Set(data.lines.map((line) => line.variantId))];
    const rows = await database
      .select({
        id: schema.productVariants.id,
        domainId: schema.productVariants.domainId,
        labelAr: schema.productVariants.labelAr,
        sku: schema.productVariants.sku,
        barcode: schema.productVariants.barcode,
        priceAgorot: schema.productVariants.priceAgorot,
        nameAr: schema.products.nameAr,
        latinName: schema.products.latinName,
      })
      .from(schema.productVariants)
      .innerJoin(
        schema.products,
        eq(schema.products.id, schema.productVariants.productId),
      )
      .where(inArray(schema.productVariants.domainId, domainIds));
    if (rows.length !== domainIds.length) {
      throw new PurchaseError("variant_not_found");
    }
    return new Map(
      rows.map((row) => [
        row.domainId,
        {
          id: row.id,
          domainId: row.domainId,
          name: row.latinName ? `${row.nameAr} ${row.latinName}` : row.nameAr,
          labelAr: row.labelAr,
          sku: row.sku,
          barcode: row.barcode,
          priceAgorot: row.priceAgorot,
        },
      ]),
    );
  }

  private async findDuplicate(
    database: Database,
    supplierId: string,
    data: PurchaseInput,
    totalAgorot: number,
  ): Promise<PurchasePreview["duplicate"]> {
    if (data.reference) {
      const [exact] = await database
        .select({ total: count() })
        .from(schema.purchaseInvoices)
        .where(
          and(
            eq(schema.purchaseInvoices.supplierId, supplierId),
            eq(
              schema.purchaseInvoices.normalizedReference,
              normalizeReference(data.reference),
            ),
          ),
        );
      return (exact?.total ?? 0) > 0 ? "exact" : "none";
    }
    const [similar] = await database
      .select({ total: count() })
      .from(schema.purchaseInvoices)
      .where(
        and(
          eq(schema.purchaseInvoices.supplierId, supplierId),
          isNull(schema.purchaseInvoices.normalizedReference),
          eq(schema.purchaseInvoices.invoiceDate, data.invoiceDate),
          eq(schema.purchaseInvoices.totalAgorot, totalAgorot),
        ),
      );
    return (similar?.total ?? 0) > 0 ? "possible" : "none";
  }

  private async supplierBalance(
    database: Database,
    supplierId: string,
  ): Promise<number> {
    const [row] = await database
      .select({
        balance: sql<number>`coalesce(sum(${schema.supplierLedgerEntries.amountAgorot}), 0)::int`,
      })
      .from(schema.supplierLedgerEntries)
      .where(eq(schema.supplierLedgerEntries.supplierId, supplierId));
    return row?.balance ?? 0;
  }
}
