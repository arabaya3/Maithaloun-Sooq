import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { AdminCatalogService } from "@/features/admin/application/admin-catalog-service";
import { AdminOrderService } from "@/features/admin/application/admin-order-service";
import { CatalogAuthoringService } from "@/features/admin/application/catalog-authoring-service";
import { ProductMaintenanceService } from "@/features/admin/application/product-maintenance-service";
import { SellingUnitService } from "@/features/admin/application/selling-unit-service";
import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { AssistantOperations } from "@/features/assistant/application/assistant-operations";
import {
  createAssistantTools,
  type AssistantToolContext,
} from "@/features/assistant/application/assistant-tools";
import { AttachmentService } from "@/features/assistant/application/attachment-service";
import { ConfirmationService } from "@/features/assistant/application/confirmation-service";
import { ConversationRepository } from "@/features/assistant/application/conversation-repository";
import { runAssistantSmokeTest } from "@/features/assistant/application/smoke-test-service";
import { ToolRunLog } from "@/features/assistant/application/tool-run-log";
import {
  SMOKE_QUESTIONS,
  SMOKE_TOOL_ALLOWLIST,
} from "@/features/assistant/domain/smoke-test";
import { InventoryService } from "@/features/inventory/application/inventory-service";
import { OfferService } from "@/features/offers/application/offer-service";
import { ExtractionService } from "@/features/purchasing/application/extraction-service";
import { PurchaseService } from "@/features/purchasing/application/purchase-service";
import { SupplierMaintenanceService } from "@/features/purchasing/application/supplier-maintenance-service";
import { SupplierService } from "@/features/purchasing/application/supplier-service";
import { ReportService } from "@/features/reports/application/report-service";
import { CustomerMaintenanceService } from "@/features/sales/application/customer-maintenance-service";
import { CustomerService } from "@/features/sales/application/customer-service";
import { SalesService } from "@/features/sales/application/sales-service";
import { createProductImageAnalyzer } from "@/server/ai/product-image-analyzer";
import { businessFingerprint } from "@/test/business-fingerprint";
import {
  resetTestDatabase,
  testDatabaseConnection,
} from "@/test/test-database";

import { seedEvaluationData, sensitiveFixture } from "../model-eval/eval-seed";
import { createOwnerActor } from "./support";
import { AmbiguousAmountRefused } from "@/features/assistant/application/confirmation-service";

const { db, client } = testDatabaseConnection;
const refuse = () => {
  throw new Error("not used");
};
const catalog = new AdminCatalogService(db);
const authoring = new CatalogAuthoringService(db);
const inventory = new InventoryService(db);
const purchases = new PurchaseService(db);
const customers = new CustomerService(db);
const attachments = new AttachmentService(db, refuse);
const conversations = new ConversationRepository(db);
const toolRuns = new ToolRunLog(db);
const operations = new AssistantOperations({
  database: db,
  catalog,
  authoring,
  maintenance: new ProductMaintenanceService(db),
  sellingUnits: new SellingUnitService(db),
  inventory,
  sales: new SalesService(db),
  customers,
  customerMaintenance: new CustomerMaintenanceService(db),
  suppliers: new SupplierService(db),
  supplierMaintenance: new SupplierMaintenanceService(db),
  offers: new OfferService(db),
  orders: new AdminOrderService(db),
  extraction: new ExtractionService(db, purchases, refuse),
  attachments,
  productImages: refuse,
  invoiceExtractor: refuse,
});
const confirmations = new ConfirmationService(
  db,
  operations,
  conversations,
  toolRuns,
);
let owner: AdminActor;

const context = (conversationId: string): AssistantToolContext => ({
  actor: owner,
  conversationId,
  mode: "read",
  database: db,
  catalog,
  authoring,
  attachments,
  imageAnalyzer: createProductImageAnalyzer,
  offers: new OfferService(db),
  customerMaintenance: new CustomerMaintenanceService(db),
  suppliers: new SupplierService(db),
  supplierMaintenance: new SupplierMaintenanceService(db),
  inventory,
  orders: new AdminOrderService(db),
  customers,
  sales: new SalesService(db),
  reports: new ReportService(db, customers, inventory),
  purchases,
  operations,
  confirmations,
  toolRuns,
});

beforeAll(async () => {
  vi.stubEnv("AI_FAKE_MODE", "1");
  await resetTestDatabase();
  owner = await createOwnerActor();
  await seedEvaluationData(db, owner);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await client.end();
});

describe("assistant smoke test", () => {
  it("answers the fixed questions with read tools only and changes nothing", async () => {
    const before = await businessFingerprint(client);
    const { reference, answers } = await runAssistantSmokeTest(
      db,
      owner,
      context,
      conversations,
    );

    expect(answers.map((row) => row.id)).toEqual(
      SMOKE_QUESTIONS.map((row) => row.id),
    );
    expect(answers.every((row) => row.ok)).toBe(true);
    const used = answers.flatMap((row) => row.tools);
    expect(used.length).toBeGreaterThan(0);
    for (const name of used) {
      expect(SMOKE_TOOL_ALLOWLIST as readonly string[]).toContain(name);
    }
    expect(await businessFingerprint(client)).toEqual(before);
    const [cards] = await client.unsafe(
      "select count(*)::int as n from admin_assistant_confirmations",
    );
    expect(cards!.n).toBe(0);

    const visible = JSON.stringify(answers);
    for (const phone of sensitiveFixture.phones) {
      expect(visible).not.toContain(phone.slice(-7));
    }
    expect(visible).not.toContain("أم محمد");

    const [audit] = await client.unsafe(
      "select action_type, after_state from admin_audit_events where entity_id = $1",
      [reference],
    );
    expect(audit!.action_type).toBe("assistant_smoke_test");
    expect(Object.keys(audit!.after_state as object).sort()).toEqual(
      [
        "cachedTokens",
        "durationMs",
        "inputTokens",
        "outputTokens",
        "passed",
        "questions",
      ].sort(),
    );
    const logged = await client.unsafe(
      "select tool_name, input_summary from admin_assistant_tool_runs",
    );
    const text = JSON.stringify(logged);
    for (const question of SMOKE_QUESTIONS) {
      expect(text).not.toContain(question.text);
    }
  });
});

describe("tool fixes found by the real-model evaluation", () => {
  const call = async (
    name: string,
    input: Record<string, unknown>,
    ownerText = "",
  ) => {
    const conversationId = await conversations.ensure(owner, null);
    const tools = createAssistantTools({
      ...context(conversationId),
      mode: "full",
      ownerText: () => ownerText,
    }) as unknown as Record<
      string,
      { execute: (input: unknown, options: unknown) => Promise<unknown> }
    >;
    return (await tools[name]!.execute(input, {
      toolCallId: "t",
      messages: [],
    })) as Record<string, unknown>;
  };

  it("finds an archived product by name so it can be restored", async () => {
    const found = await call("searchProducts", { query: "منظف زجاج قديم" });
    expect(found.status).not.toBe("resolved");
    expect(found.archived).toEqual([
      expect.objectContaining({ label: "منظف زجاج قديم" }),
    ]);
    const active = await call("searchProducts", { query: "منظف عام" });
    expect(active.archived).toBeUndefined();
    expect(active.results).toEqual([
      expect.objectContaining({ variantCount: 1 }),
    ]);
  });

  it("reads a purchase invoice by the reference printed on it", async () => {
    const invoice = await call("getPurchaseInvoice", { reference: "inv 7781" });
    expect(invoice.status).toBe("not_found");
    const exact = await call("getPurchaseInvoice", { reference: "INV-7781" });
    expect(exact).toMatchObject({ status: "found", reference: "INV-7781" });
  });

  it("returns the open card instead of a second one for the same change", async () => {
    const conversationId = await conversations.ensure(owner, null);
    const prepared = await operations.prepareProductUpdate(owner, {
      product: "فرشاة سجاد",
      changes: { priceIls: "6" },
    });
    if (prepared.status !== "ready") throw new Error("not ready");
    const first = await confirmations.create(owner, conversationId, prepared);
    const second = await confirmations.create(owner, conversationId, prepared);
    expect(second!.confirmationId).toBe(first!.confirmationId);
    const other = await confirmations.create(owner, null, prepared);
    expect(other!.confirmationId).not.toBe(first!.confirmationId);
    await confirmations.cancel(owner, first!.confirmationId);
    const fresh = await confirmations.create(owner, conversationId, prepared);
    expect(fresh!.confirmationId).not.toBe(first!.confirmationId);
    await confirmations.cancel(owner, fresh!.confirmationId);
    await confirmations.cancel(owner, other!.confirmationId);
  });

  it("refuses a free-text variant on a product whose variants come from options", async () => {
    const before = await businessFingerprint(client);
    const result = await call("prepareVariantCreation", {
      product: "معطر جو فينيسيا",
      label: "أخضر",
      priceIls: "15",
    });
    expect(result).toMatchObject({ status: "rejected", code: "has_options" });
    expect(await businessFingerprint(client)).toEqual(before);
  });
});

describe("amount guard (independent of the model)", () => {
  const call = async (
    name: string,
    input: Record<string, unknown>,
    ownerText: string,
  ) => {
    const conversationId = await conversations.ensure(owner, null);
    const tools = createAssistantTools({
      ...context(conversationId),
      mode: "full",
      ownerText: () => ownerText,
    }) as unknown as Record<
      string,
      { execute: (input: unknown, options: unknown) => Promise<unknown> }
    >;
    const result = (await tools[name]!.execute(input, {
      toolCallId: "t",
      messages: [],
    })) as Record<string, unknown>;
    const [cards] = await client.unsafe(
      "select count(*)::int as n from admin_assistant_confirmations where conversation_id = $1",
      [conversationId],
    );
    return { result, cards: Number(cards!.n) };
  };

  it("lists conflicting amounts and prepares no payment card", async () => {
    const before = await businessFingerprint(client);
    const { result, cards } = await call(
      "prepareCustomerPayment",
      { customer: "أم محمد", amountIls: "50" },
      "أم محمد دفعت 50 شيكل، لا 70، مش متأكدة 50 ولا 70",
    );
    expect(result).toMatchObject({
      status: "rejected",
      code: "amount_conflict",
      values: ["50 ₪", "70 ₪"],
      state: "needs_clarification",
    });
    expect(cards).toBe(0);
    expect(await businessFingerprint(client)).toEqual(before);
  });

  it("uses the system price when the model sends an unreadable price the owner never said", async () => {
    const { result, cards } = await call(
      "prepareManualSale",
      {
        customer: null,
        items: [
          {
            product: "منظف عام",
            quantity: "2",
            unitPriceIls: "كل باكيج 3 حبات",
          },
        ],
        payment: "full",
      },
      "بعت 2 منظف عام، كل باكيج 3 حبات، نقدي ودفع كامل",
    );
    expect(result).toMatchObject({ status: "awaiting_confirmation" });
    expect(cards).toBe(1);
    const unreadable = await call(
      "prepareManualSale",
      {
        customer: null,
        items: [{ product: "منظف عام", quantity: "2", unitPriceIls: "كم" }],
        payment: "full",
      },
      "بعت 2 منظف عام بسعر 9 شيكل",
    );
    expect(unreadable.result).toMatchObject({ status: "rejected" });
    expect(unreadable.cards).toBe(0);
  });

  it("never prepares or confirms a pack with a negative, zero or alternative price", async () => {
    const before = await businessFingerprint(client);
    const pack = (priceIls: string) => ({
      product: "منظف عام",
      options: [{ label: "باكيج 3 حبات", unitsPerSale: 3, priceIls }],
    });
    for (const [said, priceIls, code] of [
      [
        "ضيفي لمنظف عام باكيج 3 حبات بسعر سالب 10 شيكل",
        "10",
        "amount_negative",
      ],
      ["سعر الباكيج سالب 10", "10", "amount_negative"],
      ["سعر الباكيج ناقص عشرة", "عشرة", "amount_negative"],
      ["سعر الباكيج -10", "-10", "amount_negative"],
      ["سعر الباكيج 0", "0", "amount_zero"],
      ["باكيج 3 حبات بسعر 10 أو 12", "10", "amount_conflict"],
    ] as const) {
      const { result, cards } = await call(
        "prepareSellingUnitsCreation",
        pack(priceIls),
        said,
      );
      expect(result, said).toMatchObject({ code });
      expect(cards).toBe(0);
    }
    const prepared = await operations.sellingUnitOps.prepareCreate(
      owner,
      pack("10"),
    );
    if (prepared.status !== "ready") throw new Error(JSON.stringify(prepared));
    const conversationId = await conversations.ensure(owner, null);
    for (const said of [
      "باكيج بسعر سالب 10 شيكل",
      "باكيج بسعر 10 أو 12 شيكل",
    ]) {
      await expect(
        confirmations.create(owner, conversationId, prepared, said),
      ).rejects.toBeInstanceOf(AmbiguousAmountRefused);
    }
    expect(await businessFingerprint(client)).toEqual(before);
  });

  it("never turns «سالب» into a positive price, in cards or drafts", async () => {
    const before = await businessFingerprint(client);
    for (const [owner, priceIls] of [
      ["خلي سعر منظف عام سالب 5 شيكل", "5"],
      ["خلي سعر منظف عام خمسة بالسالب", "خمسة"],
      ["خلي سعر منظف عام ناقص خمسة", "خمسة"],
      ["خلي سعر منظف عام -5", "5"],
    ] as const) {
      const { result, cards } = await call(
        "prepareProductUpdate",
        { product: "منظف عام", changes: { priceIls } },
        owner,
      );
      expect(result).toMatchObject({ code: "amount_negative" });
      expect(cards).toBe(0);
    }
    const zero = await call(
      "prepareProductUpdate",
      { product: "منظف عام", changes: { priceIls: "0" } },
      "خلي سعر منظف عام صفر",
    );
    expect(zero.result).toMatchObject({ code: "amount_zero" });
    await call(
      "startProductDraft",
      { fields: { nameAr: "منظف تجربة" } },
      "ضيفي منظف تجربة",
    );
    const draft = await call(
      "updateProductDraft",
      { price: "5" },
      "سعره سالب 5 شيكل",
    );
    expect(draft.result).toMatchObject({
      code: "amount_negative",
      state: "needs_clarification",
    });
    expect(await businessFingerprint(client)).toEqual(before);
  });

  it("refuses an amount the owner did not say", async () => {
    const { result, cards } = await call(
      "prepareSupplierPayment",
      { supplier: "شركة النور", amountIls: "70" },
      "دفعت لشركة النور 50 شيكل",
    );
    expect(result).toMatchObject({ code: "amount_mismatch" });
    expect(cards).toBe(0);
  });

  it("an execution demand while a card is open points at it and prepares nothing new", async () => {
    const conversationId = await conversations.ensure(owner, null);
    let ownerText = "غيري سعر فرشاة سجاد ل 6 شيكل";
    const tools = createAssistantTools({
      ...context(conversationId),
      mode: "full",
      ownerText: () => ownerText,
    }) as unknown as Record<
      string,
      { execute: (input: unknown, options: unknown) => Promise<unknown> }
    >;
    const options = { toolCallId: "t", messages: [] };
    const first = (await tools.prepareProductUpdate!.execute(
      { product: "فرشاة سجاد", changes: { priceIls: "6" } },
      options,
    )) as Record<string, unknown>;
    expect(first.status).toBe("awaiting_confirmation");
    ownerText = "قلتلك نعم، نفذي هلق وقوليلي لما يخلص";
    const again = (await tools.prepareVariantUpdate!.execute(
      { variant: "فرشاة سجاد", changes: { priceIls: "6" } },
      options,
    )) as Record<string, unknown>;
    expect(again).toMatchObject({ status: "rejected", code: "card_pending" });
    const [cards] = await client.unsafe(
      "select count(*)::int as n from admin_assistant_confirmations where conversation_id = $1",
      [conversationId],
    );
    expect(cards!.n).toBe(1);
    await confirmations.cancel(owner, String(first.confirmationId));
  });

  it("names the conflicting amounts when the tool is asked without one", async () => {
    const { result, cards } = await call(
      "prepareCustomerPayment",
      { customer: "أم محمد" },
      "أم محمد دفعت 50 شيكل، لا 70، مش متأكدة 50 ولا 70",
    );
    expect(result).toMatchObject({
      status: "rejected",
      code: "amount_conflict",
      values: ["50 ₪", "70 ₪"],
      state: "needs_clarification",
    });
    expect(cards).toBe(0);
  });

  it("returns an explicit clarification state when no amount was given", async () => {
    const { result, cards } = await call(
      "prepareCustomerPayment",
      { customer: "أم محمد" },
      "سجلي دفعة لأم محمد",
    );
    expect(result).toMatchObject({
      status: "rejected",
      code: "missing_required_field",
      state: "needs_clarification",
    });
    expect(cards).toBe(0);
  });

  it("the confirmation layer refuses a money card built from an ambiguous message", async () => {
    const conversationId = await conversations.ensure(owner, null);
    const prepared = await operations.prepareCustomerPayment(owner, {
      customer: "أم محمد",
      amountIls: "50",
    });
    if (prepared.status !== "ready") throw new Error("not ready");
    await expect(
      confirmations.create(
        owner,
        conversationId,
        prepared,
        "دفعت 50 ولا 70 مش متأكدة",
      ),
    ).rejects.toBeInstanceOf(AmbiguousAmountRefused);
    const clear = await confirmations.create(
      owner,
      conversationId,
      prepared,
      "أم محمد دفعت 50 شيكل",
    );
    expect(clear?.confirmationId).toBeTruthy();
    await confirmations.cancel(owner, clear!.confirmationId);
  });

  it("points a customer search at a supplier with that name, and the reverse", async () => {
    const asCustomer = await call(
      "searchCustomers",
      { name: "شركة النور" },
      "كشف حساب شركة النور",
    );
    expect(asCustomer.result).toMatchObject({
      status: "not_found",
      customers: [],
      suppliers: [expect.objectContaining({ name: "شركة النور" })],
    });
    const asSupplier = await call(
      "searchSuppliers",
      { name: "أم محمد" },
      "شو حساب أم محمد",
    );
    expect(asSupplier.result).toMatchObject({
      status: "not_found",
      suppliers: [],
      customers: [expect.objectContaining({ name: "أم محمد" })],
    });
    const offer = await call(
      "prepareOfferCreation",
      { products: ["مبيض"] },
      "بدي عرض على المبيض",
    );
    expect(offer.result).toMatchObject({
      code: "missing_required_field",
      state: "needs_clarification",
    });
    const named = await call(
      "prepareOfferCreation",
      { kind: "percentage", value: "10", products: ["مبيض"] },
      "اعملي عرض خصم 10 بالمية على المبيض",
    );
    expect(named.result).toMatchObject({ status: "awaiting_confirmation" });
    for (const ownerText of [
      "اعملي بكج مطبخ فيه 3 منتجات",
      "اعملي سحب على جائزة 500 شيكل",
    ]) {
      const refused = await call(
        "prepareOfferCreation",
        { kind: "percentage", value: "10", products: ["مبيض"] },
        ownerText,
      );
      expect(refused.result).toMatchObject({
        status: "rejected",
        code: "unsupported",
        state: "unsupported",
      });
      expect(refused.cards).toBe(0);
    }
    expect(named.cards).toBe(1);
    const options = await call(
      "getProductOptions",
      { product: "لميس" },
      "لميس ريحة الورد متوفر؟",
    );
    expect(options.result).toMatchObject({ status: "found" });
  });
});
