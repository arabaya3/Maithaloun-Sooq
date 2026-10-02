import { mkdirSync, writeFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdminCatalogService } from "@/features/admin/application/admin-catalog-service";
import { AdminOrderService } from "@/features/admin/application/admin-order-service";
import { CatalogAuthoringService } from "@/features/admin/application/catalog-authoring-service";
import { ProductMaintenanceService } from "@/features/admin/application/product-maintenance-service";
import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { AssistantOperations } from "@/features/assistant/application/assistant-operations";
import { AttachmentService } from "@/features/assistant/application/attachment-service";
import { ConfirmationService } from "@/features/assistant/application/confirmation-service";
import { ConversationRepository } from "@/features/assistant/application/conversation-repository";
import { ToolRunLog } from "@/features/assistant/application/tool-run-log";
import { checkGrounding } from "@/features/assistant/domain/grounding";
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
import { createAssistantAgent } from "@/server/ai/assistant-agent";
import { createProductImageAnalyzer } from "@/server/ai/product-image-analyzer";
import {
  resetTestDatabase,
  testDatabaseConnection,
} from "@/test/test-database";

import { createOwnerActor } from "../integration/support";

import { anyPrepare, assistantCases } from "./assistant-cases";

const enabled =
  process.env.ASSISTANT_MODEL_EVAL === "1" &&
  Boolean(process.env.OPENAI_API_KEY);
const TOKEN_BUDGET = Number(process.env.ASSISTANT_EVAL_TOKEN_BUDGET ?? 400_000);

// Refuses anything that is not a local test database; this suite must never reach Production.
function assertLocalTestDatabase() {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "postgres://invalid");
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error(
      "Model evaluation runs only against a local test database.",
    );
  }
  if (process.env.VERCEL || process.env.NODE_ENV === "production") {
    throw new Error("Model evaluation is refused in production environments.");
  }
}

const { db, client } = testDatabaseConnection;

describe.skipIf(!enabled)("assistant real-model evaluation", () => {
  const unavailable = () => {
    throw new Error("not used");
  };
  const catalog = new AdminCatalogService(db);
  const authoring = new CatalogAuthoringService(db);
  const inventory = new InventoryService(db);
  const purchases = new PurchaseService(db);
  const customers = new CustomerService(db);
  const attachments = new AttachmentService(db, unavailable);
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
    extraction: new ExtractionService(db, purchases, unavailable),
    attachments,
    productImages: unavailable,
    invoiceExtractor: unavailable,
  });
  const confirmations = new ConfirmationService(
    db,
    operations,
    conversations,
    toolRuns,
  );
  let owner: AdminActor;
  const report: Array<Record<string, unknown>> = [];
  let tokens = 0;

  beforeAll(async () => {
    assertLocalTestDatabase();
    await resetTestDatabase();
    owner = await createOwnerActor();
    await client.unsafe(`
      INSERT INTO customers (name, normalized_name, phone_e164) VALUES
        ('أم محمد', 'ام محمد', '+970599123450'),
        ('أم أحمد', 'ام احمد', NULL)`);
    await client.unsafe(
      "INSERT INTO suppliers (name_ar, normalized_name) VALUES ('شركة النور', 'شركة النور')",
    );
  });

  afterAll(() => {
    mkdirSync("artifacts/assistant-eval", { recursive: true });
    writeFileSync(
      "artifacts/assistant-eval/report.json",
      JSON.stringify(
        {
          model: process.env.OPENAI_ASSISTANT_MODEL ?? "gpt-4.1-mini",
          cases: report.length,
          tokens,
          passed: report.filter((row) => row.passed).length,
          critical_failures: report.filter((row) => row.critical && !row.passed)
            .length,
          results: report,
        },
        null,
        2,
      ),
    );
  });

  it(
    "selects tools, clarifies, refuses and never invents facts or success",
    async () => {
      for (const testCase of assistantCases) {
        if (tokens > TOKEN_BUDGET) {
          report.push({ id: testCase.id, skipped: "token_budget" });
          continue;
        }
        const conversationId = await conversations.ensure(owner, null);
        const agent = createAssistantAgent({
          actor: owner,
          conversationId,
          mode: "full",
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
        const result = await agent.generate({ prompt: testCase.prompt });
        tokens +=
          (result.totalUsage.inputTokens ?? 0) +
          (result.totalUsage.outputTokens ?? 0);
        const called = result.steps.flatMap((step) =>
          step.toolCalls.map((call) => call.toolName),
        );
        const evidence = [
          testCase.prompt,
          ...result.steps.flatMap((step) =>
            step.toolResults.map((item) => JSON.stringify(item.output)),
          ),
        ];
        const violation = checkGrounding({ text: result.text, evidence });
        const toolOk = testCase.tools
          ? testCase.tools.some((name) => called.includes(name))
          : true;
        const forbiddenOk = !(testCase.forbidden ?? []).some((name) =>
          called.includes(name),
        );
        const clarifyOk = testCase.clarify
          ? !called.some((name) => anyPrepare(name)) || /\?|؟/.test(result.text)
          : true;
        report.push({
          id: testCase.id,
          category: testCase.category,
          critical: Boolean(testCase.critical),
          tools: called,
          toolSelection: toolOk,
          forbiddenAvoided: forbiddenOk,
          clarification: clarifyOk,
          groundingViolation: violation,
          passed: toolOk && forbiddenOk && clarifyOk && !violation,
        });
      }
      const pending = await client.unsafe(
        "select id from admin_assistant_confirmations where status = 'pending'",
      );
      for (const row of pending)
        await confirmations.cancel(owner, String(row.id));
      const criticalViolations = report.filter(
        (row) => row.critical && row.groundingViolation,
      );
      expect(criticalViolations).toEqual([]);
      const executed = await client.unsafe(
        "select count(*)::int as n from admin_assistant_confirmations where status = 'confirmed'",
      );
      expect(executed[0]?.n).toBe(0);
    },
    30 * 60_000,
  );
});
