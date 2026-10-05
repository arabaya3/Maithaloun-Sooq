import "server-only";

import { createOpenAI } from "@ai-sdk/openai";
import {
  isStepCount,
  ToolLoopAgent,
  type InferAgentUIMessage,
  type ToolSet,
} from "ai";

import {
  createAssistantTools,
  type AssistantToolContext,
} from "@/features/assistant/application/assistant-tools";
import { MAX_AGENT_STEPS } from "@/features/assistant/domain/assistant-policy";
import { assistantInstructions } from "@/features/assistant/domain/assistant-instructions";
import {
  mustAnswerNow,
  shouldStopLoop,
} from "@/features/assistant/domain/loop-guard";
import {
  maskDebtors,
  SMOKE_TOOL_ALLOWLIST,
} from "@/features/assistant/domain/smoke-test";

import { createFakeAssistantModel } from "./assistant-fake-model";
import { isFakeAiEnabled } from "./fake-mode";
import { AiError } from "./openai-client";

export function assistantModelId(): string {
  return isFakeAiEnabled()
    ? "fake-assistant-model"
    : (process.env.OPENAI_ASSISTANT_MODEL ?? "gpt-4.1-mini");
}

function assistantModel() {
  if (isFakeAiEnabled()) return createFakeAssistantModel();
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new AiError("AI_NOT_CONFIGURED");
  return createOpenAI({ apiKey })(assistantModelId());
}

// Reasoning models reject sampling settings; everything else runs deterministically for tool selection.
function supportsTemperature(modelId: string): boolean {
  return !/^(o\d|gpt-5)/.test(modelId);
}

const agentSettings = () => ({
  model: assistantModel(),
  stopWhen: [isStepCount(MAX_AGENT_STEPS)],
  // A repeated or failing loop, or the last allowed step, gets one text-only step so the owner always gets an answer.
  prepareStep: ({
    steps,
    stepNumber,
  }: {
    steps: Parameters<typeof shouldStopLoop>[0];
    stepNumber: number;
  }) =>
    mustAnswerNow(steps, stepNumber, MAX_AGENT_STEPS)
      ? { toolChoice: "none" as const }
      : undefined,
  maxRetries: 1,
  maxOutputTokens: 900,
  ...(supportsTemperature(assistantModelId()) ? { temperature: 0 } : {}),
});

export function createAssistantAgent(context: AssistantToolContext) {
  return new ToolLoopAgent({
    ...agentSettings(),
    instructions: assistantInstructions(
      context.mode === "full" ? "full" : "read",
    ),
    tools: createAssistantTools(context),
  });
}

// Owner smoke test: read mode, a fixed allowlist of read tools, debtor names masked before the model sees them.
export function createSmokeTestAgent(context: AssistantToolContext) {
  const all = createAssistantTools({ ...context, mode: "read" });
  const debtors = all.getDebtors;
  const tools: ToolSet = {
    ...Object.fromEntries(
      SMOKE_TOOL_ALLOWLIST.map((name) => [name, all[name]]),
    ),
    getDebtors: {
      ...debtors,
      execute: async (
        ...args: Parameters<NonNullable<typeof debtors.execute>>
      ) => maskDebtors(await debtors.execute!(...args)),
    },
  };
  return new ToolLoopAgent({
    ...agentSettings(),
    instructions: assistantInstructions("read"),
    tools,
  });
}

export type AssistantAgent = ReturnType<typeof createAssistantAgent>;
export type AssistantUIMessage = InferAgentUIMessage<AssistantAgent>;
