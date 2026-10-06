import { eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AdminDashboardService } from "@/features/admin/application/admin-dashboard-service";
import { AdminOrderService } from "@/features/admin/application/admin-order-service";
import { AdminSearchService } from "@/features/admin/application/admin-search-service";
import { AdminTodayService } from "@/features/admin/application/admin-today-service";
import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { InventoryService } from "@/features/inventory/application/inventory-service";
import { OrderService } from "@/features/orders/application/order-service";
import { PurchaseService } from "@/features/purchasing/application/purchase-service";
import { SupplierService } from "@/features/purchasing/application/supplier-service";
import { ReportService } from "@/features/reports/application/report-service";
import { CustomerService } from "@/features/sales/application/customer-service";
import { SalesService } from "@/features/sales/application/sales-service";
import * as schema from "@/server/db/schema";
import { startOfStoreDay, todayInStoreZone } from "@/shared/lib/store-time";
import {
  resetTestDatabase,
  testDatabaseConnection,
} from "@/test/test-database";

import {
  checkoutRequest,
  createOperatorActor,
  createOwnerActor,
  OPERATIONS_TABLES,
} from "./support";

const { db, client } = testDatabaseConnection;
const orders = new OrderService(db);
const adminOrders = new AdminOrderService(db);
const inventory = new InventoryService(db);
const customers = new CustomerService(db);
const sales = new SalesService(db);
const purchases = new PurchaseService(db);
const suppliers = new SupplierService(db);
const reports = new ReportService(db, customers, inventory);
const today = new AdminTodayService({
  dashboard: new AdminDashboardService(db),
  orders: adminOrders,
  sales,
  purchases,
  inventory,
  reports,
});
const search = new AdminSearchService({
  orders: adminOrders,
  inventory,
  customers,
  sales,
  suppliers,
});

let owner: AdminActor;
let operator: AdminActor;

async function stockIn(quantityMilli: number, cost: number) {
  await purchases.post(owner, {
    idempotencyKey: crypto.randomUUID(),
    supplierName: "مورد اليوم",
    reference: crypto.randomUUID().slice(0, 8),
    invoiceDate: todayInStoreZone(),
    source: "manual",
    lines: [
      {
        variantId: "general-cleaner--default",
        unit: "piece",
        quantityMilli,
        packQuantity: 1,
        unitCostAgorot: cost,
        lineDiscountAgorot: 0,
      },
    ],
    discountAgorot: 0,
    taxAgorot: null,
    printedTotalAgorot: null,
    paidAgorot: 0,
    acknowledgeDuplicate: false,
  });
}

async function cashSale(quantityMilli: number, price: number) {
  return sales.post(owner, {
    idempotencyKey: crypto.randomUUID(),
    customerId: undefined,
    source: "manual",
    lines: [
      {
        variantId: "general-cleaner--default",
        quantityMilli,
        unitPriceAgorot: price,
      },
    ],
    discountAgorot: 0,
    paidAgorot: (quantityMilli / 1_000) * price,
  });
}

beforeAll(async () => {
  await resetTestDatabase();
  owner = await createOwnerActor();
  operator = await createOperatorActor();
});

beforeEach(async () => {
  await client.unsafe(`TRUNCATE TABLE ${OPERATIONS_TABLES.join(", ")} CASCADE`);
});

describe("today", () => {
  it("counts today's orders, money, feed and overdue alerts from the services themselves", async () => {
    await stockIn(10_000, 300);
    const sale = await cashSale(2_000, 700);
    const order = await orders.create(
      checkoutRequest([{ productId: "general-cleaner", quantity: 1 }]),
    );

    const view = await today.getToday(owner);
    expect(view.date).toBe(todayInStoreZone());
    expect(view.ordersToday).toBe(1);
    expect(view.needsAction).toBe(1);
    // 2 × 7 ₪ sold, 2 × 3 ₪ cost: the report's own figures, not recomputed here.
    expect(await today.getMoney(owner)).toEqual({
      netSalesAgorot: 1_400,
      grossProfitAgorot: 800,
      costComplete: true,
    });
    expect(view.tasks.map((task) => task.kind).sort()).toEqual([
      "order",
      "purchase",
      "sale",
    ]);
    expect(view.tasks[0]!.at >= view.tasks.at(-1)!.at).toBe(true);
    expect(view.tasks.find((task) => task.kind === "sale")).toMatchObject({
      title: `فاتورة بيع ${sale.invoiceNumber}`,
      detail: "بيع نقدي بدون اسم",
      href: `/admin/sales/${sale.invoiceId}`,
    });
    expect(view.tasks.find((task) => task.kind === "order")).toMatchObject({
      href: `/admin/orders/${order.publicReference}`,
      badge: { label: "جديد", tone: "warning" },
    });
    // Fresh orders are not overdue yet.
    expect(view.alerts.map((alert) => alert.id)).not.toContain(
      "pending_overdue",
    );

    await db
      .update(schema.orders)
      .set({ createdAt: new Date(Date.now() - 45 * 60_000) })
      .where(eq(schema.orders.publicReference, order.publicReference));
    const later = await today.getToday(owner);
    expect(later.alerts).toContainEqual(
      expect.objectContaining({ id: "pending_overdue", count: 1 }),
    );
  });

  it("uses the store day: an order from one minute before midnight is not today's", async () => {
    const order = await orders.create(
      checkoutRequest([{ productId: "general-cleaner", quantity: 1 }]),
    );
    const startOfToday = startOfStoreDay(todayInStoreZone());
    await db
      .update(schema.orders)
      .set({ createdAt: new Date(startOfToday.getTime() - 60_000) })
      .where(eq(schema.orders.publicReference, order.publicReference));
    const view = await today.getToday(owner);
    expect(view.ordersToday).toBe(0);
    expect(view.tasks).toEqual([]);
    // Still waiting, so it remains in the needs-action count and list.
    expect(view.needsAction).toBe(1);
  });

  it("shows the operator no sales or profit figures", async () => {
    await stockIn(5_000, 300);
    await cashSale(1_000, 700);
    const view = await today.getToday(operator);
    expect(await today.getMoney(operator)).toBeNull();
    expect(view.tasks.map((task) => task.kind)).toContain("sale");
  });

  it("raises an out-of-stock alert once the last piece is sold", async () => {
    await stockIn(1_000, 300);
    expect(await today.getStockAlerts(owner)).toEqual([]);
    await cashSale(1_000, 700);
    expect(await today.getStockAlerts(owner)).toContainEqual(
      expect.objectContaining({ id: "out_of_stock", count: 1 }),
    );
  });

  it("refuses an inactive account", async () => {
    await expect(today.getToday({ ...owner, active: false })).rejects.toThrow();
  });
});

describe("global search", () => {
  it("groups products, orders, customers, invoices and suppliers", async () => {
    await stockIn(5_000, 300);
    const sale = await cashSale(1_000, 700);
    const order = await orders.create(
      checkoutRequest([{ productId: "general-cleaner", quantity: 1 }]),
    );
    const customer = await customers.create(owner, { name: "سعاد البحث" });
    const supplier = await suppliers.create(owner, { nameAr: "شركة الندى" });

    const keys = async (query: string) =>
      (await search.search(owner, query)).map((group) => group.key);

    const products = await search.search(owner, "منظف");
    expect(products[0]).toMatchObject({
      key: "products",
      label: "المنتجات",
    });
    expect(products[0]!.hits.map((hit) => hit.href)).toContain(
      "/admin/products/general-cleaner",
    );

    expect(await search.search(owner, order.publicReference)).toEqual([
      expect.objectContaining({
        key: "orders",
        hits: [
          expect.objectContaining({
            href: `/admin/orders/${order.publicReference}`,
          }),
        ],
      }),
    ]);
    expect(await keys("0591234567")).toContain("orders");

    const people = await search.search(owner, "سعاد");
    expect(people.find((group) => group.key === "customers")!.hits).toEqual([
      expect.objectContaining({ href: `/admin/customers/${customer.id}` }),
    ]);

    const invoices = await search.search(owner, `#${sale.invoiceNumber}`);
    expect(invoices.find((group) => group.key === "invoices")!.hits).toEqual([
      expect.objectContaining({ href: `/admin/sales/${sale.invoiceId}` }),
    ]);

    const firms = await search.search(owner, "الندى");
    expect(firms.find((group) => group.key === "suppliers")!.hits).toEqual([
      expect.objectContaining({
        href: `/admin/inventory/suppliers/${supplier.id}`,
      }),
    ]);
  });

  it("returns nothing for one letter and never searches for an inactive account", async () => {
    expect(await search.search(owner, "م")).toEqual([]);
    expect(await search.search(owner, "  ")).toEqual([]);
    await expect(
      search.search({ ...owner, active: false }, "منظف"),
    ).rejects.toThrow();
  });

  it("reads Arabic-Indic digits in phone and invoice searches", async () => {
    await stockIn(5_000, 300);
    const sale = await cashSale(1_000, 700);
    const arabic = String(sale.invoiceNumber).replace(
      /\d/g,
      (digit) => "٠١٢٣٤٥٦٧٨٩"[Number(digit)]!,
    );
    const groups = await search.search(owner, arabic);
    expect(groups.find((group) => group.key === "invoices")!.hits).toHaveLength(
      1,
    );
    expect(
      (await db.select({ n: sql<number>`1` }).from(schema.orders)).length,
    ).toBe(0);
  });
});
