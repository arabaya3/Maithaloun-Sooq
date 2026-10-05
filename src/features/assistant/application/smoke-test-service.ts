import "server-only";

import { randomUUID } from "node:crypto";

import type { AdminActor } from "@/features/admin/domain/admin-actor";
import type { Database } from "@/features/inventory/application/stock-ledger";
import { createSmokeTestAgent } from "@/server/ai/assistant-agent";
import * as schema from "@/server/db/schema";
import { errorCode, logEvent } from "@/server/log/ops-log";

import { checkGrounding, GROUNDING_REPLIES } from "../domain/grounding";
import { maskPrivateText, SMOKE_QUESTIONS } from "../domain/smoke-test";
import type { AssistantToolContext } from "./assistant-tools";

export interface SmokeAnswer {
  id: string;
  question: string;
  ok: boolean;
  answer: string;
  tools: string[];
  durationMs: number;
  firstResponseMs: number | null;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reference: string | null;
}

const FAILED_ANSWER = "تعذّر الحصول على إجابة لهذا السؤال.";

export async function runAssistantSmokeTest(
  database: Database,
  actor: AdminActor,
  context: (conversationId: string) => AssistantToolContext,
  conversations: {
    ensure(actor: AdminActor, id: string | null): Promise<string>;
  },
): Promise<{ reference: string; answers: SmokeAnswer[] }> {
  const reference = randomUUID();
  const conversationId = await conversations.ensure(actor, null);
  const agent = createSmokeTestAgent(context(conversationId));
  const answers: SmokeAnswer[] = [];

  for (const question of SMOKE_QUESTIONS) {
    const started = Date.now();
    let firstResponseMs: number | null = null;
    try {
      const result = await agent.stream({ prompt: question.text });
      for await (const part of result.fullStream) {
        if (firstResponseMs === null && part.type === "text-delta") {
          firstResponseMs = Date.now() - started;
        }
      }
      const [text, steps, usage] = await Promise.all([
        result.text,
        result.steps,
        result.totalUsage,
      ]);
      const evidence = [
        question.text,
        ...steps.flatMap((step) =>
          step.toolResults.map((item) => JSON.stringify(item.output)),
        ),
      ];
      const violation = checkGrounding({ text, evidence });
      answers.push({
        id: question.id,
        question: question.text,
        ok: !violation && text.trim().length > 0,
        answer: maskPrivateText(
          violation ? GROUNDING_REPLIES[violation] : text,
        ),
        tools: steps.flatMap((step) =>
          step.toolCalls.map((call) => call.toolName),
        ),
        durationMs: Date.now() - started,
        firstResponseMs,
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        cachedTokens: usage.inputTokenDetails?.cacheReadTokens ?? 0,
        reference: null,
      });
    } catch (error) {
      logEvent("error", "assistant.smoke.failed", {
        reference,
        question: question.id,
        code: errorCode(error),
      });
      answers.push({
        id: question.id,
        question: question.text,
        ok: false,
        answer: FAILED_ANSWER,
        tools: [],
        durationMs: Date.now() - started,
        firstResponseMs,
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        reference: reference.slice(0, 8),
      });
    }
  }

  const totals = {
    questions: answers.length,
    passed: answers.filter((row) => row.ok).length,
    durationMs: answers.reduce((sum, row) => sum + row.durationMs, 0),
    inputTokens: answers.reduce((sum, row) => sum + row.inputTokens, 0),
    outputTokens: answers.reduce((sum, row) => sum + row.outputTokens, 0),
    cachedTokens: answers.reduce((sum, row) => sum + row.cachedTokens, 0),
  };
  logEvent("info", "assistant.smoke.completed", { reference, ...totals });
  await database.insert(schema.adminAuditEvents).values({
    adminUserId: actor.id,
    actionType: "assistant_smoke_test",
    entityType: "assistant",
    entityId: reference,
    beforeState: null,
    afterState: totals,
  });
  return { reference, answers };
}
