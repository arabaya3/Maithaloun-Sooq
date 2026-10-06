import "server-only";

import { createHash } from "node:crypto";

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { assertSafeAuditState } from "@/features/admin/domain/audit";
import { assertPermission, can } from "@/features/admin/domain/permissions";
import { variantDomainIdSchema } from "@/features/catalog/domain/product-variant";
import { unitMargin } from "@/features/inventory/domain/pricing";
import { MAX_QUANTITY_MILLI } from "@/features/inventory/domain/quantity";
import {
  adjustmentReasons,
  stockUnits,
  type StockMovementReason,
  type StockUnit,
} from "@/features/inventory/domain/stock-constants";
import {
  resolveStockStatus,
  type StockStatus,
} from "@/features/inventory/domain/stock-status";
import { lineTotalAgorot } from "@/shared/lib/money-math";
import { normalizeArabicText } from "@/shared/lib/normalize-arabic";
import * as schema from "@/server/db/schema";

import {
  InventoryError,
  ensureInventoryItem,
  getDefaultLocationId,
  postStockIn,
  lockInventoryItem,
  postStockOut,
  type Database,
} from "./stock-ledger";

export const stockTransferSchema = z
  .object({
    idempotencyKey: z.uuid(),
    fromVariantId: variantDomainIdSchema,
    toVariantId: variantDomainIdSchema,
    quantityMilli: z.number().int().positive().max(MAX_QUANTITY_MILLI),
    note: z.string().trim().max(200).optional(),
  })
  .strict()
  .refine((value) => value.fromVariantId !== value.toVariantId);
export type StockTransferInput = z.infer<typeof stockTransferSchema>;

export interface StockTransferResult {
  fromOnHandMilli: number;
  toOnHandMilli: number;
  costAgorot: number;
  replayed: boolean;
}

function derivedUuid(key: string, part: string): string {
  const hex = createHash("sha256").update(`${key}:${part}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

// Moves stock at its carried cost so total value and later profit stay unchanged.
export async function transferStockInTransaction(
  transaction: Database,
  actorId: string,
  input: StockTransferInput,
): Promise<StockTransferResult> {
  const outKey = derivedUuid(input.idempotencyKey, "out");
  const inKey = derivedUuid(input.idempotencyKey, "in");
  const [variants, locationId] = await Promise.all([
    transaction
      .select({
        id: schema.productVariants.id,
        domainId: schema.productVariants.domainId,
      })
      .from(schema.productVariants)
      .where(
        inArray(schema.productVariants.domainId, [
          input.fromVariantId,
          input.toVariantId,
        ]),
      ),
    getDefaultLocationId(transaction),
  ]);
  const from = variants.find((row) => row.domainId === input.fromVariantId);
  const to = variants.find((row) => row.domainId === input.toVariantId);
  if (!from || !to) throw new InventoryError("not_found");

  const [done] = await transaction
    .select({ id: schema.inventoryAdjustments.id })
    .from(schema.inventoryAdjustments)
    .where(eq(schema.inventoryAdjustments.idempotencyKey, outKey))
    .limit(1);
  if (done) {
    const [fromItem, toItem] = await Promise.all([
      lockInventoryItem(transaction, from.id, locationId),
      lockInventoryItem(transaction, to.id, locationId),
    ]);
    return {
      fromOnHandMilli: fromItem?.onHandMilli ?? 0,
      toOnHandMilli: toItem?.onHandMilli ?? 0,
      costAgorot: 0,
      replayed: true,
    };
  }

  // Locks are always taken in id order so two opposite transfers cannot deadlock.
  const ordered = [from, to].sort((a, b) => a.id.localeCompare(b.id));
  const locked = new Map<
    string,
    Awaited<ReturnType<typeof ensureInventoryItem>>
  >();
  for (const variant of ordered) {
    const item =
      variant.id === from.id
        ? await lockInventoryItem(transaction, variant.id, locationId)
        : await ensureInventoryItem(
            transaction,
            variant.id,
            locationId,
            "piece",
          );
    if (item) locked.set(variant.id, item);
  }
  const fromItem = locked.get(from.id);
  const toItem = locked.get(to.id);
  if (!fromItem) throw new InventoryError("untracked");
  if (!toItem) throw new InventoryError("not_found");

  const now = new Date();
  const note =
    input.note || `نقل بين ${input.fromVariantId} و${input.toVariantId}`;
  const [outDoc] = await transaction
    .insert(schema.inventoryAdjustments)
    .values({
      inventoryItemId: fromItem.id,
      reason: "correction",
      quantityDeltaMilli: -input.quantityMilli,
      note: note.slice(0, 240),
      idempotencyKey: outKey,
      createdBy: actorId,
      createdAt: now,
    })
    .returning({ id: schema.inventoryAdjustments.id });
  if (!outDoc) throw new InventoryError("invalid_input");
  const issued = await postStockOut(transaction, {
    item: fromItem,
    reason: "correction",
    quantityMilli: input.quantityMilli,
    references: { adjustmentId: outDoc.id },
    idempotencyKey: `adjustment:${outDoc.id}`,
    actorId,
    at: now,
  });

  const [inDoc] = await transaction
    .insert(schema.inventoryAdjustments)
    .values({
      inventoryItemId: toItem.id,
      reason: "correction",
      quantityDeltaMilli: input.quantityMilli,
      unitCostAgorot: issued.movement.unitCostAgorot,
      note: note.slice(0, 240),
      idempotencyKey: inKey,
      createdBy: actorId,
      createdAt: now,
    })
    .returning({ id: schema.inventoryAdjustments.id });
  if (!inDoc) throw new InventoryError("invalid_input");
  const received = await postStockIn(transaction, {
    item: toItem,
    reason: "correction",
    quantityMilli: input.quantityMilli,
    costAgorot: issued.costAgorot,
    references: { adjustmentId: inDoc.id },
    idempotencyKey: `adjustment:${inDoc.id}`,
    actorId,
    at: now,
  });

  const afterState = {
    fromVariantId: input.fromVariantId,
    toVariantId: input.toVariantId,
    quantityMilli: input.quantityMilli,
    fromOnHandAfterMilli: issued.movement.onHandAfterMilli,
    toOnHandAfterMilli: received.onHandAfterMilli,
  };
  assertSafeAuditState(afterState);
  await transaction.insert(schema.adminAuditEvents).values({
    adminUserId: actorId,
    actionType: "stock_transfer",
    entityType: "inventory_item",
    entityId: input.fromVariantId,
    beforeState: {
      fromOnHandMilli: fromItem.onHandMilli,
      toOnHandMilli: toItem.onHandMilli,
    },
    afterState,
    createdAt: now,
  });
  return {
    fromOnHandMilli: issued.movement.onHandAfterMilli,
    toOnHandMilli: received.onHandAfterMilli,
    costAgorot: issued.costAgorot,
    replayed: false,
  };
}

export const stockAdjustmentSchema = z
  .object({
    idempotencyKey: z.uuid(),
    variantId: variantDomainIdSchema,
    reason: z.enum(adjustmentReasons),
    quantityMilli: z.number().int().min(0).max(MAX_QUANTITY_MILLI),
    unit: z.enum(stockUnits).optional(),
    unitCostAgorot: z.number().int().min(0).max(10_000_000).optional(),
    note: z.string().trim().max(240).optional(),
  })
  .strict();
export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>;

export type StockListFilter =
  "all" | "attention" | "low" | "out" | "tracked" | "untracked";

export type StockListSort = "catalog" | "available" | "value" | "recent";

export interface StockListItem {
  variantId: string;
  productId: string;
  name: string;
  variantLabel: string | null;
  imageSrc: string | null;
  sku: string | null;
  barcode: string | null;
  tracked: boolean;
  unit: StockUnit;
  onHandMilli: number;
  reservedMilli: number;
  availableMilli: number;
  status: StockStatus | "untracked";
  reorderThresholdMilli: number | null;
  salePriceAgorot: number;
  lastMovementAt: string | null;
  lastMovementReason: StockMovementReason | null;
  avgCostAgorot: number | null;
  stockValueAgorot: number | null;
  unitProfitAgorot: number | null;
  marginBasisPoints: number | null;
}

export interface StockMovementView {
  id: string;
  reason: StockMovementReason;
  qtyDeltaMilli: number;
  reservedDeltaMilli: number;
  onHandAfterMilli: number;
  unitCostAgorot: number | null;
  actorName: string;
  createdAt: string;
}

export interface InventoryOverview {
  trackedCount: number;
  untrackedCount: number;
  lowStock: StockListItem[];
  lowCount: number;
  outOfStock: StockListItem[];
  outCount: number;
  inventoryValueAgorot: number | null;
  /** Tracked items whose sale price is below their average cost (cost viewers only). */
  belowCost: StockListItem[];
  /** Tracked items with more reserved than on hand; the ledger should never allow it. */
  overReserved: StockListItem[];
  recentReceipts: Array<{
    variantId: string;
    name: string;
    quantityMilli: number;
    unit: StockUnit;
    at: string;
  }>;
}

const DEFAULT_LABEL = "الافتراضي";

// Untracked rows always sink below tracked ones; ties keep the catalogue order.
export function sortStock(
  rows: StockListItem[],
  sort: StockListSort,
): StockListItem[] {
  if (sort === "catalog") return rows;
  const key = (row: StockListItem): number => {
    if (sort === "available") return row.availableMilli;
    if (sort === "value") return -(row.stockValueAgorot ?? 0);
    return -(row.lastMovementAt ? Date.parse(row.lastMovementAt) : 0);
  };
  return rows
    .map((row, index) => ({ row, index }))
    .sort(
      (a, b) =>
        Number(!a.row.tracked) - Number(!b.row.tracked) ||
        key(a.row) - key(b.row) ||
        a.index - b.index,
    )
    .map(({ row }) => row);
}

// Runs inside the caller's transaction so a stock adjustment can commit together with other changes.
export async function postStockAdjustment(
  transaction: Database,
  actor: AdminActor,
  input: StockAdjustmentInput,
): Promise<{ onHandMilli: number; replayed: boolean }> {
  assertPermission(actor, "stock.adjust");
  const parsed = stockAdjustmentSchema.safeParse(input);
  if (!parsed.success) throw new InventoryError("invalid_input");
  const data = parsed.data;
  const [existing] = await transaction
    .select({
      itemId: schema.inventoryAdjustments.inventoryItemId,
    })
    .from(schema.inventoryAdjustments)
    .where(eq(schema.inventoryAdjustments.idempotencyKey, data.idempotencyKey))
    .limit(1);
  if (existing) {
    const [current] = await transaction
      .select({ onHandMilli: schema.inventoryItems.onHandMilli })
      .from(schema.inventoryItems)
      .where(eq(schema.inventoryItems.id, existing.itemId));
    return { onHandMilli: current?.onHandMilli ?? 0, replayed: true };
  }

  const [variant] = await transaction
    .select({ id: schema.productVariants.id })
    .from(schema.productVariants)
    .where(eq(schema.productVariants.domainId, data.variantId))
    .limit(1);
  if (!variant) throw new InventoryError("not_found");

  const locationId = await getDefaultLocationId(transaction);
  const item = await ensureInventoryItem(
    transaction,
    variant.id,
    locationId,
    data.unit ?? "piece",
  );

  const isCount = data.reason === "correction";
  const stockIn =
    data.reason === "opening_balance" || data.reason === "customer_return";
  const deltaMilli = isCount
    ? data.quantityMilli - item.onHandMilli
    : stockIn
      ? data.quantityMilli
      : -data.quantityMilli;
  if (deltaMilli === 0) throw new InventoryError("invalid_input", "no_change");

  let unitCostAgorot: number | null = null;
  if (deltaMilli > 0) {
    // Stock-in always carries a cost so inventory value and later profit stay real.
    unitCostAgorot =
      data.unitCostAgorot ??
      (data.reason === "opening_balance" ? null : item.avgCostAgorot);
    if (unitCostAgorot === null) throw new InventoryError("cost_required");
  }

  const now = new Date();
  const [adjustment] = await transaction
    .insert(schema.inventoryAdjustments)
    .values({
      inventoryItemId: item.id,
      reason: data.reason,
      quantityDeltaMilli: deltaMilli,
      unitCostAgorot,
      note: data.note || null,
      idempotencyKey: data.idempotencyKey,
      createdBy: actor.id,
      createdAt: now,
    })
    .returning({ id: schema.inventoryAdjustments.id });
  if (!adjustment) throw new InventoryError("invalid_input");

  const context = {
    item,
    references: { adjustmentId: adjustment.id },
    idempotencyKey: `adjustment:${adjustment.id}`,
    actorId: actor.id,
    at: now,
  };
  const movement =
    deltaMilli > 0
      ? await postStockIn(transaction, {
          ...context,
          reason: data.reason as
            "opening_balance" | "customer_return" | "correction",
          quantityMilli: deltaMilli,
          costAgorot: lineTotalAgorot(deltaMilli, unitCostAgorot ?? 0),
        })
      : (
          await postStockOut(transaction, {
            ...context,
            reason: data.reason as
              "damaged" | "expired" | "supplier_return" | "correction",
            quantityMilli: -deltaMilli,
          })
        ).movement;

  const afterState = {
    variantId: data.variantId,
    reason: data.reason,
    quantityDeltaMilli: deltaMilli,
    onHandAfterMilli: movement.onHandAfterMilli,
  };
  assertSafeAuditState(afterState);
  await transaction.insert(schema.adminAuditEvents).values({
    adminUserId: actor.id,
    actionType: "stock_adjustment",
    entityType: "inventory_item",
    entityId: data.variantId,
    beforeState: { onHandMilli: item.onHandMilli },
    afterState,
    createdAt: now,
  });

  return { onHandMilli: movement.onHandAfterMilli, replayed: false };
}

export class InventoryService {
  constructor(private readonly database: Database) {}

  async listStock(
    actor: AdminActor,
    query: {
      filter?: StockListFilter;
      search?: string;
      sort?: StockListSort;
    } = {},
  ): Promise<StockListItem[]> {
    assertPermission(actor, "stock.view");
    const showCosts = can(actor, "stock.costs");
    const locationId = await getDefaultLocationId(this.database);
    const rows = await this.database
      .select({
        variant: schema.productVariants,
        product: {
          domainId: schema.products.domainId,
          nameAr: schema.products.nameAr,
          latinName: schema.products.latinName,
          sortOrder: schema.products.sortOrder,
        },
        item: schema.inventoryItems,
      })
      .from(schema.productVariants)
      .innerJoin(
        schema.products,
        eq(schema.products.id, schema.productVariants.productId),
      )
      .leftJoin(
        schema.inventoryItems,
        and(
          eq(schema.inventoryItems.variantId, schema.productVariants.id),
          eq(schema.inventoryItems.locationId, locationId),
        ),
      )
      .orderBy(
        asc(schema.products.sortOrder),
        asc(schema.products.domainId),
        asc(schema.productVariants.sortOrder),
      );

    const needle = query.search ? normalizeArabicText(query.search) : "";
    const filter = query.filter ?? "all";

    const listed = rows
      .map(({ variant, product, item }): StockListItem => {
        const productName = product.latinName
          ? `${product.nameAr} ${product.latinName}`
          : product.nameAr;
        const onHandMilli = item?.onHandMilli ?? 0;
        const reservedMilli = item?.reservedMilli ?? 0;
        const avgCost = item?.avgCostAgorot ?? null;
        const margin =
          showCosts && avgCost !== null
            ? unitMargin(variant.priceAgorot, avgCost)
            : null;
        return {
          variantId: variant.domainId,
          productId: product.domainId,
          name: productName,
          variantLabel:
            variant.labelAr === DEFAULT_LABEL ? null : variant.labelAr,
          imageSrc: variant.imageSrc,
          sku: variant.sku,
          barcode: variant.barcode,
          tracked: Boolean(item),
          unit: item?.unit ?? "piece",
          onHandMilli,
          reservedMilli,
          availableMilli: onHandMilli - reservedMilli,
          status: item
            ? resolveStockStatus({
                onHandMilli,
                reservedMilli,
                reorderThresholdMilli: item.reorderThresholdMilli,
              })
            : "untracked",
          reorderThresholdMilli: item?.reorderThresholdMilli ?? null,
          salePriceAgorot: variant.priceAgorot,
          lastMovementAt: item?.lastMovementAt?.toISOString() ?? null,
          lastMovementReason: item?.lastMovementReason ?? null,
          avgCostAgorot: showCosts ? avgCost : null,
          stockValueAgorot: showCosts ? (item?.stockValueAgorot ?? null) : null,
          unitProfitAgorot: margin?.profitAgorot ?? null,
          marginBasisPoints: margin?.marginBasisPoints ?? null,
        };
      })
      .filter((row) => {
        if (
          filter === "attention" &&
          row.status !== "low" &&
          row.status !== "out"
        ) {
          return false;
        }
        if (filter === "low" && row.status !== "low") return false;
        if (filter === "out" && row.status !== "out") return false;
        if (filter === "tracked" && !row.tracked) return false;
        if (filter === "untracked" && row.tracked) return false;
        if (!needle) return true;
        const haystack = normalizeArabicText(
          `${row.name} ${row.variantLabel ?? ""} ${row.sku ?? ""} ${row.barcode ?? ""}`,
        );
        return haystack.includes(needle);
      });
    return sortStock(listed, query.sort ?? "catalog");
  }

  async getOverview(actor: AdminActor): Promise<InventoryOverview> {
    const stock = await this.listStock(actor);
    const tracked = stock.filter((row) => row.tracked);
    const low = tracked.filter((row) => row.status === "low");
    const out = tracked.filter((row) => row.status === "out");

    const receipts = await this.database
      .select({
        variantId: schema.productVariants.domainId,
        nameAr: schema.products.nameAr,
        latinName: schema.products.latinName,
        quantityMilli: schema.stockMovements.qtyDeltaMilli,
        unit: schema.inventoryItems.unit,
        at: schema.stockMovements.createdAt,
      })
      .from(schema.stockMovements)
      .innerJoin(
        schema.inventoryItems,
        eq(schema.inventoryItems.id, schema.stockMovements.inventoryItemId),
      )
      .innerJoin(
        schema.productVariants,
        eq(schema.productVariants.id, schema.inventoryItems.variantId),
      )
      .innerJoin(
        schema.products,
        eq(schema.products.id, schema.productVariants.productId),
      )
      .where(eq(schema.stockMovements.reason, "purchase_receipt"))
      .orderBy(desc(schema.stockMovements.createdAt))
      .limit(5);

    return {
      trackedCount: tracked.length,
      untrackedCount: stock.length - tracked.length,
      lowStock: low.slice(0, 6),
      lowCount: low.length,
      outOfStock: out.slice(0, 6),
      outCount: out.length,
      belowCost: tracked.filter(
        (row) => row.unitProfitAgorot !== null && row.unitProfitAgorot < 0,
      ),
      overReserved: tracked.filter((row) => row.availableMilli < 0),
      inventoryValueAgorot: can(actor, "stock.costs")
        ? tracked.reduce((sum, row) => sum + (row.stockValueAgorot ?? 0), 0)
        : null,
      recentReceipts: receipts.map((row) => ({
        variantId: row.variantId,
        name: row.latinName ? `${row.nameAr} ${row.latinName}` : row.nameAr,
        quantityMilli: row.quantityMilli,
        unit: row.unit,
        at: row.at.toISOString(),
      })),
    };
  }

  async getVariantStock(
    actor: AdminActor,
    variantId: string,
  ): Promise<{ stock: StockListItem; movements: StockMovementView[] } | null> {
    assertPermission(actor, "stock.view");
    if (!variantDomainIdSchema.safeParse(variantId).success) return null;
    const stock = (await this.listStock(actor)).find(
      (row) => row.variantId === variantId,
    );
    if (!stock) return null;

    const showCosts = can(actor, "stock.costs");
    const movements = await this.database
      .select({
        id: schema.stockMovements.id,
        reason: schema.stockMovements.reason,
        qtyDeltaMilli: schema.stockMovements.qtyDeltaMilli,
        reservedDeltaMilli: schema.stockMovements.reservedDeltaMilli,
        onHandAfterMilli: schema.stockMovements.onHandAfterMilli,
        unitCostAgorot: schema.stockMovements.unitCostAgorot,
        actorName: schema.adminUsers.displayName,
        createdAt: schema.stockMovements.createdAt,
      })
      .from(schema.stockMovements)
      .innerJoin(
        schema.inventoryItems,
        eq(schema.inventoryItems.id, schema.stockMovements.inventoryItemId),
      )
      .innerJoin(
        schema.productVariants,
        eq(schema.productVariants.id, schema.inventoryItems.variantId),
      )
      .innerJoin(
        schema.adminUsers,
        eq(schema.adminUsers.id, schema.stockMovements.createdBy),
      )
      .where(eq(schema.productVariants.domainId, variantId))
      .orderBy(
        desc(schema.stockMovements.createdAt),
        desc(schema.stockMovements.id),
      )
      .limit(30);

    return {
      stock,
      movements: movements.map((row) => ({
        ...row,
        unitCostAgorot: showCosts ? row.unitCostAgorot : null,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  async adjust(
    actor: AdminActor,
    input: StockAdjustmentInput,
  ): Promise<{ onHandMilli: number; replayed: boolean }> {
    assertPermission(actor, "stock.adjust");
    return this.database.transaction((transaction) =>
      postStockAdjustment(transaction, actor, input),
    );
  }

  async setReorderThreshold(
    actor: AdminActor,
    input: { variantId: string; thresholdMilli: number | null },
  ): Promise<void> {
    assertPermission(actor, "stock.adjust");
    if (
      !variantDomainIdSchema.safeParse(input.variantId).success ||
      (input.thresholdMilli !== null &&
        (!Number.isInteger(input.thresholdMilli) ||
          input.thresholdMilli < 0 ||
          input.thresholdMilli > MAX_QUANTITY_MILLI))
    ) {
      throw new InventoryError("invalid_input");
    }

    await this.database.transaction(async (transaction) => {
      const locationId = await getDefaultLocationId(transaction);
      const [item] = await transaction
        .select({
          id: schema.inventoryItems.id,
          reorderThresholdMilli: schema.inventoryItems.reorderThresholdMilli,
        })
        .from(schema.inventoryItems)
        .innerJoin(
          schema.productVariants,
          eq(schema.productVariants.id, schema.inventoryItems.variantId),
        )
        .where(
          and(
            eq(schema.productVariants.domainId, input.variantId),
            eq(schema.inventoryItems.locationId, locationId),
          ),
        )
        .for("update", { of: schema.inventoryItems });
      if (!item) throw new InventoryError("untracked");

      await transaction
        .update(schema.inventoryItems)
        .set({
          reorderThresholdMilli: input.thresholdMilli,
          updatedAt: new Date(),
        })
        .where(eq(schema.inventoryItems.id, item.id));
      await transaction.insert(schema.adminAuditEvents).values({
        adminUserId: actor.id,
        actionType: "reorder_threshold_update",
        entityType: "inventory_item",
        entityId: input.variantId,
        beforeState: { reorderThresholdMilli: item.reorderThresholdMilli },
        afterState: { reorderThresholdMilli: input.thresholdMilli },
      });
    });
  }

  async transfer(
    actor: AdminActor,
    input: StockTransferInput,
  ): Promise<StockTransferResult> {
    assertPermission(actor, "stock.adjust");
    const parsed = stockTransferSchema.safeParse(input);
    if (!parsed.success) throw new InventoryError("invalid_input");
    return this.database.transaction((transaction) =>
      transferStockInTransaction(transaction, actor.id, parsed.data),
    );
  }
}
