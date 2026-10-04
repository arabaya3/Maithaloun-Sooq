import { and, eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AdminDashboardService } from "@/features/admin/application/admin-dashboard-service";
import {
  AdminOrderError,
  AdminOrderService,
} from "@/features/admin/application/admin-order-service";
import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { CustomerOrdersService } from "@/features/accounts/application/customer-orders-service";
import { InventoryService } from "@/features/inventory/application/inventory-service";
import {
  OrderService,
  QA_ORDER_PHONE,
} from "@/features/orders/application/order-service";
import { PurchaseService } from "@/features/purchasing/application/purchase-service";
import {
  SupplierMaintenanceError,
  SupplierMaintenanceService,
} from "@/features/purchasing/application/supplier-maintenance-service";
import { SupplierService } from "@/features/purchasing/application/supplier-service";
import { ReportService } from "@/features/reports/application/report-service";
import { CustomerService } from "@/features/sales/application/customer-service";
import {
  adminNotifications,
  orderStatusHistory,
  orders,
  stockReservations,
  supplierLedgerEntries,
} from "@/server/db/schema";
import { todayInStoreZone } from "@/shared/lib/store-time";
import {
  resetTestDatabase,
  testDatabaseConnection,
} from "@/test/test-database";

import {
  OPERATIONS_TABLES,
  checkoutRequest,
  createOwnerActor,
} from "./support";

const { db, client } = testDatabaseConnection;
const orderService = new OrderService(db);
const adminOrders = new AdminOrderService(db);
const dashboard = new AdminDashboardService(db);
const inventory = new InventoryService(db);
const reports = new ReportService(db, new CustomerService(db), inventory);
const accounts = new CustomerOrdersService(db);
const suppliers = new SupplierService(db);
const supplierMaintenance = new SupplierMaintenanceService(db);
const purchases = new PurchaseService(db);

let owner: AdminActor;

function qaRequest() {
  return {
    ...checkoutRequest([{ productId: "general-cleaner", quantity: 1 }]),
    whatsappPhoneE164: QA_ORDER_PHONE,
    normalizedPhone: QA_ORDER_PHONE,
  };
}

beforeAll(async () => {
  await resetTestDatabase();
  owner = await createOwnerActor();
});

beforeEach(async () => {
  await client.unsafe(`TRUNCATE TABLE ${OPERATIONS_TABLES.join(", ")} CASCADE`);
});

describe("owner QA orders", () => {
  it("are priced like real orders but never notified, queued, counted or claimable", async () => {
    const real = await orderService.create(
      checkoutRequest([{ productId: "general-cleaner", quantity: 1 }]),
    );
    const qa = await orderService.create(
      qaRequest(),
      { customerAccountId: null },
      { test: true },
    );

    const [stored] = await db
      .select()
      .from(orders)
      .where(eq(orders.publicReference, qa.publicReference));
    expect(stored).toMatchObject({
      isTest: true,
      normalizedPhone: QA_ORDER_PHONE,
      whatsappPhoneE164: null,
    });
    expect(stored!.finalTotalAgorot).toBe(real.finalTotalAgorot);

    const notified = await db
      .select({ orderId: adminNotifications.orderId })
      .from(adminNotifications);
    expect(notified.map((row) => row.orderId)).not.toContain(stored!.id);
    expect(notified).toHaveLength(1);

    const queue = await adminOrders.list(owner, { page: 1 });
    expect(queue.items.map((item) => item.publicReference)).toEqual([
      real.publicReference,
    ]);
    expect((await adminOrders.countByStatus(owner)).pending).toBe(1);
    expect(
      (await adminOrders.listActionable(owner)).map(
        (item) => item.publicReference,
      ),
    ).toEqual([real.publicReference]);
    expect((await dashboard.getSummary(owner)).orders.pending).toBe(1);

    const testList = await adminOrders.list(owner, { page: 1, test: true });
    expect(testList.items.map((item) => item.publicReference)).toEqual([
      qa.publicReference,
    ]);
    expect(
      (await adminOrders.getByPublicReference(owner, qa.publicReference))!
        .isTest,
    ).toBe(true);

    expect(await accounts.claimableCount(QA_ORDER_PHONE)).toBe(0);
  });

  it("can only be cancelled, so stock is never reserved or deducted", async () => {
    const qa = await orderService.create(
      qaRequest(),
      { customerAccountId: null },
      { test: true },
    );
    const detail = (await adminOrders.getByPublicReference(
      owner,
      qa.publicReference,
    ))!;
    await expect(
      adminOrders.changeStatus(owner, {
        publicReference: qa.publicReference,
        nextStatus: "confirmed",
        expectedVersion: detail.version,
      }),
    ).rejects.toBeInstanceOf(AdminOrderError);
    expect(await db.select().from(stockReservations)).toHaveLength(0);

    await adminOrders.changeStatus(owner, {
      publicReference: qa.publicReference,
      nextStatus: "cancelled",
      expectedVersion: detail.version,
    });
    expect(
      (await adminOrders.getByPublicReference(owner, qa.publicReference))!
        .status,
    ).toBe("cancelled");
  });

  it("is enforced by the database, and public checkout cannot create one", async () => {
    const qa = await orderService.create(
      qaRequest(),
      { customerAccountId: null },
      { test: true },
    );
    await expect(
      db
        .update(orders)
        .set({ status: "delivered" })
        .where(eq(orders.publicReference, qa.publicReference)),
    ).rejects.toThrow();
    // A real order may not borrow the QA marker instead of a phone.
    await expect(orderService.create(qaRequest())).rejects.toMatchObject({
      code: "database_error",
    });
    const real = await orderService.create(
      checkoutRequest([{ productId: "general-cleaner", quantity: 1 }]),
    );
    const [row] = await db
      .select({ isTest: orders.isTest })
      .from(orders)
      .where(eq(orders.publicReference, real.publicReference));
    expect(row!.isTest).toBe(false);
  });

  it("is left out of sales reports even if history claims it was delivered", async () => {
    const qa = await orderService.create(
      qaRequest(),
      { customerAccountId: null },
      { test: true },
    );
    const [stored] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.publicReference, qa.publicReference));
    await db.insert(orderStatusHistory).values({
      orderId: stored!.id,
      previousStatus: "pending",
      newStatus: "delivered",
      adminUserId: owner.id,
    });
    const today = todayInStoreZone();
    const report = await reports.getReport(owner, { from: today, to: today });
    expect(report.metrics.orderCount).toBe(0);
    expect(report.metrics.grossSalesAgorot).toBe(0);
    expect(report.metrics.cashCollectedAgorot).toBe(0);
  });
});

describe("supplier credit notes", () => {
  async function supplierWithPayable(amountAgorot: number) {
    await purchases.post(owner, {
      idempotencyKey: crypto.randomUUID(),
      supplierName: "مورد الإشعارات",
      reference: crypto.randomUUID().slice(0, 8),
      invoiceDate: todayInStoreZone(),
      source: "manual",
      lines: [
        {
          variantId: "general-cleaner--default",
          unit: "piece",
          quantityMilli: 1_000,
          packQuantity: 1,
          unitCostAgorot: amountAgorot,
          lineDiscountAgorot: 0,
        },
      ],
      discountAgorot: 0,
      taxAgorot: null,
      printedTotalAgorot: null,
      paidAgorot: 0,
      acknowledgeDuplicate: false,
    });
    const supplier = (await suppliers.list(owner)).find(
      (row) => row.nameAr === "مورد الإشعارات",
    )!;
    return supplier.id;
  }

  it("reduces the payable once, shows in the statement and cannot exceed what is owed", async () => {
    const supplierId = await supplierWithPayable(5_000);
    const key = crypto.randomUUID();
    const input = {
      supplierId,
      amountAgorot: 1_200,
      reference: "CN-77",
      reason: "بضاعة مرتجعة",
      idempotencyKey: key,
    };
    expect(await supplierMaintenance.creditNote(owner, input)).toEqual({
      balanceAgorot: 3_800,
      replayed: false,
    });
    expect(await supplierMaintenance.creditNote(owner, input)).toEqual({
      balanceAgorot: 3_800,
      replayed: true,
    });
    await expect(
      supplierMaintenance.creditNote(owner, {
        ...input,
        amountAgorot: 3_801,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toBeInstanceOf(SupplierMaintenanceError);

    const today = todayInStoreZone();
    const statement = await supplierMaintenance.statement(
      supplierId,
      today,
      today,
    );
    expect(statement.closingAgorot).toBe(3_800);
    expect(statement.lines.at(-1)).toMatchObject({
      label: "إشعار دائن CN-77",
      amountAgorot: -1_200,
    });
  });

  it("is refused by the database when it would increase the payable", async () => {
    const supplierId = await supplierWithPayable(1_000);
    await expect(
      db.insert(supplierLedgerEntries).values({
        supplierId,
        type: "correction",
        amountAgorot: 500,
        documentKind: "credit_note",
        documentReference: "CN-1",
        idempotencyKey: `credit-note:${crypto.randomUUID()}`,
        createdBy: owner.id,
      }),
    ).rejects.toThrow();
    const [row] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(supplierLedgerEntries)
      .where(
        and(
          eq(supplierLedgerEntries.supplierId, supplierId),
          eq(supplierLedgerEntries.documentKind, "credit_note"),
        ),
      );
    expect(row!.total).toBe(0);
  });

  it("archives and restores a supplier", async () => {
    const supplierId = await supplierWithPayable(1_000);
    await supplierMaintenance.setActive(owner, supplierId, false);
    expect(
      (await suppliers.list(owner)).find((row) => row.id === supplierId)!
        .active,
    ).toBe(false);
    await supplierMaintenance.setActive(owner, supplierId, true);
    expect(
      (await suppliers.list(owner)).find((row) => row.id === supplierId)!
        .active,
    ).toBe(true);
  });
});
