import "server-only";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { assertSafeAuditState } from "@/features/admin/domain/audit";
import { assertPermission, can } from "@/features/admin/domain/permissions";
import { variantDomainIdSchema } from "@/features/catalog/domain/product-variant";
import {
  InventoryError,
  applyMovementToItem,
  getDefaultLocationId,
  lockInventoryItem,
  postStockIn,
  postStockOut,
  type Database,
  type InventoryItemRow,
} from "@/features/inventory/application/stock-ledger";
import { issueCostAgorot } from "@/features/inventory/domain/costing";
import { MAX_QUANTITY_MILLI } from "@/features/inventory/domain/quantity";
import type { StockUnit } from "@/features/inventory/domain/stock-constants";
import {
  saleSources,
  type SaleSource,
} from "@/features/sales/domain/customer-balance";
import {
  SaleCalculationError,
  calculateSale,
  saleProfit,
  type SaleProfit,
  type SaleTotals,
} from "@/features/sales/domain/sale-calculation";
import { unitAmountAgorot } from "@/shared/lib/money-math";
import { normalizeArabicText } from "@/shared/lib/normalize-arabic";
import * as schema from "@/server/db/schema";

export type SalesErrorCode =
  | "invalid_input"
  | "customer_not_found"
  | "variant_not_found"
  | "insufficient_stock"
  | "discount_exceeds_subtotal"
  | "paid_exceeds_total"
  | "cash_sale_must_be_paid"
  | "payment_exceeds_balance"
  | "not_found"
  | "already_cancelled"
  | "already_reversed"
  | "refund_exceeds_paid";

export class SalesError extends Error {
  constructor(
    readonly code: SalesErrorCode,
    readonly detail?: string,
  ) {
    super(code);
    this.name = "SalesError";
  }
}

const amount = z.number().int().min(0).max(100_000_000);

export const saleInputSchema = z
  .object({
    idempotencyKey: z.uuid(),
    customerId: z.uuid().optional(),
    customerName: z.string().trim().min(2).max(100).optional(),
    source: z.enum(saleSources),
    lines: z
      .array(
        z
          .object({
            variantId: variantDomainIdSchema,
            quantityMilli: z.number().int().min(1).max(MAX_QUANTITY_MILLI),
            unitPriceAgorot: z.number().int().min(0).max(10_000_000),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    discountAgorot: amount,
    paidAgorot: amount,
    note: z.string().trim().max(300).optional(),
  })
  .strict()
  .refine((value) => !(value.customerId && value.customerName));
export type SaleInput = z.infer<typeof saleInputSchema>;

export const customerPaymentSchema = z
  .object({
    customerId: z.uuid(),
    amountAgorot: z.number().int().min(1).max(100_000_000),
    note: z.string().trim().max(240).optional(),
    idempotencyKey: z.uuid(),
  })
  .strict();

export interface SaleLineImpact {
  variantId: string;
  name: string;
  quantityMilli: number;
  unit: StockUnit;
  unitPriceAgorot: number;
  lineTotalAgorot: number;
  tracked: boolean;
  availableBeforeMilli: number | null;
  availableAfterMilli: number | null;
  insufficient: boolean;
}

export interface SalePreview {
  customerName: string | null;
  newCustomer: boolean;
  totals: Omit<SaleTotals, "lineTotalsAgorot">;
  lines: SaleLineImpact[];
  balance: { beforeAgorot: number; afterAgorot: number } | null;
  profit: SaleProfit | null;
  blocked: boolean;
}

export interface SalePostResult {
  invoiceId: string;
  invoiceNumber: number;
  customerId: string | null;
  totalAgorot: number;
  remainingAgorot: number;
  balanceAfterAgorot: number | null;
  replayed: boolean;
}

interface ResolvedVariant {
  id: string;
  domainId: string;
  name: string;
  labelAr: string;
  sku: string | null;
}

function mapCalculationError(error: unknown): never {
  if (error instanceof SaleCalculationError) throw new SalesError(error.code);
  throw error;
}

export class SalesService {
  constructor(private readonly database: Database) {}

  async preview(actor: AdminActor, input: SaleInput): Promise<SalePreview> {
    assertPermission(actor, "sales.record");
    const data = this.parse(input);
    const totals = this.totals(data);
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
    const state = new Map(
      items.map((item) => [
        item.variantId,
        {
          unit: item.unit,
          available: item.onHandMilli - item.reservedMilli,
          onHand: item.onHandMilli,
          value: item.stockValueAgorot,
        },
      ]),
    );

    const costed: Array<{
      lineTotalAgorot: number;
      cogsAgorot: number | null;
    }> = [];
    const lines = data.lines.map((line, index): SaleLineImpact => {
      const variant = variants.get(line.variantId)!;
      const stock = state.get(variant.id);
      const lineTotalAgorot = totals.lineTotalsAgorot[index]!;
      if (!stock) {
        costed.push({ lineTotalAgorot, cogsAgorot: null });
        return {
          variantId: variant.domainId,
          name: variant.name,
          quantityMilli: line.quantityMilli,
          unit: "piece",
          unitPriceAgorot: line.unitPriceAgorot,
          lineTotalAgorot,
          tracked: false,
          availableBeforeMilli: null,
          availableAfterMilli: null,
          insufficient: false,
        };
      }
      const insufficient = line.quantityMilli > stock.available;
      const before = stock.available;
      if (insufficient) {
        costed.push({ lineTotalAgorot, cogsAgorot: null });
      } else {
        const cogs = issueCostAgorot(
          { onHandMilli: stock.onHand, valueAgorot: stock.value },
          line.quantityMilli,
        );
        costed.push({ lineTotalAgorot, cogsAgorot: cogs });
        stock.available -= line.quantityMilli;
        stock.onHand -= line.quantityMilli;
        stock.value -= cogs;
      }
      return {
        variantId: variant.domainId,
        name: variant.name,
        quantityMilli: line.quantityMilli,
        unit: stock.unit,
        unitPriceAgorot: line.unitPriceAgorot,
        lineTotalAgorot,
        tracked: true,
        availableBeforeMilli: before,
        availableAfterMilli: insufficient ? before : stock.available,
        insufficient,
      };
    });

    const customer = await this.findCustomer(this.database, data);
    const customerName = customer?.name ?? data.customerName ?? null;
    const before = customer
      ? await this.customerBalance(this.database, customer.id)
      : 0;

    return {
      customerName,
      newCustomer: Boolean(data.customerName) && !customer,
      totals: {
        subtotalAgorot: totals.subtotalAgorot,
        discountAgorot: totals.discountAgorot,
        totalAgorot: totals.totalAgorot,
        paidAgorot: totals.paidAgorot,
        remainingAgorot: totals.remainingAgorot,
      },
      lines,
      balance: customerName
        ? { beforeAgorot: before, afterAgorot: before + totals.remainingAgorot }
        : null,
      profit: can(actor, "stock.costs")
        ? saleProfit({
            lines: costed,
            subtotalAgorot: totals.subtotalAgorot,
            discountAgorot: totals.discountAgorot,
          })
        : null,
      blocked: lines.some((line) => line.insufficient),
    };
  }

  async post(actor: AdminActor, input: SaleInput): Promise<SalePostResult> {
    assertPermission(actor, "sales.record");
    const data = this.parse(input);
    const totals = this.totals(data);

    try {
      return await this.database.transaction(async (transaction) => {
        const [replay] = await transaction
          .select()
          .from(schema.customerInvoices)
          .where(
            eq(schema.customerInvoices.idempotencyKey, data.idempotencyKey),
          )
          .limit(1);
        if (replay) {
          return {
            invoiceId: replay.id,
            invoiceNumber: replay.invoiceNumber,
            customerId: replay.customerId,
            totalAgorot: replay.totalAgorot,
            remainingAgorot: replay.totalAgorot - replay.paidAtSaleAgorot,
            balanceAfterAgorot: replay.customerId
              ? await this.customerBalance(transaction, replay.customerId)
              : null,
            replayed: true,
          };
        }

        const customer = await this.resolveCustomer(transaction, data);
        const variants = await this.resolveVariants(transaction, data);
        const locationId = await getDefaultLocationId(transaction);

        // Inventory rows are locked in a stable order before any movement is posted.
        const locked = new Map<string, InventoryItemRow | null>();
        const ordered = [...variants.values()].sort((a, b) =>
          a.id.localeCompare(b.id),
        );
        for (const variant of ordered) {
          locked.set(
            variant.id,
            await lockInventoryItem(transaction, variant.id, locationId),
          );
        }

        const now = new Date();
        const [sequence] = await transaction.execute<{ number: number }>(
          sql`select nextval('customer_invoice_number_seq')::int as number`,
        );
        const invoiceId = crypto.randomUUID();

        // Header first (lines and movements reference it); cost totals are known after the stock-out.
        const planned = data.lines.map((line, index) => {
          const variant = variants.get(line.variantId)!;
          const item = locked.get(variant.id) ?? null;
          return {
            line,
            variant,
            item,
            lineTotalAgorot: totals.lineTotalsAgorot[index]!,
          };
        });
        const costs: Array<number | null> = [];
        const running = new Map(locked);
        const simulated = planned.map((entry) => {
          const item = running.get(entry.variant.id) ?? null;
          if (!item) {
            costs.push(null);
            return null;
          }
          if (
            entry.line.quantityMilli >
            item.onHandMilli - item.reservedMilli
          ) {
            throw new SalesError("insufficient_stock", entry.variant.name);
          }
          const cogs = issueCostAgorot(
            {
              onHandMilli: item.onHandMilli,
              valueAgorot: item.stockValueAgorot,
            },
            entry.line.quantityMilli,
          );
          costs.push(cogs);
          running.set(entry.variant.id, {
            ...item,
            onHandMilli: item.onHandMilli - entry.line.quantityMilli,
            stockValueAgorot: item.stockValueAgorot - cogs,
          });
          return cogs;
        });
        const cogsAgorot = simulated.reduce<number>(
          (sum, value) => sum + (value ?? 0),
          0,
        );

        await transaction.insert(schema.customerInvoices).values({
          id: invoiceId,
          invoiceNumber: sequence!.number,
          customerId: customer?.id ?? null,
          customerNameSnapshot: customer?.name ?? null,
          source: data.source,
          subtotalAgorot: totals.subtotalAgorot,
          discountAgorot: totals.discountAgorot,
          totalAgorot: totals.totalAgorot,
          paidAtSaleAgorot: totals.paidAgorot,
          cogsAgorot,
          costComplete: costs.every((cost) => cost !== null),
          note: data.note || null,
          idempotencyKey: data.idempotencyKey,
          createdBy: actor.id,
          createdAt: now,
        });

        for (const [index, entry] of planned.entries()) {
          const item = locked.get(entry.variant.id) ?? null;
          const lineId = crypto.randomUUID();
          const plannedCost = costs[index] ?? null;
          await transaction.insert(schema.customerInvoiceLines).values({
            id: lineId,
            invoiceId,
            lineNo: index + 1,
            variantId: entry.variant.id,
            productNameSnapshot: entry.variant.name,
            variantLabelSnapshot: entry.variant.labelAr,
            skuSnapshot: entry.variant.sku,
            unit: item?.unit ?? "piece",
            quantityMilli: entry.line.quantityMilli,
            unitPriceAgorot: entry.line.unitPriceAgorot,
            lineTotalAgorot: entry.lineTotalAgorot,
            unitCostAgorot:
              plannedCost === null
                ? null
                : unitAmountAgorot(plannedCost, entry.line.quantityMilli),
            cogsAgorot: plannedCost,
          });
          if (!item) continue;
          const { movement } = await postStockOut(transaction, {
            item,
            reason: "manual_sale",
            quantityMilli: entry.line.quantityMilli,
            references: { customerInvoiceLineId: lineId },
            idempotencyKey: `sale-line:${lineId}`,
            actorId: actor.id,
            at: now,
          });
          locked.set(entry.variant.id, applyMovementToItem(item, movement));
          await transaction
            .update(schema.inventoryItems)
            .set({ lastSalePriceAgorot: entry.line.unitPriceAgorot })
            .where(eq(schema.inventoryItems.id, item.id));
        }

        let paymentId: string | null = null;
        if (totals.paidAgorot > 0) {
          paymentId = crypto.randomUUID();
          await transaction.insert(schema.customerPayments).values({
            id: paymentId,
            customerId: customer?.id ?? null,
            invoiceId,
            amountAgorot: totals.paidAgorot,
            idempotencyKey: `sale:${invoiceId}:payment`,
            createdBy: actor.id,
            createdAt: now,
          });
        }
        if (customer) {
          if (totals.totalAgorot > 0) {
            await transaction.insert(schema.customerLedgerEntries).values({
              customerId: customer.id,
              type: "invoice",
              amountAgorot: totals.totalAgorot,
              invoiceId,
              idempotencyKey: `sale:${invoiceId}`,
              createdBy: actor.id,
              createdAt: now,
            });
          }
          if (paymentId) {
            await transaction.insert(schema.customerLedgerEntries).values({
              customerId: customer.id,
              type: "payment",
              amountAgorot: -totals.paidAgorot,
              invoiceId,
              paymentId,
              idempotencyKey: `sale:${invoiceId}:payment`,
              createdBy: actor.id,
              createdAt: now,
            });
          }
        }

        const afterState = {
          source: data.source,
          lineCount: data.lines.length,
          totalAgorot: totals.totalAgorot,
          paidAgorot: totals.paidAgorot,
          onCredit: totals.remainingAgorot > 0,
        };
        assertSafeAuditState(afterState);
        await transaction.insert(schema.adminAuditEvents).values({
          adminUserId: actor.id,
          actionType: "sale_post",
          entityType: "customer_invoice",
          entityId: invoiceId,
          beforeState: null,
          afterState,
          createdAt: now,
        });

        return {
          invoiceId,
          invoiceNumber: sequence!.number,
          customerId: customer?.id ?? null,
          totalAgorot: totals.totalAgorot,
          remainingAgorot: totals.remainingAgorot,
          balanceAfterAgorot: customer
            ? await this.customerBalance(transaction, customer.id)
            : null,
          replayed: false,
        };
      });
    } catch (error) {
      if (error instanceof InventoryError) {
        if (error.code === "insufficient_stock") {
          throw new SalesError("insufficient_stock", error.detail);
        }
        throw new SalesError("invalid_input");
      }
      throw error;
    }
  }

  async recordPayment(
    actor: AdminActor,
    input: z.input<typeof customerPaymentSchema>,
  ): Promise<{ balanceAgorot: number; replayed: boolean }> {
    assertPermission(actor, "payments.record");
    const parsed = customerPaymentSchema.safeParse(input);
    if (!parsed.success) throw new SalesError("invalid_input");
    const data = parsed.data;
    const key = `payment:${data.idempotencyKey}`;

    return this.database.transaction(async (transaction) => {
      const [customer] = await transaction
        .select({ id: schema.customers.id })
        .from(schema.customers)
        .where(eq(schema.customers.id, data.customerId))
        .for("update");
      if (!customer) throw new SalesError("customer_not_found");

      const [existing] = await transaction
        .select({ id: schema.customerPayments.id })
        .from(schema.customerPayments)
        .where(eq(schema.customerPayments.idempotencyKey, key))
        .limit(1);
      if (existing) {
        return {
          balanceAgorot: await this.customerBalance(transaction, customer.id),
          replayed: true,
        };
      }

      const before = await this.customerBalance(transaction, customer.id);
      if (data.amountAgorot > before) {
        throw new SalesError("payment_exceeds_balance");
      }
      const now = new Date();
      const paymentId = crypto.randomUUID();
      await transaction.insert(schema.customerPayments).values({
        id: paymentId,
        customerId: customer.id,
        amountAgorot: data.amountAgorot,
        note: data.note || null,
        idempotencyKey: key,
        createdBy: actor.id,
        createdAt: now,
      });
      await transaction.insert(schema.customerLedgerEntries).values({
        customerId: customer.id,
        type: "payment",
        amountAgorot: -data.amountAgorot,
        paymentId,
        note: data.note || null,
        idempotencyKey: key,
        createdBy: actor.id,
        createdAt: now,
      });
      await transaction.insert(schema.adminAuditEvents).values({
        adminUserId: actor.id,
        actionType: "customer_payment",
        entityType: "customer",
        entityId: customer.id,
        beforeState: { balanceAgorot: before },
        afterState: { balanceAgorot: before - data.amountAgorot },
        createdAt: now,
      });
      return { balanceAgorot: before - data.amountAgorot, replayed: false };
    });
  }

  // A wrong payment is never edited or deleted: a compensating entry cancels it out.
  async reversePayment(
    actor: AdminActor,
    input: { paymentId: string; reason: string },
  ): Promise<{ balanceAgorot: number }> {
    assertPermission(actor, "ledger.correct");
    const reason = input.reason.trim();
    if (
      !z.uuid().safeParse(input.paymentId).success ||
      reason.length < 2 ||
      reason.length > 240
    ) {
      throw new SalesError("invalid_input");
    }

    return this.database.transaction(async (transaction) => {
      const [payment] = await transaction
        .select()
        .from(schema.customerPayments)
        .where(eq(schema.customerPayments.id, input.paymentId))
        .limit(1);
      if (!payment || payment.amountAgorot <= 0 || !payment.customerId) {
        throw new SalesError("not_found");
      }
      await transaction
        .select({ id: schema.customers.id })
        .from(schema.customers)
        .where(eq(schema.customers.id, payment.customerId))
        .for("update");
      const [already] = await transaction
        .select({ id: schema.customerPayments.id })
        .from(schema.customerPayments)
        .where(eq(schema.customerPayments.reversesPaymentId, payment.id))
        .limit(1);
      if (already) throw new SalesError("already_reversed");

      const now = new Date();
      const reversalId = crypto.randomUUID();
      const key = `payment-reversal:${payment.id}`;
      await transaction.insert(schema.customerPayments).values({
        id: reversalId,
        customerId: payment.customerId,
        invoiceId: payment.invoiceId,
        amountAgorot: -payment.amountAgorot,
        reversesPaymentId: payment.id,
        note: reason,
        idempotencyKey: key,
        createdBy: actor.id,
        createdAt: now,
      });
      await transaction.insert(schema.customerLedgerEntries).values({
        customerId: payment.customerId,
        type: "payment_reversal",
        amountAgorot: payment.amountAgorot,
        invoiceId: payment.invoiceId,
        paymentId: reversalId,
        note: reason,
        idempotencyKey: key,
        createdBy: actor.id,
        createdAt: now,
      });
      await transaction.insert(schema.adminAuditEvents).values({
        adminUserId: actor.id,
        actionType: "customer_payment_reversal",
        entityType: "customer",
        entityId: payment.customerId,
        beforeState: null,
        afterState: { amountAgorot: payment.amountAgorot },
        createdAt: now,
      });
      return {
        balanceAgorot: await this.customerBalance(
          transaction,
          payment.customerId,
        ),
      };
    });
  }

  async cancelInvoice(
    actor: AdminActor,
    input: { invoiceId: string; reason: string },
  ): Promise<void> {
    assertPermission(actor, "ledger.correct");
    const reason = input.reason.trim();
    if (
      !z.uuid().safeParse(input.invoiceId).success ||
      reason.length < 2 ||
      reason.length > 240
    ) {
      throw new SalesError("invalid_input");
    }

    await this.database.transaction(async (transaction) => {
      const [invoice] = await transaction
        .select()
        .from(schema.customerInvoices)
        .where(eq(schema.customerInvoices.id, input.invoiceId))
        .for("update");
      if (!invoice) throw new SalesError("not_found");
      if (invoice.status === "cancelled") {
        throw new SalesError("already_cancelled");
      }
      const now = new Date();
      await transaction
        .update(schema.customerInvoices)
        .set({
          status: "cancelled",
          cancelledAt: now,
          cancelledBy: actor.id,
          cancelReason: reason,
        })
        .where(eq(schema.customerInvoices.id, invoice.id));

      // Goods go back at the cost they left with, so inventory value is restored exactly.
      const lines = await transaction
        .select()
        .from(schema.customerInvoiceLines)
        .where(eq(schema.customerInvoiceLines.invoiceId, invoice.id))
        .orderBy(asc(schema.customerInvoiceLines.variantId));
      const locationId = await getDefaultLocationId(transaction);
      for (const line of lines) {
        if (line.cogsAgorot === null) continue;
        const item = await lockInventoryItem(
          transaction,
          line.variantId,
          locationId,
        );
        if (!item) continue;
        await postStockIn(transaction, {
          item,
          reason: "customer_return",
          quantityMilli: line.quantityMilli,
          costAgorot: line.cogsAgorot,
          references: { customerInvoiceLineId: line.id },
          idempotencyKey: `sale-line:${line.id}:return`,
          actorId: actor.id,
          at: now,
        });
      }

      if (invoice.customerId) {
        if (invoice.totalAgorot > 0) {
          await transaction.insert(schema.customerLedgerEntries).values({
            customerId: invoice.customerId,
            type: "invoice_cancellation",
            amountAgorot: -invoice.totalAgorot,
            invoiceId: invoice.id,
            note: reason,
            idempotencyKey: `sale:${invoice.id}:cancel`,
            createdBy: actor.id,
            createdAt: now,
          });
        }
      } else if (invoice.paidAtSaleAgorot > 0) {
        // An anonymous cash sale has no ledger; the refund is a negative cash row.
        await transaction.insert(schema.customerPayments).values({
          invoiceId: invoice.id,
          amountAgorot: -invoice.paidAtSaleAgorot,
          note: reason,
          idempotencyKey: `sale:${invoice.id}:refund`,
          createdBy: actor.id,
          createdAt: now,
        });
      }

      await transaction.insert(schema.adminAuditEvents).values({
        adminUserId: actor.id,
        actionType: "sale_cancel",
        entityType: "customer_invoice",
        entityId: invoice.id,
        beforeState: { status: "posted" },
        afterState: { status: "cancelled", totalAgorot: invoice.totalAgorot },
        createdAt: now,
      });
    });
  }

  async listInvoices(actor: AdminActor, limit = 50) {
    assertPermission(actor, "sales.record");
    const rows = await this.database
      .select({
        id: schema.customerInvoices.id,
        invoiceNumber: schema.customerInvoices.invoiceNumber,
        customerId: schema.customerInvoices.customerId,
        customerName: schema.customerInvoices.customerNameSnapshot,
        status: schema.customerInvoices.status,
        totalAgorot: schema.customerInvoices.totalAgorot,
        paidAtSaleAgorot: schema.customerInvoices.paidAtSaleAgorot,
        source: schema.customerInvoices.source,
        createdAt: schema.customerInvoices.createdAt,
      })
      .from(schema.customerInvoices)
      .orderBy(desc(schema.customerInvoices.createdAt))
      .limit(Math.min(Math.max(limit, 1), 200));
    return rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async getInvoice(actor: AdminActor, invoiceId: string) {
    assertPermission(actor, "sales.record");
    if (!z.uuid().safeParse(invoiceId).success) return null;
    const [row] = await this.database
      .select({
        invoice: schema.customerInvoices,
        createdByName: schema.adminUsers.displayName,
        customerPhone: schema.customers.phoneE164,
      })
      .from(schema.customerInvoices)
      .innerJoin(
        schema.adminUsers,
        eq(schema.adminUsers.id, schema.customerInvoices.createdBy),
      )
      .leftJoin(
        schema.customers,
        eq(schema.customers.id, schema.customerInvoices.customerId),
      )
      .where(eq(schema.customerInvoices.id, invoiceId))
      .limit(1);
    if (!row) return null;
    const lines = await this.database
      .select()
      .from(schema.customerInvoiceLines)
      .where(eq(schema.customerInvoiceLines.invoiceId, invoiceId))
      .orderBy(asc(schema.customerInvoiceLines.lineNo));
    const { invoice } = row;
    const showCosts = can(actor, "stock.costs");
    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      customerId: invoice.customerId,
      customerName: invoice.customerNameSnapshot,
      customerPhone: row.customerPhone,
      status: invoice.status,
      source: invoice.source as SaleSource,
      subtotalAgorot: invoice.subtotalAgorot,
      discountAgorot: invoice.discountAgorot,
      totalAgorot: invoice.totalAgorot,
      paidAtSaleAgorot: invoice.paidAtSaleAgorot,
      note: invoice.note,
      createdAt: invoice.createdAt.toISOString(),
      createdByName: row.createdByName,
      cancelReason: invoice.cancelReason,
      profit: showCosts
        ? saleProfit({
            lines,
            subtotalAgorot: invoice.subtotalAgorot,
            discountAgorot: invoice.discountAgorot,
          })
        : null,
      lines: lines.map((line) => ({
        lineNo: line.lineNo,
        name: line.productNameSnapshot,
        variantLabel: line.variantLabelSnapshot,
        unit: line.unit,
        quantityMilli: line.quantityMilli,
        unitPriceAgorot: line.unitPriceAgorot,
        lineTotalAgorot: line.lineTotalAgorot,
      })),
    };
  }

  async customerBalance(
    database: Database,
    customerId: string,
  ): Promise<number> {
    const [row] = await database
      .select({
        balance: sql<number>`coalesce(sum(${schema.customerLedgerEntries.amountAgorot}), 0)::int`,
      })
      .from(schema.customerLedgerEntries)
      .where(eq(schema.customerLedgerEntries.customerId, customerId));
    return row?.balance ?? 0;
  }

  private parse(input: SaleInput): SaleInput {
    const parsed = saleInputSchema.safeParse(input);
    if (!parsed.success) throw new SalesError("invalid_input");
    return parsed.data;
  }

  private totals(data: SaleInput): SaleTotals {
    try {
      return calculateSale({
        lines: data.lines,
        discountAgorot: data.discountAgorot,
        paidAgorot: data.paidAgorot,
        hasCustomer: Boolean(data.customerId || data.customerName),
      });
    } catch (error) {
      return mapCalculationError(error);
    }
  }

  private async findCustomer(database: Database, data: SaleInput) {
    if (data.customerId) {
      const [customer] = await database
        .select({ id: schema.customers.id, name: schema.customers.name })
        .from(schema.customers)
        .where(eq(schema.customers.id, data.customerId))
        .limit(1);
      if (!customer) throw new SalesError("customer_not_found");
      return customer;
    }
    if (!data.customerName) return null;
    const normalized = normalizeArabicText(data.customerName);
    const [byName] = await database
      .select({ id: schema.customers.id, name: schema.customers.name })
      .from(schema.customers)
      .where(eq(schema.customers.normalizedName, normalized))
      .limit(1);
    if (byName) return byName;
    const [byAlias] = await database
      .select({ id: schema.customers.id, name: schema.customers.name })
      .from(schema.customerAliases)
      .innerJoin(
        schema.customers,
        eq(schema.customers.id, schema.customerAliases.customerId),
      )
      .where(eq(schema.customerAliases.normalizedAlias, normalized))
      .limit(1);
    return byAlias ?? null;
  }

  private async resolveCustomer(transaction: Database, data: SaleInput) {
    const existing = await this.findCustomer(transaction, data);
    if (existing || !data.customerName) {
      if (existing) {
        await transaction
          .select({ id: schema.customers.id })
          .from(schema.customers)
          .where(eq(schema.customers.id, existing.id))
          .for("update");
      }
      return existing;
    }
    const normalizedName = normalizeArabicText(data.customerName);
    if (normalizedName.length < 2) throw new SalesError("invalid_input");
    await transaction
      .insert(schema.customers)
      .values({ name: data.customerName, normalizedName })
      .onConflictDoNothing({ target: schema.customers.normalizedName });
    const [customer] = await transaction
      .select({ id: schema.customers.id, name: schema.customers.name })
      .from(schema.customers)
      .where(eq(schema.customers.normalizedName, normalizedName))
      .for("update");
    if (!customer) throw new SalesError("customer_not_found");
    return customer;
  }

  private async resolveVariants(
    database: Database,
    data: SaleInput,
  ): Promise<Map<string, ResolvedVariant>> {
    const domainIds = [...new Set(data.lines.map((line) => line.variantId))];
    if (domainIds.length !== data.lines.length) {
      throw new SalesError("invalid_input", "duplicate_line");
    }
    const rows = await database
      .select({
        id: schema.productVariants.id,
        domainId: schema.productVariants.domainId,
        labelAr: schema.productVariants.labelAr,
        sku: schema.productVariants.sku,
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
      throw new SalesError("variant_not_found");
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
        },
      ]),
    );
  }
}
