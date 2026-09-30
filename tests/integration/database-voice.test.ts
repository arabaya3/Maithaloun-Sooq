import { eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { InventoryService } from "@/features/inventory/application/inventory-service";
import { PurchaseService } from "@/features/purchasing/application/purchase-service";
import { SupplierService } from "@/features/purchasing/application/supplier-service";
import { ReportService } from "@/features/reports/application/report-service";
import { CustomerService } from "@/features/sales/application/customer-service";
import { SalesService } from "@/features/sales/application/sales-service";
import { VoiceService } from "@/features/voice/application/voice-service";
import type { VoiceInterpretation } from "@/features/voice/domain/voice-command";
import {
  customerInvoices,
  customerPayments,
  voiceCommands,
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
const inventoryService = new InventoryService(db);
const reportService = new ReportService(db, customerService, inventoryService);
const CLEANER = "general-cleaner--default";

const empty: VoiceInterpretation = {
  intent: "unknown",
  customerName: null,
  supplierName: null,
  items: [],
  payment: null,
  amount: null,
  adjustmentReason: null,
  reportMetric: null,
  period: null,
  clarification: null,
};
let modelAnswer: unknown = empty;
const voiceService = new VoiceService(
  db,
  () => ({ model: "test-model", interpret: async () => modelAnswer }),
  inventoryService,
  salesService,
  customerService,
  new SupplierService(db),
  reportService,
);

let owner: AdminActor;
let operator: AdminActor;
let cleanerName: string;

const count = async (
  table: typeof customerInvoices | typeof customerPayments,
) =>
  (await db.select({ total: sql<number>`count(*)::int` }).from(table))[0]!
    .total;

async function creditSale(customerName: string) {
  await salesService.post(owner, {
    idempotencyKey: crypto.randomUUID(),
    source: "manual",
    customerName,
    lines: [{ variantId: CLEANER, quantityMilli: 1_000, unitPriceAgorot: 700 }],
    discountAgorot: 0,
    paidAgorot: 0,
  });
}

beforeAll(async () => {
  await resetTestDatabase();
  owner = await createOwnerActor();
  operator = await createOperatorActor();
});

beforeEach(async () => {
  await client.unsafe(`TRUNCATE TABLE ${OPERATIONS_TABLES.join(", ")} CASCADE`);
  await purchaseService.post(owner, {
    idempotencyKey: crypto.randomUUID(),
    supplierName: "مورد الاختبار",
    reference: crypto.randomUUID().slice(0, 8),
    invoiceDate: "2026-09-01",
    source: "manual",
    lines: [
      {
        variantId: CLEANER,
        unit: "piece",
        quantityMilli: 20_000,
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
  const stock = await inventoryService.listStock(owner);
  cleanerName = stock.find((item) => item.variantId === CLEANER)!.name;
});

describe("voice commands", () => {
  it("prepares a sale for review without writing anything", async () => {
    modelAnswer = {
      ...empty,
      intent: "create_sale",
      items: [
        { name: cleanerName, quantity: "2", unit: null, unitPrice: null },
      ],
      payment: "full",
    };
    const outcome = await voiceService.interpret(operator, {
      transcript: "بعت عبوتين منظف ودفع كامل",
      source: "typed",
    });
    if (outcome.kind !== "sale") throw new Error(outcome.kind);
    expect(outcome.payload.lines).toEqual([
      expect.objectContaining({ variantId: CLEANER, quantityMilli: 2_000 }),
    ]);
    expect(outcome.payload.paidAgorot).toBe(1_400);
    expect(await count(customerInvoices)).toBe(0);

    // Confirming twice with the command's key still records one sale.
    await salesService.post(operator, outcome.payload);
    await salesService.post(operator, outcome.payload);
    expect(await count(customerInvoices)).toBe(1);
  });

  it("rejects model output that fails validation", async () => {
    modelAnswer = { ...empty, intent: "create_sale", totalAgorot: 1 };
    const outcome = await voiceService.interpret(operator, {
      transcript: "بعت شيئاً",
      source: "typed",
    });
    expect(outcome.kind).toBe("failed");
    const [row] = await db.select().from(voiceCommands);
    expect(row).toMatchObject({ status: "failed", aiModel: "test-model" });
    expect(await count(customerInvoices)).toBe(0);
  });

  it("asks which customer, then records one payment after confirmation", async () => {
    await creditSale("أحمد علي");
    await creditSale("أحمد سالم");
    modelAnswer = {
      ...empty,
      intent: "record_payment",
      customerName: "أحمد",
      amount: "5",
    };
    const asked = await voiceService.interpret(operator, {
      transcript: "سجلي دفعة من أحمد 5 شيكل",
      source: "typed",
    });
    if (asked.kind !== "clarify") throw new Error(asked.kind);
    expect(asked.options).toHaveLength(2);
    expect(await count(customerPayments)).toBe(0);

    const chosen = asked.options.find((option) => option.label === "أحمد علي")!;
    const card = await voiceService.answerClarification(operator, {
      commandId: asked.commandId,
      field: asked.field,
      value: chosen.value,
    });
    expect(card).toMatchObject({
      kind: "payment",
      amountAgorot: 500,
      balanceBeforeAgorot: 700,
      balanceAfterAgorot: 200,
    });
    expect(await count(customerPayments)).toBe(0);

    // Another staff member cannot confirm a command they did not speak.
    expect(
      (await voiceService.confirmPayment(owner, asked.commandId)).kind,
    ).toBe("failed");
    expect(await count(customerPayments)).toBe(0);

    expect(
      (await voiceService.confirmPayment(operator, asked.commandId)).kind,
    ).toBe("answer");
    await voiceService.confirmPayment(operator, asked.commandId);
    expect(await count(customerPayments)).toBe(1);
    expect(await salesService.customerBalance(db, chosen.value)).toBe(200);
    const [row] = await db
      .select()
      .from(voiceCommands)
      .where(eq(voiceCommands.id, asked.commandId));
    expect(row).toMatchObject({
      status: "confirmed",
      resultEntityType: "customer",
    });
  });

  it("refuses a payment larger than the balance", async () => {
    await creditSale("سعاد");
    modelAnswer = {
      ...empty,
      intent: "record_payment",
      customerName: "سعاد",
      amount: "50",
    };
    const outcome = await voiceService.interpret(operator, {
      transcript: "سجلي دفعة من سعاد 50",
      source: "typed",
    });
    expect(outcome.kind).toBe("failed");
  });

  it("keeps profit and stock adjustments owner-only", async () => {
    modelAnswer = {
      ...empty,
      intent: "query_report",
      reportMetric: "profit",
      period: "week",
    };
    const denied = await voiceService.interpret(operator, {
      transcript: "كم ربحت هذا الأسبوع",
      source: "typed",
    });
    expect(denied).toMatchObject({
      kind: "answer",
      text: "هذه المعلومة متاحة للمالك فقط.",
    });
    const allowed = await voiceService.interpret(owner, {
      transcript: "كم ربحت هذا الأسبوع",
      source: "typed",
    });
    expect(allowed).toMatchObject({ kind: "answer" });
    if (allowed.kind === "answer") expect(allowed.text).toContain("الربح");

    modelAnswer = {
      ...empty,
      intent: "adjust_stock",
      items: [
        { name: cleanerName, quantity: "1", unit: null, unitPrice: null },
      ],
      adjustmentReason: "damaged",
    };
    expect(
      await voiceService.interpret(operator, {
        transcript: "عبوة منظف تالفة",
        source: "typed",
      }),
    ).toMatchObject({ kind: "failed", message: "تعديل المخزون للمالك فقط." });

    const card = await voiceService.interpret(owner, {
      transcript: "عبوة منظف تالفة",
      source: "typed",
    });
    if (card.kind !== "adjust") throw new Error(card.kind);
    expect(card).toMatchObject({
      onHandMilli: 20_000,
      onHandAfterMilli: 19_000,
    });
    await voiceService.confirmAdjustment(owner, card.commandId);
    await voiceService.confirmAdjustment(owner, card.commandId);
    const stock = await inventoryService.listStock(owner);
    expect(stock.find((item) => item.variantId === CLEANER)!.onHandMilli).toBe(
      19_000,
    );
  });
});
