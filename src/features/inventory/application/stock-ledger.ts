import "server-only";

import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  issueCostAgorot,
  type StockState,
} from "@/features/inventory/domain/costing";
import type {
  StockMovementReason,
  StockUnit,
} from "@/features/inventory/domain/stock-constants";
import { unitAmountAgorot } from "@/shared/lib/money-math";
import * as schema from "@/server/db/schema";

export type Database = PostgresJsDatabase<typeof schema>;
export type InventoryItemRow = typeof schema.inventoryItems.$inferSelect;
export type StockMovementRow = typeof schema.stockMovements.$inferSelect;

export type InventoryErrorCode =
  | "not_found"
  | "invalid_input"
  | "insufficient_stock"
  | "cost_required"
  | "untracked";

export class InventoryError extends Error {
  constructor(
    readonly code: InventoryErrorCode,
    readonly detail?: string,
  ) {
    super(code);
    this.name = "InventoryError";
  }
}

export interface MovementReferences {
  purchaseInvoiceItemId?: string;
  orderId?: string;
  orderItemId?: string;
  customerInvoiceLineId?: string;
  adjustmentId?: string;
}

export async function getDefaultLocationId(
  database: Database,
): Promise<string> {
  const [location] = await database
    .select({ id: schema.inventoryLocations.id })
    .from(schema.inventoryLocations)
    .where(eq(schema.inventoryLocations.isDefault, true))
    .limit(1);
  if (!location) throw new InventoryError("not_found", "location");
  return location.id;
}

export async function lockInventoryItem(
  transaction: Database,
  variantId: string,
  locationId: string,
): Promise<InventoryItemRow | null> {
  const [item] = await transaction
    .select()
    .from(schema.inventoryItems)
    .where(
      and(
        eq(schema.inventoryItems.variantId, variantId),
        eq(schema.inventoryItems.locationId, locationId),
      ),
    )
    .for("update");
  return item ?? null;
}

export async function ensureInventoryItem(
  transaction: Database,
  variantId: string,
  locationId: string,
  unit: StockUnit,
): Promise<InventoryItemRow> {
  await transaction
    .insert(schema.inventoryItems)
    .values({ variantId, locationId, unit })
    .onConflictDoNothing({
      target: [
        schema.inventoryItems.variantId,
        schema.inventoryItems.locationId,
      ],
    });
  const item = await lockInventoryItem(transaction, variantId, locationId);
  if (!item) throw new InventoryError("not_found", "inventory_item");
  return item;
}

function isCheckViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (
      typeof current === "object" &&
      "code" in current &&
      (current as { code?: string }).code === "23514"
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

async function insertMovement(
  transaction: Database,
  input: {
    item: InventoryItemRow;
    reason: StockMovementReason;
    qtyDeltaMilli: number;
    reservedDeltaMilli: number;
    valueDeltaAgorot: number;
    unitCostAgorot: number | null;
    references: MovementReferences;
    idempotencyKey: string;
    actorId: string;
    at: Date;
  },
): Promise<StockMovementRow> {
  try {
    const [movement] = await transaction
      .insert(schema.stockMovements)
      .values({
        inventoryItemId: input.item.id,
        reason: input.reason,
        qtyDeltaMilli: input.qtyDeltaMilli,
        reservedDeltaMilli: input.reservedDeltaMilli,
        valueDeltaAgorot: input.valueDeltaAgorot,
        unitCostAgorot: input.unitCostAgorot,
        // The apply_stock_movement trigger computes the resulting balances.
        onHandAfterMilli: 0,
        reservedAfterMilli: 0,
        valueAfterAgorot: 0,
        ...input.references,
        idempotencyKey: input.idempotencyKey,
        createdBy: input.actorId,
        createdAt: input.at,
      })
      .returning();
    if (!movement) throw new InventoryError("invalid_input");
    return movement;
  } catch (error) {
    if (isCheckViolation(error)) throw new InventoryError("insufficient_stock");
    throw error;
  }
}

function stockStateOf(item: InventoryItemRow): StockState {
  return { onHandMilli: item.onHandMilli, valueAgorot: item.stockValueAgorot };
}

interface MovementContext {
  item: InventoryItemRow;
  references: MovementReferences;
  idempotencyKey: string;
  actorId: string;
  at: Date;
}

export async function postStockIn(
  transaction: Database,
  input: MovementContext & {
    reason: Extract<
      StockMovementReason,
      "purchase_receipt" | "opening_balance" | "customer_return" | "correction"
    >;
    quantityMilli: number;
    costAgorot: number;
  },
): Promise<StockMovementRow> {
  if (input.quantityMilli <= 0 || input.costAgorot < 0) {
    throw new InventoryError("invalid_input");
  }
  return insertMovement(transaction, {
    ...input,
    qtyDeltaMilli: input.quantityMilli,
    reservedDeltaMilli: 0,
    valueDeltaAgorot: input.costAgorot,
    unitCostAgorot: unitAmountAgorot(input.costAgorot, input.quantityMilli),
  });
}

export async function postStockOut(
  transaction: Database,
  input: MovementContext & {
    reason: Extract<
      StockMovementReason,
      | "order_fulfillment"
      | "manual_sale"
      | "supplier_return"
      | "damaged"
      | "expired"
      | "correction"
    >;
    quantityMilli: number;
    releaseReservation?: boolean;
  },
): Promise<{ movement: StockMovementRow; costAgorot: number }> {
  if (input.quantityMilli <= 0) throw new InventoryError("invalid_input");
  const reservedDeltaMilli = input.releaseReservation
    ? -input.quantityMilli
    : 0;
  const freeMilli = input.releaseReservation
    ? input.item.onHandMilli
    : input.item.onHandMilli - input.item.reservedMilli;
  if (input.quantityMilli > freeMilli) {
    throw new InventoryError("insufficient_stock");
  }
  const costAgorot = issueCostAgorot(
    stockStateOf(input.item),
    input.quantityMilli,
  );
  const movement = await insertMovement(transaction, {
    ...input,
    qtyDeltaMilli: -input.quantityMilli,
    reservedDeltaMilli,
    valueDeltaAgorot: -costAgorot,
    unitCostAgorot: unitAmountAgorot(costAgorot, input.quantityMilli),
  });
  return { movement, costAgorot };
}

export async function postReservationChange(
  transaction: Database,
  input: MovementContext & {
    reason: Extract<
      StockMovementReason,
      "order_reservation" | "reservation_release"
    >;
    quantityMilli: number;
  },
): Promise<StockMovementRow> {
  if (input.quantityMilli <= 0) throw new InventoryError("invalid_input");
  if (input.reason === "order_reservation") {
    const available = input.item.onHandMilli - input.item.reservedMilli;
    if (input.quantityMilli > available) {
      throw new InventoryError("insufficient_stock");
    }
  }
  return insertMovement(transaction, {
    ...input,
    qtyDeltaMilli: 0,
    reservedDeltaMilli:
      input.reason === "order_reservation"
        ? input.quantityMilli
        : -input.quantityMilli,
    valueDeltaAgorot: 0,
    unitCostAgorot: null,
  });
}

// Keeps a locked row in step with the movement just posted for multi-line documents.
export function applyMovementToItem(
  item: InventoryItemRow,
  movement: StockMovementRow,
): InventoryItemRow {
  return {
    ...item,
    onHandMilli: movement.onHandAfterMilli,
    reservedMilli: movement.reservedAfterMilli,
    stockValueAgorot: movement.valueAfterAgorot,
    avgCostAgorot: movement.avgCostAfterAgorot,
  };
}
