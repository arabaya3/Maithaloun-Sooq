import { eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  AuthorizationError,
  type AdminActor,
} from "@/features/admin/domain/admin-actor";
import { PurchaseService } from "@/features/purchasing/application/purchase-service";
import { CustomerService } from "@/features/sales/application/customer-service";
import {
  SalesService,
  type SaleInput,
} from "@/features/sales/application/sales-service";
import {
  adminAuditEvents,
  customerInvoices,
  customerLedgerEntries,
  customerPayments,
  inventoryItems,
  productVariants,
  stockMovements,
} from "@/server/db/schema";
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
const purchaseService = new PurchaseService(db);
const salesService = new SalesService(db);
const customerService = new CustomerService(db);
const CLEANER = "general-cleaner--default";
const BLEACH = "dolphin-bleach--default";

let owner: AdminActor;
let operator: AdminActor;

async function stock(variantId: string, quantityMilli: number, cost: number) {
  await purchaseService.post(owner, {
    idempotencyKey: crypto.randomUUID(),
    supplierName: "مورد الاختبار",
    reference: crypto.randomUUID().slice(0, 8),
    invoiceDate: "2026-09-01",
    source: "manual",
    lines: [
      {
        variantId,
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

function sale(overrides: Partial<SaleInput> = {}): SaleInput {
  return {
    idempotencyKey: crypto.randomUUID(),
    source: "manual",
    lines: [{ variantId: CLEANER, quantityMilli: 2_000, unitPriceAgorot: 700 }],
    discountAgorot: 0,
    paidAgorot: 1_400,
    ...overrides,
  };
}

async function onHand(variantId: string) {
  const [row] = await db
    .select({ item: inventoryItems })
    .from(inventoryItems)
    .innerJoin(
      productVariants,
      eq(productVariants.id, inventoryItems.variantId),
    )
    .where(eq(productVariants.domainId, variantId));
  return row?.item ?? null;
}

beforeAll(async () => {
  await resetTestDatabase();
  owner = await createOwnerActor();
  operator = await createOperatorActor();
});

beforeEach(async () => {
  await client.unsafe(`TRUNCATE TABLE ${OPERATIONS_TABLES.join(", ")} CASCADE`);
});

describe("manual sale", () => {
  it("posts a cash sale with a stock-out at the recorded cost", async () => {
    await stock(CLEANER, 10_000, 400);
    const result = await salesService.post(operator, sale());
    expect(result).toMatchObject({
      totalAgorot: 1_400,
      remainingAgorot: 0,
      customerId: null,
      balanceAfterAgorot: null,
      replayed: false,
    });
    expect(result.invoiceNumber).toBeGreaterThanOrEqual(1_001);

    expect(await onHand(CLEANER)).toMatchObject({
      onHandMilli: 8_000,
      stockValueAgorot: 3_200,
      lastSalePriceAgorot: 700,
    });
    const [movement] = await db
      .select()
      .from(stockMovements)
      .where(eq(stockMovements.reason, "manual_sale"));
    expect(movement).toMatchObject({
      qtyDeltaMilli: -2_000,
      valueDeltaAgorot: -800,
      unitCostAgorot: 400,
    });
    expect(movement?.customerInvoiceLineId).not.toBeNull();

    const [invoice] = await db.select().from(customerInvoices);
    expect(invoice).toMatchObject({ cogsAgorot: 800, costComplete: true });
    expect(await db.select().from(customerLedgerEntries)).toHaveLength(0);
    const [payment] = await db.select().from(customerPayments);
    expect(payment).toMatchObject({ amountAgorot: 1_400, customerId: null });

    const detail = await salesService.getInvoice(owner, result.invoiceId);
    expect(detail?.profit).toEqual({
      complete: true,
      revenueAgorot: 1_400,
      cogsAgorot: 800,
      grossProfitAgorot: 600,
      marginBasisPoints: 4_286,
    });
    expect(
      (await salesService.getInvoice(operator, result.invoiceId))?.profit,
    ).toBeNull();
  });

  it("is idempotent for a repeated submission", async () => {
    await stock(CLEANER, 10_000, 400);
    const input = sale();
    const first = await salesService.post(owner, input);
    const replay = await salesService.post(owner, input);
    expect(replay).toMatchObject({
      invoiceId: first.invoiceId,
      replayed: true,
    });
    expect((await onHand(CLEANER))?.onHandMilli).toBe(8_000);
    expect(await db.select().from(customerInvoices)).toHaveLength(1);
  });

  it("rejects a sale that exceeds available stock and writes nothing", async () => {
    await stock(CLEANER, 1_000, 400);
    await expect(salesService.post(owner, sale())).rejects.toMatchObject({
      code: "insufficient_stock",
    });
    expect(await db.select().from(customerInvoices)).toHaveLength(0);
    expect((await onHand(CLEANER))?.onHandMilli).toBe(1_000);

    const preview = await salesService.preview(owner, sale());
    expect(preview.blocked).toBe(true);
    expect(preview.lines[0]?.insufficient).toBe(true);
  });

  it("lets only one of two concurrent sales take the last units", async () => {
    await stock(CLEANER, 3_000, 400);
    const results = await Promise.allSettled([
      salesService.post(owner, sale()),
      salesService.post(owner, sale()),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect((await onHand(CLEANER))?.onHandMilli).toBe(1_000);
  });

  it("sells an untracked product without inventing a cost", async () => {
    const result = await salesService.post(
      owner,
      sale({
        lines: [
          { variantId: BLEACH, quantityMilli: 1_000, unitPriceAgorot: 800 },
        ],
        paidAgorot: 800,
      }),
    );
    const [invoice] = await db.select().from(customerInvoices);
    expect(invoice).toMatchObject({ cogsAgorot: 0, costComplete: false });
    expect(await db.select().from(stockMovements)).toHaveLength(0);
    const detail = await salesService.getInvoice(owner, result.invoiceId);
    expect(detail?.profit).toMatchObject({ complete: false, revenueAgorot: 0 });
  });
});

describe("customer credit and payments", () => {
  it("records a credit sale and derives the balance from the ledger", async () => {
    await stock(CLEANER, 10_000, 400);
    const result = await salesService.post(
      operator,
      sale({ customerName: "أحمد الخطيب", paidAgorot: 400 }),
    );
    expect(result).toMatchObject({
      remainingAgorot: 1_000,
      balanceAfterAgorot: 1_000,
    });

    const entries = await db.select().from(customerLedgerEntries);
    expect(
      entries.map((entry) => [entry.type, entry.amountAgorot]).sort(),
    ).toEqual([
      ["invoice", 1_400],
      ["payment", -400],
    ]);
    const [sum] = await db
      .select({
        total: sql<number>`sum(${customerLedgerEntries.amountAgorot})::int`,
      })
      .from(customerLedgerEntries);
    expect(sum?.total).toBe(1_000);

    // The same spoken name resolves to the same customer, regardless of hamza.
    const again = await salesService.post(
      operator,
      sale({ customerName: "احمد الخطيب", paidAgorot: 0 }),
    );
    expect(again.customerId).toBe(result.customerId);
    expect(again.balanceAfterAgorot).toBe(2_400);

    const [listed] = await customerService.list(operator, { onlyOwing: true });
    expect(listed).toMatchObject({ name: "أحمد الخطيب", balanceAgorot: 2_400 });
  });

  it("posts later payments idempotently and never past the balance", async () => {
    await stock(CLEANER, 10_000, 400);
    const { customerId } = await salesService.post(
      owner,
      sale({ customerName: "أم محمد", paidAgorot: 0 }),
    );
    const payment = {
      customerId: customerId!,
      amountAgorot: 900,
      idempotencyKey: crypto.randomUUID(),
    };
    expect(await salesService.recordPayment(operator, payment)).toEqual({
      balanceAgorot: 500,
      replayed: false,
    });
    expect(await salesService.recordPayment(operator, payment)).toEqual({
      balanceAgorot: 500,
      replayed: true,
    });
    await expect(
      salesService.recordPayment(operator, {
        ...payment,
        amountAgorot: 501,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "payment_exceeds_balance" });

    const detail = await customerService.getDetail(owner, customerId!);
    expect(detail?.summary).toMatchObject({
      balanceAgorot: 500,
      totalPurchasesAgorot: 1_400,
      totalPaidAgorot: 900,
    });
    expect(detail?.invoices[0]).toMatchObject({
      remainingAgorot: 500,
      state: "partially_paid",
    });
  });

  it("corrects a wrong payment with a compensating entry, not an edit", async () => {
    await stock(CLEANER, 10_000, 400);
    const { customerId } = await salesService.post(
      owner,
      sale({ customerName: "خالد", paidAgorot: 0 }),
    );
    await salesService.recordPayment(owner, {
      customerId: customerId!,
      amountAgorot: 1_400,
      idempotencyKey: crypto.randomUUID(),
    });
    const [payment] = await db
      .select()
      .from(customerPayments)
      .where(eq(customerPayments.customerId, customerId!));

    await expect(
      salesService.reversePayment(operator, {
        paymentId: payment!.id,
        reason: "مبلغ خاطئ",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    expect(
      await salesService.reversePayment(owner, {
        paymentId: payment!.id,
        reason: "مبلغ خاطئ",
      }),
    ).toEqual({ balanceAgorot: 1_400 });
    await expect(
      salesService.reversePayment(owner, {
        paymentId: payment!.id,
        reason: "مرة ثانية",
      }),
    ).rejects.toMatchObject({ code: "already_reversed" });

    const payments = await db.select().from(customerPayments);
    expect(
      payments.map((row) => row.amountAgorot).sort((a, b) => a - b),
    ).toEqual([-1_400, 1_400]);
    await expect(
      db.update(customerPayments).set({ amountAgorot: 1 }),
    ).rejects.toBeDefined();
    await expect(db.delete(customerLedgerEntries)).rejects.toBeDefined();
  });

  it("cancels an invoice with reversing entries and returns the goods at cost", async () => {
    await stock(CLEANER, 10_000, 400);
    const { invoiceId, customerId } = await salesService.post(
      owner,
      sale({ customerName: "سعاد", paidAgorot: 0 }),
    );
    await salesService.cancelInvoice(owner, {
      invoiceId,
      reason: "أُرجعت البضاعة",
    });

    expect(await onHand(CLEANER)).toMatchObject({
      onHandMilli: 10_000,
      stockValueAgorot: 4_000,
    });
    expect(await salesService.customerBalance(db, customerId!)).toBe(0);
    const [invoice] = await db.select().from(customerInvoices);
    expect(invoice).toMatchObject({ status: "cancelled", totalAgorot: 1_400 });
    await expect(
      salesService.cancelInvoice(owner, { invoiceId, reason: "مرة ثانية" }),
    ).rejects.toMatchObject({ code: "already_cancelled" });
    await expect(
      db.update(customerInvoices).set({ totalAgorot: 1 }),
    ).rejects.toBeDefined();

    const detail = await customerService.getDetail(owner, customerId!);
    expect(detail?.invoices[0]?.state).toBe("cancelled");
  });

  it("keeps customer names and phone numbers out of audit events", async () => {
    await stock(CLEANER, 10_000, 400);
    const { id } = await customerService.create(owner, {
      name: "ليلى الحاج",
      phone: "0599876543",
    });
    await salesService.post(owner, sale({ customerId: id, paidAgorot: 0 }));
    const audit = JSON.stringify(await db.select().from(adminAuditEvents));
    expect(audit).not.toContain("ليلى");
    expect(audit).not.toContain("599876543");

    await expect(
      customerService.create(owner, { name: "رقم خاطئ", phone: "12" }),
    ).rejects.toMatchObject({ code: "invalid_phone" });
    await expect(
      customerService.list({ ...operator, active: false }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
