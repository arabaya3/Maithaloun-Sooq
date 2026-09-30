import "server-only";

import { z } from "zod";

import { isFakeAiEnabled } from "./fake-mode";
import { isAiConfigured, requestStructuredJson } from "./openai-client";

export const INSIGHT_PROMPT_VERSION = "business-insight-2026-09-30";

export const insightSchema = z
  .object({
    whatHappened: z.string().min(1).max(600),
    whyItMatters: z.string().min(1).max(600),
    needsAttention: z.array(z.string().min(1).max(240)).max(5),
    suggestions: z.array(z.string().min(1).max(240)).max(5),
  })
  .strict();
export type BusinessInsight = z.infer<typeof insightSchema>;

const jsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["whatHappened", "whyItMatters", "needsAttention", "suggestions"],
  properties: {
    whatHappened: { type: "string" },
    whyItMatters: { type: "string" },
    needsAttention: { type: "array", items: { type: "string" } },
    suggestions: { type: "array", items: { type: "string" } },
  },
} as const;

const INSTRUCTIONS = [
  "You explain a small shop's period report to its owner in simple Palestinian-friendly Arabic.",
  "Use only the figures in the provided JSON. Never calculate, estimate or invent a number.",
  "Amounts in the JSON are already formatted; quote them exactly as given.",
  "If costComplete is false, say the profit is incomplete.",
  "Suggestions are optional ideas, short and practical, never instructions.",
].join(" ");

export interface InsightGenerator {
  readonly model: string;
  generate(facts: Record<string, unknown>): Promise<BusinessInsight>;
}

const fakeGenerator: InsightGenerator = {
  model: "fake-insight-model",
  async generate() {
    return {
      whatHappened: "ملخص تجريبي: هذه الفترة فيها مبيعات ومشتريات مسجّلة.",
      whyItMatters: "متابعة الربح والمخزون تساعد على الطلب في الوقت المناسب.",
      needsAttention: ["راجعي الأصناف التي قاربت على النفاد."],
      suggestions: ["اطلبي الأصناف الأكثر مبيعاً قبل نفادها."],
    };
  },
};

function openAiGenerator(): InsightGenerator {
  const model = process.env.OPENAI_TEXT_MODEL ?? "gpt-4.1-mini";
  return {
    model,
    // Only aggregated figures and product names are sent: no customer names or phone numbers.
    async generate(facts) {
      const raw = await requestStructuredJson({
        model,
        schemaName: "business_insight",
        schema: jsonSchema,
        instructions: INSTRUCTIONS,
        content: [{ type: "input_text", text: JSON.stringify(facts) }],
        timeoutMs: 30_000,
      });
      return insightSchema.parse(raw);
    },
  };
}

export function getInsightGenerator(): InsightGenerator | null {
  if (isFakeAiEnabled()) return fakeGenerator;
  return isAiConfigured() ? openAiGenerator() : null;
}
