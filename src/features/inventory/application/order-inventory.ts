import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { unitsToMilli } from "@/features/inventory/domain/quantity";
import type { OrderStatus } from "@/features/orders/domain/order-status";
import * as schema from "@/server/db/schema";

import {
  InventoryError,
  getDefaultLocationId,
  lockInventoryItem,
  postReservationChange,
  postStockOut,
  type Database,
  type InventoryItemRow,
} from "./stock-ledger";

interface TransitionInput {
  orderId: string;
  nextStatus: OrderStatus;
  actorId: string;
  at: Date;
}

async function lockItemById(
  transaction: Database,
  inventoryItemId: string,
): Promise<InventoryItemRow> {
  const [item] = await transaction
    .select()
    .from(schema.inventoryItems)
    .where(eq(schema.inventoryItems.id, inventoryItemId))
    .for("update");
  if (!item) throw new InventoryError("not_found", "inventory_item");
  return item;
}

async function reserveOrder(transaction: Database, input: TransitionInput) {
  // Rows are locked in a stable order so two confirmations cannot deadlock.
  const lines = await transaction
    .select({
      orderItemId: schema.orderItems.id,
      quantity: schema.orderItems.quantity,
      productName: schema.orderItems.productNameSnapshot,
      variantId: schema.productVariants.id,
    })
    .from(schema.orderItems)
    .innerJoin(
      schema.productVariants,
      eq(schema.productVariants.domainId, schema.orderItems.variantDomainId),
    )
    .where(eq(schema.orderItems.orderId, input.orderId))
    .orderBy(asc(schema.productVariants.id));
  if (!lines.length) return;

  const locationId = await getDefaultLocationId(transaction);
  for (const line of lines) {
    const item = await lockInventoryItem(
      transaction,
      line.variantId,
      locationId,
    );
    // Variants without an inventory item are not tracked yet.
    if (!item) continue;
    const quantityMilli = unitsToMilli(line.quantity);
    if (quantityMilli > item.onHandMilli - item.reservedMilli) {
      throw new InventoryError("insufficient_stock", line.productName);
    }
    await transaction.insert(schema.stockReservations).values({
      inventoryItemId: item.id,
      orderId: input.orderId,
      orderItemId: line.orderItemId,
      quantityMilli,
      createdAt: input.at,
    });
    await postReservationChange(transaction, {
      item,
      reason: "order_reservation",
      quantityMilli,
      references: { orderId: input.orderId, orderItemId: line.orderItemId },
      idempotencyKey: `order-item:${line.orderItemId}:reserve`,
      actorId: input.actorId,
      at: input.at,
    });
  }
}

async function activeReservations(transaction: Database, orderId: string) {
  return transaction
    .select({
      id: schema.stockReservations.id,
      inventoryItemId: schema.stockReservations.inventoryItemId,
      orderItemId: schema.stockReservations.orderItemId,
      quantityMilli: schema.stockReservations.quantityMilli,
      unitPriceAgorot: schema.orderItems.unitPriceAgorot,
    })
    .from(schema.stockReservations)
    .innerJoin(
      schema.orderItems,
      eq(schema.orderItems.id, schema.stockReservations.orderItemId),
    )
    .where(
      and(
        eq(schema.stockReservations.orderId, orderId),
        eq(schema.stockReservations.status, "active"),
      ),
    )
    .orderBy(asc(schema.stockReservations.inventoryItemId));
}

async function releaseOrder(transaction: Database, input: TransitionInput) {
  for (const reservation of await activeReservations(
    transaction,
    input.orderId,
  )) {
    const item = await lockItemById(transaction, reservation.inventoryItemId);
    await postReservationChange(transaction, {
      item,
      reason: "reservation_release",
      quantityMilli: reservation.quantityMilli,
      references: {
        orderId: input.orderId,
        orderItemId: reservation.orderItemId,
      },
      idempotencyKey: `order-item:${reservation.orderItemId}:release`,
      actorId: input.actorId,
      at: input.at,
    });
    await transaction
      .update(schema.stockReservations)
      .set({ status: "released", resolvedAt: input.at })
      .where(eq(schema.stockReservations.id, reservation.id));
  }
}

async function fulfillOrder(transaction: Database, input: TransitionInput) {
  for (const reservation of await activeReservations(
    transaction,
    input.orderId,
  )) {
    const item = await lockItemById(transaction, reservation.inventoryItemId);
    await postStockOut(transaction, {
      item,
      reason: "order_fulfillment",
      quantityMilli: reservation.quantityMilli,
      releaseReservation: true,
      references: {
        orderId: input.orderId,
        orderItemId: reservation.orderItemId,
      },
      idempotencyKey: `order-item:${reservation.orderItemId}:fulfill`,
      actorId: input.actorId,
      at: input.at,
    });
    await transaction
      .update(schema.stockReservations)
      .set({ status: "fulfilled", resolvedAt: input.at })
      .where(eq(schema.stockReservations.id, reservation.id));
    await transaction
      .update(schema.inventoryItems)
      .set({ lastSalePriceAgorot: reservation.unitPriceAgorot })
      .where(eq(schema.inventoryItems.id, item.id));
  }
}

// Runs inside the order status transaction, so stock and status commit or roll back together.
export async function applyOrderInventoryTransition(
  transaction: Database,
  input: TransitionInput,
): Promise<void> {
  if (input.nextStatus === "confirmed") {
    await reserveOrder(transaction, input);
  } else if (input.nextStatus === "cancelled") {
    await releaseOrder(transaction, input);
  } else if (input.nextStatus === "delivered") {
    await fulfillOrder(transaction, input);
  }
}
