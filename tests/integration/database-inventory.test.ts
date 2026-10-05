import { eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  AdminOrderError,
  AdminOrderService,
} from "@/features/admin/application/admin-order-service";
import {
  AuthorizationError,
  type AdminActor,
} from "@/features/admin/domain/admin-actor";
import { InventoryService } from "@/features/inventory/application/inventory-service";
import { InventoryError } from "@/features/inventory/application/stock-ledger";
import { OrderService } from "@/features/orders/application/order-service";
import type { OrderStatus } from "@/features/orders/domain/order-status";
import {
  PurchaseError,
  PurchaseService,
  type PurchaseInput,
} from "@/features/purchasing/application/purchase-service";
import {
  SupplierError,
  SupplierService,
} from "@/features/purchasing/application/supplier-service";
import {
  adminAuditEvents,
  inventoryItems,
  priceReviews,
  productVariants,
  stockMovements,
  stockReservations,
  supplierLedgerEntries,
} from "@/server/db/schema";
import {
  resetTestDatabase,
  testDatabaseConnection,
} from "@/test/test-database";

import {
  OPERATIONS_TABLES,
  checkoutRequest,
  createOperatorActor,
  createOwnerActor,
} from "./support";

const { db, client } = testDatabaseConnection;
const orderService = new OrderService(db);
const adminOrderService = new AdminOrderService(db);
const inventoryService = new InventoryService(db);
const purchaseService = new PurchaseService(db);
const supplierService = new SupplierService(db);

const CLEANER = "general-cleaner--default";
const BLEACH = "dolphin-bleach--default";

let owner: AdminActor;
let operator: AdminActor;

function purchase(overrides: Partial<PurchaseInput> = {}): PurchaseInput {
  return {
    idempotencyKey: crypto.randomUUID(),
    supplierName: "مورد الاختبار",
    reference: `INV-${crypto.randomUUID().slice(0, 8)}`,
    invoiceDate: "2026-09-01",
    source: "manual",
    lines: [
      {
        variantId: CLEANER,
        unit: "piece",
        quantityMilli: 10_000,
        packQuantity: 1,
        unitCostAgorot: 400,
        lineDiscountAgorot: 0,
      },
    ],
    discountAgorot: 0,
    taxAgorot: null,
    printedTotalAgorot: null,
    paidAgorot: 0,
    acknowledgeDuplicate: false,
    ...overrides,
  };
}

async function itemFor(variantDomainId: string) {
  const [row] = await db
    .select({ item: inventoryItems })
    .from(inventoryItems)
    .innerJoin(
      productVariants,
      eq(productVariants.id, inventoryItems.variantId),
    )
    .where(eq(productVariants.domainId, variantDomainId));
  return row?.item ?? null;
}

async function placeOrder(quantity: number, productId = "general-cleaner") {
  const confirmation = await orderService.create(
    checkoutRequest([{ productId, quantity }]),
  );
  return confirmation.publicReference;
}

async function advance(publicReference: string, ...statuses: OrderStatus[]) {
  for (const nextStatus of statuses) {
    const detail = await adminOrderService.getByPublicReference(
      owner,
      publicReference,
    );
    await adminOrderService.changeStatus(owner, {
      publicReference,
      nextStatus,
      expectedVersion: detail!.version,
    });
  }
}

beforeAll(async () => {
  await resetTestDatabase();
  owner = await createOwnerActor();
  operator = await createOperatorActor();
});

beforeEach(async () => {
  await client.unsafe(`TRUNCATE TABLE ${OPERATIONS_TABLES.join(", ")} CASCADE`);
});

describe("purchase posting", () => {
  it("creates the document, stock-in movement, average cost, payable and audit event", async () => {
    const result = await purchaseService.post(
      owner,
      purchase({ paidAgorot: 1_000 }),
    );
    expect(result.totalAgorot).toBe(4_000);
    expect(result.replayed).toBe(false);

    const item = await itemFor(CLEANER);
    expect(item).toMatchObject({
      onHandMilli: 10_000,
      reservedMilli: 0,
      stockValueAgorot: 4_000,
      avgCostAgorot: 400,
      lastPurchaseCostAgorot: 400,
      lastMovementReason: "purchase_receipt",
    });

    const movements = await db.select().from(stockMovements);
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      reason: "purchase_receipt",
      qtyDeltaMilli: 10_000,
      valueDeltaAgorot: 4_000,
      onHandAfterMilli: 10_000,
      valueAfterAgorot: 4_000,
      avgCostAfterAgorot: 400,
    });

    const ledger = await db.select().from(supplierLedgerEntries);
    expect(ledger.map((entry) => entry.amountAgorot).sort()).toEqual([
      -1_000, 4_000,
    ]);
    const [supplier] = await supplierService.list(owner);
    expect(supplier?.balanceAgorot).toBe(3_000);

    const audit = await db
      .select()
      .from(adminAuditEvents)
      .where(eq(adminAuditEvents.actionType, "purchase_post"));
    expect(audit).toHaveLength(1);
  });

  it("recomputes the weighted average on a second receipt and queues a price review", async () => {
    await purchaseService.post(owner, purchase());
    const second = await purchaseService.post(
      owner,
      purchase({
        lines: [
          {
            variantId: CLEANER,
            unit: "carton",
            quantityMilli: 1_000,
            packQuantity: 10,
            unitCostAgorot: 6_000,
            lineDiscountAgorot: 0,
          },
        ],
      }),
    );
    const item = await itemFor(CLEANER);
    expect(item).toMatchObject({
      onHandMilli: 20_000,
      stockValueAgorot: 10_000,
      avgCostAgorot: 500,
      lastPurchaseCostAgorot: 600,
    });
    expect(second.lines[0]?.comparison).toMatchObject({
      previousCostAgorot: 400,
      newCostAgorot: 600,
      costChangeBasisPoints: 5_000,
      salePriceAgorot: 700,
      profitAgorot: 100,
    });
    const reviews = await db.select().from(priceReviews);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({
      previousCostAgorot: 400,
      newCostAgorot: 600,
      status: "pending",
    });
  });

  it("replays the same idempotency key without posting twice", async () => {
    const input = purchase();
    const first = await purchaseService.post(owner, input);
    const replay = await purchaseService.post(owner, input);
    expect(replay).toMatchObject({
      invoiceId: first.invoiceId,
      replayed: true,
    });
    expect((await itemFor(CLEANER))?.onHandMilli).toBe(10_000);
    expect(await db.select().from(stockMovements)).toHaveLength(1);
  });

  it("rejects a second invoice with the same supplier reference", async () => {
    await purchaseService.post(owner, purchase({ reference: "A-100" }));
    await expect(
      purchaseService.post(owner, purchase({ reference: "a 100" })),
    ).rejects.toMatchObject({ code: "duplicate_invoice" });
    expect((await itemFor(CLEANER))?.onHandMilli).toBe(10_000);
  });

  it("asks for acknowledgement when an unreferenced invoice looks repeated", async () => {
    await purchaseService.post(owner, purchase({ reference: undefined }));
    const repeated = purchase({ reference: undefined });
    await expect(purchaseService.post(owner, repeated)).rejects.toMatchObject({
      code: "possible_duplicate",
    });
    await purchaseService.post(owner, {
      ...repeated,
      acknowledgeDuplicate: true,
    });
    expect((await itemFor(CLEANER))?.onHandMilli).toBe(20_000);
  });

  it("previews the impact without writing anything", async () => {
    const preview = await purchaseService.preview(owner, purchase());
    expect(preview.totals.totalAgorot).toBe(4_000);
    expect(preview.lines[0]).toMatchObject({
      tracked: false,
      onHandBeforeMilli: 0,
      onHandAfterMilli: 10_000,
    });
    expect(preview.supplierBalance).toEqual({
      beforeAgorot: 0,
      afterAgorot: 4_000,
    });
    expect(await itemFor(CLEANER)).toBeNull();
    expect(await db.select().from(stockMovements)).toHaveLength(0);
  });

  it("rejects invalid totals, unknown products and future dates", async () => {
    await expect(
      purchaseService.post(owner, purchase({ paidAgorot: 9_999 })),
    ).rejects.toMatchObject({ code: "paid_exceeds_total" });
    await expect(
      purchaseService.post(
        owner,
        purchase({
          lines: [
            {
              variantId: "missing--default",
              unit: "piece",
              quantityMilli: 1_000,
              packQuantity: 1,
              unitCostAgorot: 100,
              lineDiscountAgorot: 0,
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "variant_not_found" });
    await expect(
      purchaseService.post(owner, purchase({ invoiceDate: "2999-01-01" })),
    ).rejects.toBeInstanceOf(PurchaseError);
    expect(await db.select().from(stockMovements)).toHaveLength(0);
  });
});

describe("order integration", () => {
  it("passes untracked variants through without reservations", async () => {
    const reference = await placeOrder(2);
    await advance(reference, "confirmed");
    expect(await db.select().from(stockReservations)).toHaveLength(0);
    const detail = await adminOrderService.getByPublicReference(
      owner,
      reference,
    );
    expect(detail?.items[0]?.stock).toEqual({
      tracked: false,
      availableMilli: null,
      reservation: null,
    });
  });

  it("reserves stock when an order is confirmed", async () => {
    await purchaseService.post(owner, purchase());
    const reference = await placeOrder(3);
    await advance(reference, "confirmed");

    expect(await itemFor(CLEANER)).toMatchObject({
      onHandMilli: 10_000,
      reservedMilli: 3_000,
      stockValueAgorot: 4_000,
    });
    const reservations = await db.select().from(stockReservations);
    expect(reservations).toHaveLength(1);
    expect(reservations[0]).toMatchObject({
      quantityMilli: 3_000,
      status: "active",
    });
    const detail = await adminOrderService.getByPublicReference(
      owner,
      reference,
    );
    expect(detail?.items[0]?.stock).toEqual({
      tracked: true,
      availableMilli: 7_000,
      reservation: "active",
    });
  });

  it("releases the reservation when the order is cancelled", async () => {
    await purchaseService.post(owner, purchase());
    const reference = await placeOrder(3);
    await advance(reference, "confirmed", "preparing", "cancelled");

    expect(await itemFor(CLEANER)).toMatchObject({
      onHandMilli: 10_000,
      reservedMilli: 0,
      stockValueAgorot: 4_000,
    });
    const [reservation] = await db.select().from(stockReservations);
    expect(reservation?.status).toBe("released");
    const reasons = (await db.select().from(stockMovements)).map(
      (movement) => movement.reason,
    );
    expect(reasons.sort()).toEqual([
      "order_reservation",
      "purchase_receipt",
      "reservation_release",
    ]);
  });

  it("deducts stock with a cost snapshot when the order is delivered", async () => {
    await purchaseService.post(owner, purchase());
    const reference = await placeOrder(3);
    await advance(
      reference,
      "confirmed",
      "preparing",
      "out_for_delivery",
      "delivered",
    );

    expect(await itemFor(CLEANER)).toMatchObject({
      onHandMilli: 7_000,
      reservedMilli: 0,
      stockValueAgorot: 2_800,
      avgCostAgorot: 400,
      lastSalePriceAgorot: 700,
    });
    const [fulfilment] = await db
      .select()
      .from(stockMovements)
      .where(eq(stockMovements.reason, "order_fulfillment"));
    expect(fulfilment).toMatchObject({
      qtyDeltaMilli: -3_000,
      reservedDeltaMilli: -3_000,
      valueDeltaAgorot: -1_200,
      unitCostAgorot: 400,
    });

    // A later, more expensive purchase must not change the recorded cost of the delivered order.
    await purchaseService.post(
      owner,
      purchase({
        lines: [
          {
            variantId: CLEANER,
            unit: "piece",
            quantityMilli: 7_000,
            packQuantity: 1,
            unitCostAgorot: 900,
            lineDiscountAgorot: 0,
          },
        ],
      }),
    );
    const [unchanged] = await db
      .select()
      .from(stockMovements)
      .where(eq(stockMovements.reason, "order_fulfillment"));
    expect(unchanged?.valueDeltaAgorot).toBe(-1_200);
  });

  it("refuses to confirm an order that exceeds available stock and leaves it pending", async () => {
    await purchaseService.post(
      owner,
      purchase({
        lines: [
          {
            variantId: CLEANER,
            unit: "piece",
            quantityMilli: 3_000,
            packQuantity: 1,
            unitCostAgorot: 400,
            lineDiscountAgorot: 0,
          },
        ],
      }),
    );
    // Checkout checks free stock: 4 of 3 pieces is refused before an order exists.
    await expect(placeOrder(4)).rejects.toMatchObject({
      code: "insufficient_stock",
    });
    const reference = await placeOrder(3);
    // Stock falls after the order was placed; confirmation re-checks under lock.
    await inventoryService.adjust(owner, {
      idempotencyKey: crypto.randomUUID(),
      variantId: CLEANER,
      reason: "damaged",
      quantityMilli: 1_000,
    });
    const pending = await adminOrderService.getByPublicReference(
      owner,
      reference,
    );
    await expect(
      adminOrderService.changeStatus(owner, {
        publicReference: reference,
        nextStatus: "confirmed",
        expectedVersion: pending!.version,
      }),
    ).rejects.toMatchObject({ code: "insufficient_stock" });

    const after = await adminOrderService.getByPublicReference(
      owner,
      reference,
    );
    expect(after).toMatchObject({
      status: "pending",
      version: pending!.version,
    });
    expect(after?.history).toHaveLength(0);
    expect((await itemFor(CLEANER))?.reservedMilli).toBe(0);
  });

  it("lets only one of two concurrent confirmations take the last units", async () => {
    await purchaseService.post(
      owner,
      purchase({
        lines: [
          {
            variantId: CLEANER,
            unit: "piece",
            quantityMilli: 3_000,
            packQuantity: 1,
            unitCostAgorot: 400,
            lineDiscountAgorot: 0,
          },
        ],
      }),
    );
    const references = [await placeOrder(2), await placeOrder(2)];
    const results = await Promise.allSettled(
      references.map((publicReference) =>
        adminOrderService.changeStatus(owner, {
          publicReference,
          nextStatus: "confirmed",
          expectedVersion: 1,
        }),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(
      AdminOrderError,
    );
    expect(await itemFor(CLEANER)).toMatchObject({
      onHandMilli: 3_000,
      reservedMilli: 2_000,
    });
  });

  it("delivers orders confirmed before stock tracking without fabricating movements", async () => {
    const reference = await placeOrder(2);
    await advance(reference, "confirmed");
    await purchaseService.post(owner, purchase());
    await advance(reference, "preparing", "out_for_delivery", "delivered");

    expect(await itemFor(CLEANER)).toMatchObject({
      onHandMilli: 10_000,
      reservedMilli: 0,
    });
    expect(
      await db
        .select()
        .from(stockMovements)
        .where(eq(stockMovements.reason, "order_fulfillment")),
    ).toHaveLength(0);
  });
});

describe("ledger integrity", () => {
  it("rejects direct balance updates and movement edits", async () => {
    await purchaseService.post(owner, purchase());
    await expect(
      db.update(inventoryItems).set({ onHandMilli: 99_000 }),
    ).rejects.toBeDefined();
    await expect(
      db.update(stockMovements).set({ qtyDeltaMilli: 1 }),
    ).rejects.toBeDefined();
    await expect(db.delete(stockMovements)).rejects.toBeDefined();
    expect((await itemFor(CLEANER))?.onHandMilli).toBe(10_000);
  });

  it("keeps the projection equal to the sum of the movements", async () => {
    await purchaseService.post(owner, purchase());
    const reference = await placeOrder(4);
    await advance(
      reference,
      "confirmed",
      "preparing",
      "out_for_delivery",
      "delivered",
    );
    await inventoryService.adjust(owner, {
      idempotencyKey: crypto.randomUUID(),
      variantId: CLEANER,
      reason: "damaged",
      quantityMilli: 1_000,
    });

    const [sums] = await db
      .select({
        onHand: sql<number>`sum(${stockMovements.qtyDeltaMilli})::int`,
        reserved: sql<number>`sum(${stockMovements.reservedDeltaMilli})::int`,
        value: sql<number>`sum(${stockMovements.valueDeltaAgorot})::int`,
      })
      .from(stockMovements);
    const item = await itemFor(CLEANER);
    expect(item).toMatchObject({
      onHandMilli: sums!.onHand,
      reservedMilli: sums!.reserved,
      stockValueAgorot: sums!.value,
    });
    expect(item?.onHandMilli).toBe(5_000);
    expect(item?.stockValueAgorot).toBe(2_000);
  });
});

describe("stock adjustments", () => {
  it("requires a cost for an opening balance", async () => {
    await expect(
      inventoryService.adjust(owner, {
        idempotencyKey: crypto.randomUUID(),
        variantId: BLEACH,
        reason: "opening_balance",
        quantityMilli: 5_000,
      }),
    ).rejects.toMatchObject({ code: "cost_required" });

    await inventoryService.adjust(owner, {
      idempotencyKey: crypto.randomUUID(),
      variantId: BLEACH,
      reason: "opening_balance",
      quantityMilli: 5_000,
      unitCostAgorot: 550,
    });
    expect(await itemFor(BLEACH)).toMatchObject({
      onHandMilli: 5_000,
      stockValueAgorot: 2_750,
      avgCostAgorot: 550,
    });
  });

  it("sets the counted quantity on a correction and is idempotent", async () => {
    await purchaseService.post(owner, purchase());
    const input = {
      idempotencyKey: crypto.randomUUID(),
      variantId: CLEANER,
      reason: "correction" as const,
      quantityMilli: 8_000,
    };
    const first = await inventoryService.adjust(owner, input);
    const replay = await inventoryService.adjust(owner, input);
    expect(first).toEqual({ onHandMilli: 8_000, replayed: false });
    expect(replay).toEqual({ onHandMilli: 8_000, replayed: true });
    expect(await itemFor(CLEANER)).toMatchObject({
      onHandMilli: 8_000,
      stockValueAgorot: 3_200,
    });
    await expect(
      inventoryService.adjust(owner, {
        ...input,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toBeInstanceOf(InventoryError);
  });

  it("cannot remove stock that is reserved for an order", async () => {
    await purchaseService.post(owner, purchase());
    const reference = await placeOrder(9);
    await advance(reference, "confirmed");
    await expect(
      inventoryService.adjust(owner, {
        idempotencyKey: crypto.randomUUID(),
        variantId: CLEANER,
        reason: "damaged",
        quantityMilli: 2_000,
      }),
    ).rejects.toMatchObject({ code: "insufficient_stock" });
    expect((await itemFor(CLEANER))?.onHandMilli).toBe(10_000);
  });
});

describe("authorization boundaries", () => {
  it("lets the operator record purchases but hides costs and balances", async () => {
    await purchaseService.post(operator, purchase());
    const stock = await inventoryService.listStock(operator);
    const cleaner = stock.find((row) => row.variantId === CLEANER);
    expect(cleaner).toMatchObject({
      onHandMilli: 10_000,
      avgCostAgorot: null,
      stockValueAgorot: null,
      unitProfitAgorot: null,
    });
    expect(
      (await inventoryService.getOverview(operator)).inventoryValueAgorot,
    ).toBeNull();
    expect((await supplierService.list(operator))[0]?.balanceAgorot).toBeNull();
    expect((await purchaseService.list(operator))[0]?.totalAgorot).toBeNull();

    const ownerView = (await inventoryService.listStock(owner)).find(
      (row) => row.variantId === CLEANER,
    );
    expect(ownerView).toMatchObject({
      avgCostAgorot: 400,
      stockValueAgorot: 4_000,
      unitProfitAgorot: 300,
    });
  });

  it("blocks operator adjustments, Excel imports and supplier payments", async () => {
    await expect(
      inventoryService.adjust(operator, {
        idempotencyKey: crypto.randomUUID(),
        variantId: CLEANER,
        reason: "opening_balance",
        quantityMilli: 1_000,
        unitCostAgorot: 100,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      purchaseService.post(operator, purchase({ source: "excel" })),
    ).rejects.toBeInstanceOf(AuthorizationError);

    await purchaseService.post(owner, purchase());
    const [supplier] = await supplierService.list(owner);
    await expect(
      supplierService.recordPayment(operator, {
        supplierId: supplier!.id,
        amountAgorot: 100,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      inventoryService.listStock({ ...owner, active: false }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("records supplier payments idempotently and never below zero", async () => {
    await purchaseService.post(owner, purchase());
    const [supplier] = await supplierService.list(owner);
    const payment = {
      supplierId: supplier!.id,
      amountAgorot: 1_500,
      idempotencyKey: crypto.randomUUID(),
    };
    expect(await supplierService.recordPayment(owner, payment)).toEqual({
      balanceAgorot: 2_500,
      replayed: false,
    });
    expect(await supplierService.recordPayment(owner, payment)).toEqual({
      balanceAgorot: 2_500,
      replayed: true,
    });
    await expect(
      supplierService.recordPayment(owner, {
        ...payment,
        amountAgorot: 9_000,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toBeInstanceOf(SupplierError);
  });
});
