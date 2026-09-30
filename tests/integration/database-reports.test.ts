import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AdminOrderService } from "@/features/admin/application/admin-order-service";
import {
  AuthorizationError,
  type AdminActor,
} from "@/features/admin/domain/admin-actor";
import { InventoryService } from "@/features/inventory/application/inventory-service";
import { OrderService } from "@/features/orders/application/order-service";
import { PurchaseService } from "@/features/purchasing/application/purchase-service";
import { ReportService } from "@/features/reports/application/report-service";
import { CustomerService } from "@/features/sales/application/customer-service";
import { SalesService } from "@/features/sales/application/sales-service";
import { todayInStoreZone } from "@/shared/lib/store-time";
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
const purchaseService = new PurchaseService(db);
const salesService = new SalesService(db);
const customerService = new CustomerService(db);
const inventoryService = new InventoryService(db);
const orderService = new OrderService(db);
const adminOrderService = new AdminOrderService(db);
const reportService = new ReportService(db, customerService, inventoryService);
const CLEANER = "general-cleaner--default";
const BLEACH = "dolphin-bleach--default";

let owner: AdminActor;
let operator: AdminActor;
const today = todayInStoreZone();
const period = { from: today, to: today };

beforeAll(async () => {
  await resetTestDatabase();
  owner = await createOwnerActor();
  operator = await createOperatorActor();
});

beforeEach(async () => {
  await client.unsafe(`TRUNCATE TABLE ${OPERATIONS_TABLES.join(", ")} CASCADE`);
});

async function seedActivity() {
  await purchaseService.post(owner, {
    idempotencyKey: crypto.randomUUID(),
    supplierName: "مورد الاختبار",
    reference: "R-1",
    invoiceDate: today,
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
  });

  // Manual cash sale with a discount: 2 × 7.00 − 1.00.
  await salesService.post(owner, {
    idempotencyKey: crypto.randomUUID(),
    source: "manual",
    lines: [{ variantId: CLEANER, quantityMilli: 2_000, unitPriceAgorot: 700 }],
    discountAgorot: 100,
    paidAgorot: 1_300,
  });
  // Credit sale of an untracked product: revenue without a recorded cost.
  await salesService.post(owner, {
    idempotencyKey: crypto.randomUUID(),
    customerName: "زبون التقرير",
    source: "manual",
    lines: [{ variantId: BLEACH, quantityMilli: 1_000, unitPriceAgorot: 800 }],
    discountAgorot: 0,
    paidAgorot: 300,
  });
  // A sale that is cancelled the same day.
  const cancelled = await salesService.post(owner, {
    idempotencyKey: crypto.randomUUID(),
    source: "manual",
    lines: [{ variantId: CLEANER, quantityMilli: 1_000, unitPriceAgorot: 700 }],
    discountAgorot: 0,
    paidAgorot: 700,
  });
  await salesService.cancelInvoice(owner, {
    invoiceId: cancelled.invoiceId,
    reason: "إرجاع",
  });

  // Storefront order: 3 × 7.00 plus a 5.00 delivery fee, delivered.
  const order = await orderService.create(
    checkoutRequest([{ productId: "general-cleaner", quantity: 3 }]),
  );
  for (const nextStatus of [
    "confirmed",
    "preparing",
    "out_for_delivery",
    "delivered",
  ] as const) {
    const detail = await adminOrderService.getByPublicReference(
      owner,
      order.publicReference,
    );
    await adminOrderService.changeStatus(owner, {
      publicReference: order.publicReference,
      nextStatus,
      expectedVersion: detail!.version,
    });
  }
  await inventoryService.adjust(owner, {
    idempotencyKey: crypto.randomUUID(),
    variantId: CLEANER,
    reason: "damaged",
    quantityMilli: 1_000,
  });
}

describe("report queries", () => {
  it("computes the period metrics from the ledgers", async () => {
    await seedActivity();
    const report = await reportService.getReport(owner, period);

    expect(report.metrics).toEqual({
      grossSalesAgorot: 1_400 + 800 + 700 + 2_100,
      discountsAgorot: 100,
      returnsAgorot: 700,
      netSalesAgorot: 4_200,
      cogsAgorot: 800 + 1_200,
      costedSalesAgorot: 3_400,
      uncostedSalesAgorot: 800,
      grossProfitAgorot: 1_400,
      grossMarginBasisPoints: 4_118,
      costComplete: false,
      orderCount: 3,
      averageOrderValueAgorot: 1_400,
      unitsSoldMilli: 6_000,
      stockTurnoverBasisPoints: 12_500,
      cashCollectedAgorot: 1_300 + 300 + 700 - 700 + 2_600,
      creditSalesAgorot: 500,
      outstandingBalancesAgorot: 500,
      purchasesAgorot: 4_000,
      inventoryValueAgorot: 1_600,
      shrinkageAgorot: 400,
    });
    expect(report.deliveryFeesAgorot).toBe(500);
    expect(report.channels).toEqual([
      {
        channel: "storefront",
        orderCount: 1,
        netSalesAgorot: 2_100,
        grossProfitAgorot: 900,
      },
      {
        channel: "manual",
        orderCount: 2,
        netSalesAgorot: 2_100,
        grossProfitAgorot: 500,
      },
    ]);
    expect(report.byQuantity[0]).toMatchObject({
      productKey: CLEANER,
      quantityMilli: 5_000,
    });
    expect(report.byProfit).toHaveLength(1);
  });

  it("does not let a later, more expensive purchase rewrite past profit", async () => {
    await seedActivity();
    const before = await reportService.getReport(owner, period);
    await purchaseService.post(owner, {
      idempotencyKey: crypto.randomUUID(),
      supplierName: "مورد الاختبار",
      reference: "R-2",
      invoiceDate: today,
      source: "manual",
      lines: [
        {
          variantId: CLEANER,
          unit: "piece",
          quantityMilli: 10_000,
          packQuantity: 1,
          unitCostAgorot: 650,
          lineDiscountAgorot: 0,
        },
      ],
      discountAgorot: 0,
      taxAgorot: null,
      printedTotalAgorot: null,
      paidAgorot: 0,
      acknowledgeDuplicate: false,
    });
    const after = await reportService.getReport(owner, period);
    expect(after.metrics.cogsAgorot).toBe(before.metrics.cogsAgorot);
    expect(after.metrics.grossProfitAgorot).toBe(
      before.metrics.grossProfitAgorot,
    );
    expect(after.costChanges[0]).toMatchObject({
      previousCostAgorot: 400,
      newCostAgorot: 650,
    });
  });

  it("returns an empty, honest report for a period without activity", async () => {
    await seedActivity();
    const report = await reportService.getReport(owner, {
      from: "2020-01-01",
      to: "2020-01-31",
    });
    expect(report.metrics).toMatchObject({
      netSalesAgorot: 0,
      grossProfitAgorot: 0,
      grossMarginBasisPoints: null,
      orderCount: 0,
      averageOrderValueAgorot: null,
      costComplete: true,
    });
  });

  it("keeps profit reports owner-only while operators can list debtors", async () => {
    await seedActivity();
    await expect(
      reportService.getReport(operator, period),
    ).rejects.toBeInstanceOf(AuthorizationError);
    const debtors = await reportService.listDebtors(operator);
    expect(debtors).toEqual([
      expect.objectContaining({ name: "زبون التقرير", balanceAgorot: 500 }),
    ]);
  });
});
