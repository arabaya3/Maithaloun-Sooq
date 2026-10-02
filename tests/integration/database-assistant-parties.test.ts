import { and, asc, eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AdminCatalogService } from "@/features/admin/application/admin-catalog-service";
import { AdminOrderService } from "@/features/admin/application/admin-order-service";
import { CatalogAuthoringService } from "@/features/admin/application/catalog-authoring-service";
import { ProductMaintenanceService } from "@/features/admin/application/product-maintenance-service";
import type { AdminActor } from "@/features/admin/domain/admin-actor";
import {
  AssistantOperations,
  type PrepareResult,
} from "@/features/assistant/application/assistant-operations";
import { AttachmentService } from "@/features/assistant/application/attachment-service";
import { ConfirmationService } from "@/features/assistant/application/confirmation-service";
import { ConversationRepository } from "@/features/assistant/application/conversation-repository";
import { ToolRunLog } from "@/features/assistant/application/tool-run-log";
import { PostgresProductRepository } from "@/features/catalog/infrastructure/postgres-product-repository";
import { InventoryService } from "@/features/inventory/application/inventory-service";
import { OfferService } from "@/features/offers/application/offer-service";
import { OrderService } from "@/features/orders/application/order-service";
import { ExtractionService } from "@/features/purchasing/application/extraction-service";
import { PurchaseService } from "@/features/purchasing/application/purchase-service";
import { SupplierMaintenanceService } from "@/features/purchasing/application/supplier-maintenance-service";
import { SupplierService } from "@/features/purchasing/application/supplier-service";
import { CustomerMaintenanceService } from "@/features/sales/application/customer-maintenance-service";
import { CustomerService } from "@/features/sales/application/customer-service";
import { SalesService } from "@/features/sales/application/sales-service";
import {
  adminAssistantConfirmations,
  customerInvoices,
  customerLedgerEntries,
  customers,
  offers,
  orderItems,
  purchaseInvoices,
  supplierLedgerEntries,
  suppliers,
} from "@/server/db/schema";
import { todayInStoreZone } from "@/shared/lib/store-time";
import {
  resetTestDatabase,
  testDatabaseConnection,
} from "@/test/test-database";

import {
  checkoutRequest,
  createOperatorActor,
  createOwnerActor,
} from "./support";

const { db, client } = testDatabaseConnection;
const unused = () => {
  throw new Error("not used");
};

const catalog = new AdminCatalogService(db);
const inventory = new InventoryService(db);
const purchases = new PurchaseService(db);
const sales = new SalesService(db);
const customerService = new CustomerService(db);
const customerMaintenance = new CustomerMaintenanceService(db);
const supplierService = new SupplierService(db);
const supplierMaintenance = new SupplierMaintenanceService(db);
const offerService = new OfferService(db);
const conversations = new ConversationRepository(db);
const toolRuns = new ToolRunLog(db);
const operations = new AssistantOperations({
  database: db,
  catalog,
  authoring: new CatalogAuthoringService(db),
  maintenance: new ProductMaintenanceService(db),
  inventory,
  sales,
  customers: customerService,
  customerMaintenance,
  suppliers: supplierService,
  supplierMaintenance,
  offers: offerService,
  orders: new AdminOrderService(db),
  extraction: new ExtractionService(db, purchases, unused),
  attachments: new AttachmentService(db, unused),
  productImages: unused,
  invoiceExtractor: unused,
});
const confirmations = new ConfirmationService(
  db,
  operations,
  conversations,
  toolRuns,
);
const party = operations.partyOps;
const storefront = new PostgresProductRepository(db);

let owner: AdminActor;
let operator: AdminActor;
let conversationId: string;

async function card(result: PrepareResult, actor: AdminActor = owner) {
  if (result.status !== "ready")
    throw new Error(`not ready: ${JSON.stringify(result)}`);
  const created = await confirmations.create(actor, conversationId, result);
  if (!created) throw new Error("not created");
  const view = await confirmations.view(actor, created.confirmationId);
  return {
    id: created.confirmationId,
    token: view!.token!,
    operation: view!.operation,
    view: view!,
  };
}

async function confirmed(result: PrepareResult) {
  const prepared = await card(result);
  const outcome = await confirmations.confirm(owner, {
    ...prepared,
    acknowledged: true,
  });
  if (!outcome.ok) throw new Error(`not confirmed: ${JSON.stringify(outcome)}`);
  return outcome;
}

async function stockIn(
  variantId: string,
  quantityMilli: number,
  cost = 300,
  supplierName = "مورد العروض",
) {
  await purchases.post(owner, {
    idempotencyKey: crypto.randomUUID(),
    supplierName,
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

async function customerByName(name: string) {
  const [row] = await db
    .select()
    .from(customers)
    .where(eq(customers.name, name));
  return row!;
}

async function ledgerOf(customerId: string) {
  return db
    .select()
    .from(customerLedgerEntries)
    .where(eq(customerLedgerEntries.customerId, customerId))
    .orderBy(asc(customerLedgerEntries.createdAt));
}

async function creditSale(
  customerId: string,
  variantId: string,
  quantityMilli: number,
  price: number,
  paid = 0,
) {
  return sales.post(owner, {
    idempotencyKey: crypto.randomUUID(),
    customerId,
    source: "manual",
    lines: [{ variantId, quantityMilli, unitPriceAgorot: price }],
    discountAgorot: 0,
    paidAgorot: paid,
  });
}

beforeAll(async () => {
  await resetTestDatabase();
  owner = await createOwnerActor();
  operator = await createOperatorActor();
  await stockIn("general-cleaner--default", 50_000);
  await stockIn("arar-dish-liquid--default", 50_000);
});

beforeEach(async () => {
  await client.unsafe(
    `TRUNCATE TABLE admin_assistant_confirmations, admin_assistant_tool_runs CASCADE`,
  );
  conversationId = await conversations.ensure(owner, null);
});

describe("offers", () => {
  it("prices the storefront and the order from one rule and keeps the list price", async () => {
    const outcome = await confirmed(
      await party.prepareOfferCreation(owner, {
        nameAr: "خصم المنظف العام",
        kind: "percentage",
        value: "10",
        minQuantity: 2,
        products: ["منظف عام Secret"],
        enabled: true,
      }),
    );
    expect(outcome.ok).toBe(true);
    const product = await storefront.getById("general-cleaner");
    expect(product!.variants[0]!.offer).toMatchObject({
      kind: "percentage",
      value: 10,
      minQuantity: 2,
    });
    expect(product!.priceAgorot).toBe(700);

    const single = await new OrderService(db).create(
      checkoutRequest([{ productId: "general-cleaner", quantity: 1 }]),
    );
    const double = await new OrderService(db).create(
      checkoutRequest([{ productId: "general-cleaner", quantity: 2 }]),
    );
    const lines = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.productDomainId, "general-cleaner"));
    const byOrder = (reference: string) =>
      lines.find(
        (line) =>
          line.orderId ===
          (reference === single.publicReference
            ? lines[0]!.orderId
            : lines[1]!.orderId),
      );
    expect(single.publicReference).not.toBe(double.publicReference);
    expect(
      lines
        .map((line) => [
          line.quantity,
          line.unitPriceAgorot,
          line.listUnitPriceAgorot,
          Boolean(line.offerId),
        ])
        .sort(),
    ).toEqual([
      [1, 700, 700, false],
      [2, 630, 700, true],
    ]);
    expect(byOrder(single.publicReference)).toBeTruthy();
  });

  it("rejects a price that would be zero and an overlapping offer on the same variant", async () => {
    expect(
      await party.prepareOfferCreation(owner, {
        nameAr: "خصم مستحيل",
        kind: "amount_off",
        value: "12",
        products: ["سائل جلي Arar"],
        enabled: false,
      }),
    ).toMatchObject({ status: "rejected", code: "invalid_price" });
    expect(
      await party.prepareOfferCreation(owner, {
        nameAr: "عرض ثاني على المنظف",
        kind: "fixed_price",
        value: "5",
        variants: ["general-cleaner--default"],
        enabled: true,
      }),
    ).toMatchObject({ status: "rejected", code: "conflict" });
  });

  it("respects start and end dates and stops applying once archived", async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toLocaleDateString(
      "en-CA",
      { timeZone: "Asia/Hebron" },
    );
    await confirmed(
      await party.prepareOfferCreation(owner, {
        nameAr: "عرض الجلي القادم",
        kind: "fixed_price",
        value: "10",
        products: ["سائل جلي Arar"],
        startsOn: tomorrow,
        enabled: true,
      }),
    );
    expect(
      (await storefront.getById("arar-dish-liquid"))!.variants[0]!.offer,
    ).toBeUndefined();
    const [future] = await db
      .select()
      .from(offers)
      .where(eq(offers.nameAr, "عرض الجلي القادم"));
    await db
      .update(offers)
      .set({ startsAt: new Date(Date.now() - 1_000) })
      .where(eq(offers.id, future!.id));
    expect(
      (await storefront.getById("arar-dish-liquid"))!.variants[0]!.offer,
    ).toMatchObject({ kind: "fixed_price" });

    await confirmed(
      await party.prepareOfferArchive(owner, {
        offer: "عرض الجلي القادم",
        mode: "archive",
      }),
    );
    expect(
      (await storefront.getById("arar-dish-liquid"))!.variants[0]!.offer,
    ).toBeUndefined();
    const remove = await card(
      await party.prepareOfferArchive(owner, {
        offer: "عرض الجلي القادم",
        mode: "delete",
      }),
    );
    expect(remove.view.riskLevel).toBe(4);
    expect(
      await confirmations.confirm(owner, { ...remove, acknowledged: true }),
    ).toMatchObject({ ok: true });
    expect(
      await party.prepareOfferArchive(owner, {
        offer: "خصم المنظف العام",
        mode: "delete",
      }),
    ).toMatchObject({ status: "rejected", code: "in_use" });
  });

  it("keeps offers away from operators", async () => {
    expect(
      await party.prepareOfferCreation(operator, {
        nameAr: "عرض",
        kind: "percentage",
        value: "5",
        products: ["مبيض"],
      }),
    ).toMatchObject({ status: "rejected", code: "forbidden" });
  });
});

describe("customers and their ledger", () => {
  it("creates, detects duplicates, updates contact details and archives", async () => {
    await confirmed(
      await party.prepareCustomerCreation(owner, {
        name: "أحمد يوسف",
        phone: "0591234567",
        address: "ميثلون، الحارة الشرقية",
        landmark: "قرب المسجد",
      }),
    );
    const ahmad = await customerByName("أحمد يوسف");
    expect(ahmad).toMatchObject({
      phoneE164: "+970591234567",
      address: "ميثلون، الحارة الشرقية",
      landmark: "قرب المسجد",
    });
    expect(
      await party.prepareCustomerCreation(owner, { name: "أحمد يوسف" }),
    ).toMatchObject({ status: "rejected", code: "duplicate" });
    expect(
      await party.prepareCustomerCreation(owner, { name: "أحمد" }),
    ).toMatchObject({ status: "needs_selection" });

    await confirmed(
      await party.prepareCustomerUpdate(owner, {
        customer: "أحمد يوسف",
        changes: { landmark: "مقابل المدرسة" },
      }),
    );
    expect(await customerByName("أحمد يوسف")).toMatchObject({
      landmark: "مقابل المدرسة",
      address: "ميثلون، الحارة الشرقية",
    });

    await confirmed(
      await party.prepareCustomerArchive(owner, {
        customer: "أحمد يوسف",
        mode: "archive",
      }),
    );
    expect((await customerByName("أحمد يوسف")).active).toBe(false);
    expect(await party.resolveCustomer(owner, "أحمد يوسف")).toMatchObject({
      ok: false,
    });
    await confirmed(
      await party.prepareCustomerArchive(owner, {
        customer: "أحمد يوسف",
        mode: "restore",
      }),
    );
    expect((await customerByName("أحمد يوسف")).active).toBe(true);
  });

  it("records a payment exactly once under concurrent confirmation and keeps the balance from the ledger", async () => {
    await customerService.create(owner, { name: "محمد سالم" });
    const mohammad = await customerByName("محمد سالم");
    await creditSale(mohammad.id, "general-cleaner--default", 3_000, 700);
    const payment = await card(
      await operations.prepareCustomerPayment(owner, {
        customer: "محمد سالم",
        amountIls: "8",
      }),
    );
    const results = await Promise.all([
      confirmations.confirm(owner, payment),
      confirmations.confirm(owner, payment),
    ]);
    expect(results.filter((row) => row.ok)).not.toHaveLength(0);
    const entries = await ledgerOf(mohammad.id);
    expect(entries.map((row) => row.type)).toEqual(["invoice", "payment"]);
    expect(await customerMaintenance.balance(mohammad.id)).toBe(2_100 - 800);
  });

  it("adjusts and reverses with new entries only, and the statement adds up", async () => {
    await customerService.create(owner, { name: "سامر خليل" });
    const samer = await customerByName("سامر خليل");
    await creditSale(samer.id, "arar-dish-liquid--default", 2_000, 1_200);
    await sales.recordPayment(owner, {
      customerId: samer.id,
      amountAgorot: 1_000,
      idempotencyKey: crypto.randomUUID(),
    });
    const before = await ledgerOf(samer.id);

    const adjust = await card(
      await party.prepareCustomerBalanceAdjustment(owner, {
        customer: "سامر خليل",
        amountIls: "5",
        direction: "increase_debt",
        reason: "توصيل خاص",
      }),
    );
    expect(adjust.view.riskLevel).toBe(3);
    expect(
      adjust.view.card.rows.find((row) => row.label === "الرصيد"),
    ).toMatchObject({ before: "14 ₪", after: "19 ₪" });
    await confirmations.confirm(owner, adjust);
    await confirmed(
      await party.prepareCustomerPaymentReversal(owner, {
        customer: "سامر خليل",
        reason: "دفعة مكررة",
      }),
    );

    const after = await ledgerOf(samer.id);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.slice(before.length).map((row) => row.type)).toEqual([
      "adjustment",
      "payment_reversal",
    ]);
    const today = todayInStoreZone();
    const statement = await customerMaintenance.statement(
      samer.id,
      today,
      today,
    );
    expect(statement.openingAgorot).toBe(0);
    expect(statement.closingAgorot).toBe(2_400 + 500);
    expect(statement.lines.at(-1)!.balanceAgorot).toBe(statement.closingAgorot);
  });

  it("merges a duplicate without changing any amount and deletes only unused customers", async () => {
    await customerService.create(owner, { name: "خالد عمر" });
    await customerService.create(owner, { name: "خالد ابو عمر" });
    const keep = await customerByName("خالد عمر");
    const duplicate = await customerByName("خالد ابو عمر");
    await creditSale(duplicate.id, "general-cleaner--default", 1_000, 700);
    await creditSale(keep.id, "general-cleaner--default", 2_000, 700);
    const history = await ledgerOf(duplicate.id);

    const merge = await card(
      await party.prepareCustomerMerge(owner, {
        duplicate: "خالد ابو عمر",
        target: "خالد عمر",
      }),
    );
    expect(merge.view.card.rows[0]).toMatchObject({
      before: "14 ₪",
      after: "21 ₪",
    });
    expect(await confirmations.confirm(owner, merge)).toMatchObject({
      ok: true,
    });

    const sourceAfter = await ledgerOf(duplicate.id);
    expect(sourceAfter.slice(0, history.length)).toEqual(history);
    expect(
      sourceAfter
        .slice(history.length)
        .map((row) => [row.type, row.amountAgorot]),
    ).toEqual([["adjustment", -700]]);
    expect((await ledgerOf(keep.id)).at(-1)).toMatchObject({
      type: "adjustment",
      amountAgorot: 700,
    });
    expect(await customerMaintenance.balance(keep.id)).toBe(2_100);
    expect(await customerMaintenance.balance(duplicate.id)).toBe(0);
    const [merged] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, duplicate.id));
    expect(merged).toMatchObject({
      active: false,
      mergedIntoCustomerId: keep.id,
    });
    expect(
      await db
        .select()
        .from(customerInvoices)
        .where(eq(customerInvoices.customerId, duplicate.id)),
    ).toHaveLength(1);
    expect(
      (await customerService.findByName(owner, "خالد ابو عمر"))[0],
    ).toMatchObject({ id: keep.id, exact: true });

    expect(
      await party.prepareCustomerArchive(owner, {
        customer: "خالد عمر",
        mode: "delete",
      }),
    ).toMatchObject({ status: "rejected", code: "in_use" });
    await customerService.create(owner, { name: "زبون تجريبي للحذف" });
    const remove = await card(
      await party.prepareCustomerArchive(owner, {
        customer: "زبون تجريبي للحذف",
        mode: "delete",
      }),
    );
    expect(remove.view.riskLevel).toBe(4);
    expect(await confirmations.confirm(owner, remove)).toMatchObject({
      ok: false,
      code: "not_acknowledged",
    });
    expect(
      await confirmations.confirm(owner, { ...remove, acknowledged: true }),
    ).toMatchObject({ ok: true });
  });

  it("schedules, pauses and resumes debt reminders", async () => {
    await customerService.create(owner, { name: "ليلى حسن" });
    const laila = await customerByName("ليلى حسن");
    const date = new Date(Date.now() + 5 * 86_400_000).toLocaleDateString(
      "en-CA",
      { timeZone: "Asia/Hebron" },
    );
    await confirmed(
      await party.prepareCustomerReminder(owner, {
        customer: "ليلى حسن",
        mode: "date",
        date,
      }),
    );
    let [state] = await client.unsafe(
      `select snoozed_until::text, disputed from customer_reminder_state where customer_id = '${laila.id}'`,
    );
    expect(state).toEqual({ snoozed_until: date, disputed: false });
    await confirmed(
      await party.prepareCustomerReminder(owner, {
        customer: "ليلى حسن",
        mode: "pause",
      }),
    );
    [state] = await client.unsafe(
      `select disputed from customer_reminder_state where customer_id = '${laila.id}'`,
    );
    expect(state).toEqual({ disputed: true });
    expect(
      await party.prepareCustomerReminder(owner, {
        customer: "ليلى حسن",
        mode: "date",
        date: "2020-01-01",
      }),
    ).toMatchObject({ status: "rejected" });
  });
});

describe("suppliers and their ledger", () => {
  it("creates, pays, corrects, merges and deletes only unused suppliers", async () => {
    await confirmed(
      await party.prepareSupplierCreation(owner, {
        nameAr: "شركة النظافة",
        phone: "0599000000",
      }),
    );
    expect(
      await party.prepareSupplierCreation(owner, { nameAr: "شركة النظافة" }),
    ).toMatchObject({ status: "rejected", code: "duplicate" });
    await stockIn("general-cleaner--default", 4_000, 500, "شركة النظافة");
    await stockIn("general-cleaner--default", 2_000, 500, "شركة النظافة فرع 2");
    const [main] = await db
      .select()
      .from(suppliers)
      .where(eq(suppliers.nameAr, "شركة النظافة"));
    const [branch] = await db
      .select()
      .from(suppliers)
      .where(eq(suppliers.nameAr, "شركة النظافة فرع 2"));
    expect(await supplierMaintenance.balance(db, main!.id)).toBe(2_000);

    expect(
      await party.prepareSupplierPayment(owner, {
        supplier: "شركة النظافة",
        amountIls: "50",
      }),
    ).toMatchObject({
      status: "rejected",
      code: "payment_exceeds_balance",
    });
    await confirmed(
      await party.prepareSupplierPayment(owner, {
        supplier: "شركة النظافة",
        amountIls: "5",
      }),
    );
    await confirmed(
      await party.prepareSupplierCorrection(owner, {
        supplier: "شركة النظافة",
        amountIls: "1",
        direction: "reduce_payable",
        reason: "خصم متفق عليه",
      }),
    );
    expect(await supplierMaintenance.balance(db, main!.id)).toBe(
      2_000 - 500 - 100,
    );

    await confirmed(
      await party.prepareSupplierMerge(owner, {
        duplicate: "شركة النظافة فرع 2",
        target: "شركة النظافة",
      }),
    );
    expect(
      await db
        .select()
        .from(purchaseInvoices)
        .where(eq(purchaseInvoices.supplierId, branch!.id)),
    ).toHaveLength(1);
    expect(await supplierMaintenance.balance(db, main!.id)).toBe(1_400 + 1_000);
    expect(await supplierMaintenance.balance(db, branch!.id)).toBe(0);
    const entryTypes = await db
      .select({ type: supplierLedgerEntries.type })
      .from(supplierLedgerEntries)
      .where(eq(supplierLedgerEntries.supplierId, main!.id));
    expect(entryTypes.map((row) => row.type).sort()).toEqual([
      "correction",
      "correction",
      "payment",
      "purchase",
    ]);
    const today = todayInStoreZone();
    expect(
      (await supplierMaintenance.statement(main!.id, today, today))
        .closingAgorot,
    ).toBe(2_400);

    expect(
      await party.prepareSupplierArchive(owner, {
        supplier: "شركة النظافة",
        mode: "delete",
      }),
    ).toMatchObject({
      status: "rejected",
      code: "in_use",
    });
    await confirmed(
      await party.prepareSupplierCreation(owner, { nameAr: "مورد بلا فواتير" }),
    );
    await confirmed(
      await party.prepareSupplierArchive(owner, {
        supplier: "مورد بلا فواتير",
        mode: "delete",
      }),
    );
    expect(
      await db
        .select()
        .from(suppliers)
        .where(eq(suppliers.nameAr, "مورد بلا فواتير")),
    ).toHaveLength(0);
  });
});

describe("confirmation integrity for ledger operations", () => {
  it("rejects stale, foreign, forged and expired cards and replays a completed one", async () => {
    await customerService.create(owner, { name: "نور الهدى" });
    const nour = await customerByName("نور الهدى");
    await creditSale(nour.id, "general-cleaner--default", 1_000, 700);

    const stale = await card(
      await party.prepareCustomerBalanceAdjustment(owner, {
        customer: "نور الهدى",
        amountIls: "2",
        direction: "reduce_debt",
        reason: "تقريب",
      }),
    );
    await sales.recordPayment(owner, {
      customerId: nour.id,
      amountAgorot: 100,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(await confirmations.confirm(owner, stale)).toMatchObject({
      ok: false,
      code: "stale",
    });

    const fresh = await card(
      await party.prepareCustomerBalanceAdjustment(owner, {
        customer: "نور الهدى",
        amountIls: "2",
        direction: "reduce_debt",
        reason: "تقريب",
      }),
    );
    expect(await confirmations.confirm(operator, fresh)).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(
      await confirmations.confirm(owner, { ...fresh, token: "x".repeat(43) }),
    ).toMatchObject({ ok: false, code: "bad_token" });
    const first = await confirmations.confirm(owner, fresh);
    expect(first).toMatchObject({ ok: true });
    expect(await confirmations.confirm(owner, fresh)).toEqual(first);
    expect(
      (await ledgerOf(nour.id)).filter((row) => row.type === "adjustment"),
    ).toHaveLength(1);

    const expired = await card(
      await party.prepareCustomerReminder(owner, {
        customer: "نور الهدى",
        mode: "pause",
      }),
    );
    await db
      .update(adminAssistantConfirmations)
      .set({ expiresAt: sql`now() - interval '1 minute'` })
      .where(and(eq(adminAssistantConfirmations.id, expired.id)));
    expect(await confirmations.confirm(owner, expired)).toMatchObject({
      ok: false,
      code: "expired",
    });
  });
});
