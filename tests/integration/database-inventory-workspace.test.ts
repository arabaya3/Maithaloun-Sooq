import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { InventoryService } from "@/features/inventory/application/inventory-service";
import {
  PurchaseService,
  type PurchaseInput,
} from "@/features/purchasing/application/purchase-service";
import { SupplierMaintenanceService } from "@/features/purchasing/application/supplier-maintenance-service";
import { SupplierService } from "@/features/purchasing/application/supplier-service";
import {
  resetTestDatabase,
  testDatabaseConnection,
} from "@/test/test-database";

import {
  OPERATIONS_TABLES,
  createOperatorActor,
  createOwnerActor,
} from "./support";

const { db, client } = testDatabaseConnection;
const inventory = new InventoryService(db);
const purchases = new PurchaseService(db);
const suppliers = new SupplierService(db);
const maintenance = new SupplierMaintenanceService(db);

const CLEANER = "general-cleaner--default";
const BLEACH = "dolphin-bleach--default";

let owner: AdminActor;
let operator: AdminActor;

function purchase(
  lines: Array<{ variantId: string; pieces: number; costAgorot: number }>,
  overrides: Partial<PurchaseInput> = {},
): PurchaseInput {
  return {
    idempotencyKey: crypto.randomUUID(),
    supplierName: "مورد الصفحات",
    reference: `INV-${crypto.randomUUID().slice(0, 8)}`,
    invoiceDate: "2026-09-01",
    source: "manual",
    lines: lines.map((line) => ({
      variantId: line.variantId,
      unit: "piece",
      quantityMilli: line.pieces * 1_000,
      packQuantity: 1,
      unitCostAgorot: line.costAgorot,
      lineDiscountAgorot: 0,
    })),
    discountAgorot: 0,
    taxAgorot: null,
    printedTotalAgorot: null,
    paidAgorot: 0,
    acknowledgeDuplicate: false,
    ...overrides,
  };
}

beforeAll(async () => {
  await resetTestDatabase();
  owner = await createOwnerActor();
  operator = await createOperatorActor();
});

beforeEach(async () => {
  await client.unsafe(`TRUNCATE TABLE ${OPERATIONS_TABLES.join(", ")} CASCADE`);
});

describe("purchase invoice page reads the posted effect", () => {
  it("shows each line's recorded stock movement, unchanged by an idempotent replay", async () => {
    const input = purchase([
      { variantId: CLEANER, pieces: 10, costAgorot: 400 },
      { variantId: BLEACH, pieces: 4, costAgorot: 300 },
    ]);
    const first = await purchases.post(owner, input);
    const second = await purchases.post(
      owner,
      purchase([{ variantId: CLEANER, pieces: 5, costAgorot: 700 }]),
    );
    const replay = await purchases.post(owner, input);
    expect(replay).toMatchObject({
      invoiceId: first.invoiceId,
      replayed: true,
    });

    const detail = (await purchases.getDetail(owner, first.invoiceId))!;
    expect(
      detail.lines.map((line) => [line.variantId, line.stockEffect]),
    ).toEqual([
      [
        CLEANER,
        {
          addedMilli: 10_000,
          onHandAfterMilli: 10_000,
          avgCostAfterAgorot: 400,
        },
      ],
      [
        BLEACH,
        { addedMilli: 4_000, onHandAfterMilli: 4_000, avgCostAfterAgorot: 300 },
      ],
    ]);
    // The later invoice records the running balance and weighted average at its own time.
    const later = (await purchases.getDetail(owner, second.invoiceId))!;
    expect(later.lines[0]?.stockEffect).toEqual({
      addedMilli: 5_000,
      onHandAfterMilli: 15_000,
      avgCostAfterAgorot: 500,
    });
  });

  it("hides cost from an operator viewing an invoice they did not record", async () => {
    const posted = await purchases.post(
      owner,
      purchase([{ variantId: CLEANER, pieces: 2, costAgorot: 400 }]),
    );
    const detail = (await purchases.getDetail(operator, posted.invoiceId))!;
    expect(detail.lines[0]?.stockEffect).toEqual({
      addedMilli: 2_000,
      onHandAfterMilli: 2_000,
      avgCostAfterAgorot: null,
    });
  });

  it("filters the list by payment state", async () => {
    await purchases.post(
      owner,
      purchase([{ variantId: CLEANER, pieces: 1, costAgorot: 400 }]),
    );
    await purchases.post(
      owner,
      purchase([{ variantId: CLEANER, pieces: 1, costAgorot: 400 }], {
        paidAgorot: 400,
      }),
    );
    await purchases.post(
      owner,
      purchase([{ variantId: CLEANER, pieces: 2, costAgorot: 400 }], {
        paidAgorot: 300,
      }),
    );
    const states = async (
      paymentStatus?: "paid" | "unpaid" | "partially_paid",
    ) =>
      (await purchases.list(owner, 100, { paymentStatus })).map(
        (row) => row.paymentStatus,
      );
    expect(await states()).toHaveLength(3);
    expect(await states("paid")).toEqual(["paid"]);
    expect(await states("unpaid")).toEqual(["unpaid"]);
    expect(await states("partially_paid")).toEqual(["partially_paid"]);
  });
});

describe("supplier totals agree with the ledger", () => {
  it("spend is the sum of invoices and balance falls only by recorded payments", async () => {
    await purchases.post(
      owner,
      purchase([{ variantId: CLEANER, pieces: 10, costAgorot: 400 }]),
    );
    const paidInvoice = purchase(
      [{ variantId: BLEACH, pieces: 5, costAgorot: 300 }],
      { paidAgorot: 500, invoiceDate: "2026-09-03" },
    );
    await purchases.post(owner, paidInvoice);
    await purchases.post(owner, paidInvoice);

    const [supplier] = await suppliers.list(owner);
    expect(supplier).toMatchObject({
      invoiceCount: 2,
      spendAgorot: 5_500,
      balanceAgorot: 5_000,
      lastInvoiceDate: "2026-09-03",
    });

    const payment = {
      supplierId: supplier!.id,
      amountAgorot: 1_200,
      idempotencyKey: crypto.randomUUID(),
    };
    await suppliers.recordPayment(owner, payment);
    await suppliers.recordPayment(owner, payment);
    const [after] = await suppliers.list(owner);
    expect(after).toMatchObject({ spendAgorot: 5_500, balanceAgorot: 3_800 });

    // Operators see the supplier but not money.
    const [hidden] = await suppliers.list(operator);
    expect(hidden).toMatchObject({ spendAgorot: null, balanceAgorot: null });
  });

  it("lists the names a supplier uses for our products", async () => {
    await purchases.post(
      owner,
      purchase([{ variantId: CLEANER, pieces: 1, costAgorot: 400 }]),
    );
    const [supplier] = await suppliers.list(owner);
    expect(await maintenance.aliases(supplier!.id)).toEqual([]);
  });
});

describe("inventory home anomalies and stock sorting", () => {
  it("flags a sale price below average cost for cost viewers only", async () => {
    // General cleaner sells at 7 ₪; buying at 8 ₪ makes every sale a loss.
    await purchases.post(
      owner,
      purchase([
        { variantId: CLEANER, pieces: 3, costAgorot: 800 },
        { variantId: BLEACH, pieces: 9, costAgorot: 100 },
      ]),
    );
    const overview = await inventory.getOverview(owner);
    expect(overview.belowCost.map((row) => row.variantId)).toEqual([CLEANER]);
    expect(overview.belowCost[0]?.unitProfitAgorot).toBe(-100);
    expect(overview.overReserved).toEqual([]);
    expect(overview.inventoryValueAgorot).toBe(3_300);
    expect((await inventory.getOverview(operator)).belowCost).toEqual([]);

    const byAvailable = await inventory.listStock(owner, {
      filter: "tracked",
      sort: "available",
    });
    expect(byAvailable.map((row) => row.variantId)).toEqual([CLEANER, BLEACH]);
    const byValue = await inventory.listStock(owner, {
      filter: "tracked",
      sort: "value",
    });
    expect(byValue.map((row) => row.variantId)).toEqual([CLEANER, BLEACH]);
    const all = await inventory.listStock(owner, { sort: "available" });
    // Untracked items follow every tracked one.
    expect(all.slice(0, 2).every((row) => row.tracked)).toBe(true);
    expect(all.slice(2).every((row) => !row.tracked)).toBe(true);
  });
});
