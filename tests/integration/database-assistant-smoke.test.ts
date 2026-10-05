import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { AdminCatalogService } from "@/features/admin/application/admin-catalog-service";
import { AdminOrderService } from "@/features/admin/application/admin-order-service";
import { CatalogAuthoringService } from "@/features/admin/application/catalog-authoring-service";
import { ProductMaintenanceService } from "@/features/admin/application/product-maintenance-service";
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
  const call = async (name: string, input: Record<string, unknown>) => {
    const conversationId = await conversations.ensure(owner, null);
    const tools = createAssistantTools({
      ...context(conversationId),
      mode: "full",
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
