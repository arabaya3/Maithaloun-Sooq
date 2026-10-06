import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AdminOrderService } from "@/features/admin/application/admin-order-service";
import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { InventoryService } from "@/features/inventory/application/inventory-service";
import { OrderService } from "@/features/orders/application/order-service";
import type { OrderStatus } from "@/features/orders/domain/order-status";
import { statusImpact } from "@/features/orders/domain/status-impact";
import * as schema from "@/server/db/schema";
import {
  resetTestDatabase,
  testDatabaseConnection,
} from "@/test/test-database";

import {
  checkoutRequest,
  createOwnerActor,
  OPERATIONS_TABLES,
} from "./support";

const { db, client } = testDatabaseConnection;
const orders = new OrderService(db);
const adminOrders = new AdminOrderService(db);
const inventory = new InventoryService(db);
const VARIANT = "general-cleaner--default";

let owner: AdminActor;

async function stock(pieces: number, reason = "opening_balance" as const) {
  await inventory.adjust(owner, {
    idempotencyKey: crypto.randomUUID(),
    variantId: VARIANT,
    reason,
    quantityMilli: pieces * 1_000,
    unitCostAgorot: 200,
  });
}

async function item() {
  const [row] = await db
    .select({ item: schema.inventoryItems })
    .from(schema.inventoryItems)
    .innerJoin(
      schema.productVariants,
      eq(schema.productVariants.id, schema.inventoryItems.variantId),
    )
    .where(eq(schema.productVariants.domainId, VARIANT));
  return row!.item;
}

// The preview the owner sees, computed from the same detail the order page loads.
async function preview(reference: string, next: OrderStatus) {
  const detail = (await adminOrders.getByPublicReference(owner, reference))!;
  return statusImpact(
    next,
    detail.items.map((line) => ({
      name: line.productName,
      pieces: line.baseUnits,
      tracked: line.stock.tracked,
      reservation: line.stock.reservation,
      availableMilli: line.stock.availableMilli,
    })),
    detail.finalTotalAgorot,
  );
}

async function move(reference: string, next: OrderStatus) {
  const detail = (await adminOrders.getByPublicReference(owner, reference))!;
  return adminOrders.changeStatus(owner, {
    publicReference: reference,
    nextStatus: next,
    expectedVersion: detail.version,
  });
}

beforeAll(async () => {
  await resetTestDatabase();
  owner = await createOwnerActor();
});

beforeEach(async () => {
  await client.unsafe(`TRUNCATE TABLE ${OPERATIONS_TABLES.join(", ")} CASCADE`);
});

describe("status change preview matches what the change does", () => {
  it("confirm reserves, delivery deducts, exactly as previewed", async () => {
    await stock(10);
    const order = await orders.create(
      checkoutRequest([{ productId: "general-cleaner", quantity: 2 }]),
    );
    const ref = order.publicReference;

    const confirm = await preview(ref, "confirmed");
    expect(confirm.blocked).toBe(false);
    expect(confirm.stock[0]).toMatch(/^يُحجز 2 من «منظف عام/);
    await move(ref, "confirmed");
    expect(await item()).toMatchObject({
      onHandMilli: 10_000,
      reservedMilli: 2_000,
    });

    expect((await preview(ref, "preparing")).stock).toEqual([
      "لا يتغير المخزون؛ تبقى الكميات محجوزة لهذا الطلب.",
    ]);
    await move(ref, "preparing");
    await move(ref, "out_for_delivery");
    expect(await item()).toMatchObject({
      onHandMilli: 10_000,
      reservedMilli: 2_000,
    });

    const deliver = await preview(ref, "delivered");
    expect(deliver.stock[0]).toMatch(/^يُخصم 2 من «منظف عام.*» نهائياً/);
    expect(deliver.money).toContain(`يُحصَّل`);
    await move(ref, "delivered");
    expect(await item()).toMatchObject({
      onHandMilli: 8_000,
      reservedMilli: 0,
    });
  });

  it("cancel releases exactly the reservation it previews; before confirming there is none", async () => {
    await stock(10);
    const early = await orders.create(
      checkoutRequest([{ productId: "general-cleaner", quantity: 1 }]),
    );
    expect((await preview(early.publicReference, "cancelled")).stock).toEqual([
      "لا يوجد حجز لهذا الطلب، فلا يتغير المخزون.",
    ]);

    const order = await orders.create(
      checkoutRequest([{ productId: "general-cleaner", quantity: 3 }]),
    );
    await move(order.publicReference, "confirmed");
    const cancel = await preview(order.publicReference, "cancelled");
    expect(cancel.stock).toHaveLength(1);
    expect(cancel.stock[0]).toMatch(
      /^يُفك حجز 3 من «منظف عام.*» ويعود متاحاً للبيع.$/,
    );
    expect(cancel.money).toBe(
      "لا يوجد مبلغ مدفوع لإرجاعه؛ الطلب بالدفع عند التسليم.",
    );
    await move(order.publicReference, "cancelled");
    expect(await item()).toMatchObject({
      onHandMilli: 10_000,
      reservedMilli: 0,
    });
  });

  it("a confirm the server would refuse for lack of stock is previewed as blocked", async () => {
    // Checkout only accepts what is free, so the shortage comes from a correction after the order.
    await stock(3);
    const order = await orders.create(
      checkoutRequest([{ productId: "general-cleaner", quantity: 2 }]),
    );
    await inventory.adjust(owner, {
      idempotencyKey: crypto.randomUUID(),
      variantId: VARIANT,
      reason: "damaged",
      quantityMilli: 2_000,
    });
    const confirm = await preview(order.publicReference, "confirmed");
    expect(confirm.blocked).toBe(true);
    expect(confirm.stock[0]).toContain("يحتاج 2 والمتوفر 1 فقط");
    await expect(
      move(order.publicReference, "confirmed"),
    ).rejects.toMatchObject({
      code: "insufficient_stock",
    });
  });
});
