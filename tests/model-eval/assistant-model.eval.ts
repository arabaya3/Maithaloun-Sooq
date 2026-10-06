import { mkdirSync, writeFileSync } from "node:fs";

import type { ModelMessage } from "ai";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdminCatalogService } from "@/features/admin/application/admin-catalog-service";
import { AdminOrderService } from "@/features/admin/application/admin-order-service";
import { CatalogAuthoringService } from "@/features/admin/application/catalog-authoring-service";
import { ProductMaintenanceService } from "@/features/admin/application/product-maintenance-service";
import { SellingUnitService } from "@/features/admin/application/selling-unit-service";
import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { AssistantOperations } from "@/features/assistant/application/assistant-operations";
import { AttachmentService } from "@/features/assistant/application/attachment-service";
import { ConfirmationService } from "@/features/assistant/application/confirmation-service";
import { ConversationRepository } from "@/features/assistant/application/conversation-repository";
import { ToolRunLog } from "@/features/assistant/application/tool-run-log";
import {
  confirmationButtonHint,
  isBareAffirmation,
} from "@/features/assistant/domain/affirmation";
import { conflictingAmountQuestion } from "@/features/assistant/domain/amount-guard";
import { checkGrounding } from "@/features/assistant/domain/grounding";
import { toModelUserText } from "@/features/assistant/domain/user-message";
import { assertEvaluationEnvironment } from "@/features/assistant/evaluation/eval-guard";
import {
  estimateCostUsd,
  leaksSensitiveData,
  pricingFor,
  reportRow,
  type ReportRow,
} from "@/features/assistant/evaluation/eval-report";
import {
  classifyCase,
  hasClarificationState,
  hasUnsupportedState,
  expectedToolClass,
  isPass,
  summarize,
  type CaseObservation,
  type ScoredCase,
} from "@/features/assistant/evaluation/eval-scoring";
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
import {
  assistantModelId,
  createAssistantAgent,
} from "@/server/ai/assistant-agent";
import { createProductImageAnalyzer } from "@/server/ai/product-image-analyzer";
import type { PrivateDocumentStore } from "@/server/storage/private-documents";
import {
  businessFingerprint,
  changedTables,
} from "@/test/business-fingerprint";
import {
  resetTestDatabase,
  testDatabaseConnection,
} from "@/test/test-database";

import { createOwnerActor } from "../integration/support";

import {
  assistantCases,
  type EvalCase,
  type EvalImage,
  type EvalTurn,
} from "./assistant-cases";
import {
  INJECTION_MARKERS,
  seedEvaluationData,
  sensitiveFixture,
} from "./eval-seed";

const requested = process.env.ASSISTANT_MODEL_EVAL === "1";
const TOKEN_BUDGET = Number(
  process.env.ASSISTANT_EVAL_TOKEN_BUDGET ?? 1_500_000,
);
const COST_BUDGET_USD = Number(process.env.ASSISTANT_EVAL_COST_BUDGET_USD ?? 3);
const ONLY = new Set(
  (process.env.ASSISTANT_EVAL_ONLY ?? "").split(",").filter(Boolean),
);
const EXECUTED_STATUSES = ["executing", "succeeded", "completed", "failed"];

const { db, client } = testDatabaseConnection;

async function renderLabel(image: EvalImage): Promise<Buffer> {
  const escape = (value: string) =>
    value.replace(/[<>&"]/g, (char) => `&#${char.charCodeAt(0)};`);
  const rows = image.lines
    .map(
      (line, index) =>
        `<text x="400" y="${220 + index * 90}" font-size="54" font-family="Arial" text-anchor="middle" fill="#1d1d1d">${escape(line)}</text>`,
    )
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="${image.background}"/><rect x="60" y="120" width="680" height="560" rx="40" fill="#ffffff" stroke="#888" stroke-width="6"/>${rows}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

const startsWithMarker = (text: string) => {
  const opening = text.replace(/^[\s«"'`*_:،.-]+/u, "");
  return INJECTION_MARKERS.some((marker) => opening.startsWith(marker));
};

describe.skipIf(!requested)("assistant real-model evaluation", () => {
  const files = new Map<string, Buffer>();
  const store: PrivateDocumentStore = {
    async put(objectPath, bytes) {
      files.set(objectPath, bytes);
      return { provider: "local", bucket: "memory", path: objectPath };
    },
    async read(location) {
      return files.get(location.path)!;
    },
    signedUrl: async () => null,
    remove: async () => undefined,
  };
  const neverPublish = () => {
    throw new Error("EVAL_STORE_WRITE_REFUSED");
  };
  const catalog = new AdminCatalogService(db);
  const authoring = new CatalogAuthoringService(db);
  const inventory = new InventoryService(db);
  const purchases = new PurchaseService(db);
  const customers = new CustomerService(db);
  const attachments = new AttachmentService(db, () => store);
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
    extraction: new ExtractionService(db, purchases, () => store),
    attachments,
    productImages: () => ({ put: neverPublish }),
    invoiceExtractor: neverPublish,
  });
  const confirmations = new ConfirmationService(
    db,
    operations,
    conversations,
    toolRuns,
  );
  const model = assistantModelId();
  const price = pricingFor(model, process.env);
  const rows: ReportRow[] = [];
  const scored: ScoredCase[] = [];
  let owner: AdminActor;
  let orderReference = "";
  const spent = { tokens: 0, cost: 0 };

  beforeAll(async () => {
    assertEvaluationEnvironment(process.env);
    await resetTestDatabase();
    owner = await createOwnerActor();
    ({ orderReference } = await seedEvaluationData(db, owner));
  }, 120_000);

  afterAll(() => {
    if (!scored.length) return;
    const summary = summarize(scored);
    const latencies = rows.map((row) => row.latencyMs).sort((a, b) => a - b);
    const quantile = (q: number) =>
      latencies[
        Math.min(latencies.length - 1, Math.floor(q * latencies.length))
      ] ?? 0;
    mkdirSync("artifacts/assistant-eval", { recursive: true });
    writeFileSync(
      "artifacts/assistant-eval/report.json",
      JSON.stringify(
        {
          model,
          generatedAt: new Date().toISOString(),
          budget: { tokens: TOKEN_BUDGET, costUsd: COST_BUDGET_USD },
          totals: {
            inputTokens: rows.reduce((sum, row) => sum + row.inputTokens, 0),
            outputTokens: rows.reduce((sum, row) => sum + row.outputTokens, 0),
            cachedTokens: rows.reduce((sum, row) => sum + row.cachedTokens, 0),
            costUsd: price ? Math.round(spent.cost * 10_000) / 10_000 : null,
            latencyMs: {
              p50: quantile(0.5),
              p95: quantile(0.95),
              max: latencies.at(-1) ?? 0,
            },
          },
          summary,
          results: rows,
        },
        null,
        2,
      ),
    );
  });

  async function runCase(testCase: EvalCase) {
    const conversationId = await conversations.ensure(owner, null);
    let ownerText = "";
    const agent = createAssistantAgent({
      actor: owner,
      conversationId,
      mode: "full",
      ownerText: () => ownerText,
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
    const cards = async () => {
      const [row] = await client.unsafe(
        `select count(*)::int as total,
           count(*) filter (where used_at is not null or status = any($2))::int as executed
         from admin_assistant_confirmations where conversation_id = $1`,
        [conversationId, EXECUTED_STATUSES],
      );
      return { total: Number(row?.total), executed: Number(row?.executed) };
    };
    const before = await businessFingerprint(client);
    const history: ModelMessage[] = [];
    const evidence: string[] = [];
    const usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
    const started = Date.now();
    let last = {
      tools: [] as string[],
      text: "",
      needsSelection: false,
      clarificationState: false,
      unsupportedState: false,
      cardsBefore: 0,
    };
    let infrastructureError = false;

    for (const [index, turn] of testCase.turns.entries()) {
      const spec: Exclude<EvalTurn, string> =
        typeof turn === "string" ? { text: turn, images: [] } : turn;
      const text = spec.text.replaceAll("{order}", orderReference);
      const uploaded = [];
      for (const image of spec.images) {
        const view = await attachments.upload(owner, await renderLabel(image));
        uploaded.push({ id: view.id, kind: "image" as const });
      }
      evidence.push(text);
      ownerText = text;
      const isLast = index === testCase.turns.length - 1;
      const cardsBefore = (await cards()).total;
      // Mirrors the chat route: a bare "yes" while a card is open never reaches the model.
      const pending = await confirmations.pendingInConversation(
        owner,
        conversationId,
      );
      if (!uploaded.length && pending && isBareAffirmation(text)) {
        const reply = confirmationButtonHint(pending.confirmLabel);
        history.push(
          { role: "user", content: text },
          { role: "assistant", content: reply },
        );
        if (isLast) {
          last = {
            tools: [],
            text: reply,
            needsSelection: false,
            clarificationState: false,
            unsupportedState: false,
            cardsBefore,
          };
        }
        continue;
      }
      // Mirrors the chat route: alternative amounts or a negative or zero price get a fixed server question.
      const conflict = uploaded.length ? null : conflictingAmountQuestion(text);
      if (conflict) {
        history.push(
          { role: "user", content: text },
          { role: "assistant", content: conflict.question },
        );
        if (isLast) {
          last = {
            tools: [],
            text: conflict.question,
            needsSelection: false,
            clarificationState: true,
            unsupportedState: false,
            cardsBefore,
          };
        }
        continue;
      }
      history.push({ role: "user", content: toModelUserText(text, uploaded) });
      try {
        const result = await agent.generate({ messages: history });
        history.push(...result.response.messages);
        usage.inputTokens += result.totalUsage.inputTokens ?? 0;
        usage.outputTokens += result.totalUsage.outputTokens ?? 0;
        usage.cachedTokens +=
          result.totalUsage.inputTokenDetails?.cacheReadTokens ?? 0;
        const outputs = result.steps.flatMap((step) =>
          step.toolResults.map(
            (item) => item.output as Record<string, unknown> | null,
          ),
        );
        evidence.push(...outputs.map((output) => JSON.stringify(output)));
        if (isLast) {
          last = {
            tools: result.steps.flatMap((step) =>
              step.toolCalls.map((call) => call.toolName),
            ),
            text: result.text,
            needsSelection: outputs.some(
              (output) =>
                output?.status === "needs_selection" ||
                output?.approximate === true,
            ),
            clarificationState: hasClarificationState(outputs),
            unsupportedState: hasUnsupportedState(outputs),
            cardsBefore,
          };
        }
      } catch {
        infrastructureError = true;
        break;
      }
    }

    const after = await cards();
    const observation: CaseObservation = {
      tools: last.tools,
      cardsCreated: after.total - last.cardsBefore,
      cardsExecuted: after.executed,
      mutatedTables: changedTables(before, await businessFingerprint(client)),
      grounding: last.text
        ? checkGrounding({ text: last.text, evidence })
        : null,
      leaked: leaksSensitiveData(last.text, {
        ...sensitiveFixture,
        secrets: [process.env.OPENAI_API_KEY ?? ""],
      }),
      injectionMarkerEchoed: startsWithMarker(last.text),
      clarificationState: last.clarificationState,
      unsupportedState: last.unsupportedState,
      needsSelection: last.needsSelection,
      replied: last.text.trim().length > 0,
      infrastructureError,
    };
    const pendingRows = await client.unsafe(
      "select id from admin_assistant_confirmations where conversation_id = $1 and status = 'pending'",
      [conversationId],
    );
    for (const row of pendingRows) {
      await confirmations.cancel(owner, String(row.id));
    }
    return { observation, usage, latencyMs: Date.now() - started };
  }

  it(
    "meets every release threshold against the real model",
    async () => {
      const selected = assistantCases.filter(
        (row) => !ONLY.size || ONLY.has(row.id),
      );
      for (const testCase of selected) {
        const base = {
          id: testCase.id,
          category: testCase.category,
          expectedToolClass: expectedToolClass(testCase),
        };
        if (spent.tokens >= TOKEN_BUDGET || spent.cost >= COST_BUDGET_USD) {
          scored.push({
            ...base,
            expectation: testCase,
            code: "budget_exhausted",
          });
          rows.push(
            reportRow({
              ...base,
              tools: [],
              passed: false,
              code: "budget_exhausted",
              latencyMs: 0,
              inputTokens: 0,
              outputTokens: 0,
              cachedTokens: 0,
              costUsd: null,
            }),
          );
          continue;
        }
        const { observation, usage, latencyMs } = await runCase(testCase);
        const code = classifyCase(testCase, observation);
        const costUsd = estimateCostUsd(usage, price);
        // Budget counts billable tokens: uncached input plus output.
        spent.tokens +=
          usage.inputTokens - usage.cachedTokens + usage.outputTokens;
        spent.cost += costUsd ?? 0;
        scored.push({ ...base, expectation: testCase, code });
        rows.push(
          reportRow({
            ...base,
            tools: [...observation.tools],
            passed: isPass(code),
            code,
            latencyMs,
            ...usage,
            costUsd,
          }),
        );
      }
      const executed = await client.unsafe(
        "select count(*)::int as n from admin_assistant_confirmations where used_at is not null or status = any($1)",
        [EXECUTED_STATUSES],
      );
      expect(executed[0]?.n).toBe(0);
      const summary = summarize(scored);
      expect({
        breaches: summary.breaches,
        incomplete: summary.incomplete,
      }).toEqual({ breaches: [], incomplete: false });
      expect(summary.released).toBe(true);
    },
    90 * 60_000,
  );
});
