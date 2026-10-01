import "server-only";

import { createOpenAI } from "@ai-sdk/openai";
import { isStepCount, ToolLoopAgent, type InferAgentUIMessage } from "ai";

import {
  createAssistantTools,
  type AssistantToolContext,
} from "@/features/assistant/application/assistant-tools";
import { MAX_AGENT_STEPS } from "@/features/assistant/domain/assistant-policy";
import { ASSISTANT_INSTRUCTIONS } from "@/features/assistant/domain/assistant-instructions";

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

export function createAssistantAgent(context: AssistantToolContext) {
  return new ToolLoopAgent({
    model: assistantModel(),
    instructions: ASSISTANT_INSTRUCTIONS,
    tools: createAssistantTools(context),
    stopWhen: isStepCount(MAX_AGENT_STEPS),
    maxRetries: 1,
  });
}

export type AssistantAgent = ReturnType<typeof createAssistantAgent>;
export type AssistantUIMessage = InferAgentUIMessage<AssistantAgent>;
