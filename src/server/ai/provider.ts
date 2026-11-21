import "server-only";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";

/**
 * Which AI provider the server uses. Anthropic (Claude) wins when its key is set; otherwise OpenAI.
 * Image generation and voice transcription exist only on OpenAI and keep using OPENAI_API_KEY.
 */
export type AiProvider = "anthropic" | "openai";

export const DEFAULT_CLAUDE_MODEL = "claude-opus-5-5";

export function aiProvider(): AiProvider | null {
  if (process.env.ANTHROPIC_API_KEY?.trim()) return "anthropic";
  if (process.env.OPENAI_API_KEY?.trim()) return "openai";
  return null;
}

/** The Claude model for every text, vision and agent call (ANTHROPIC_MODEL overrides the default). */
export function claudeModelId(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_CLAUDE_MODEL;
}

/** An AI SDK chat model for agents; `openAiModelId` is used only when OpenAI is the provider. */
export function chatModel(openAiModelId: string) {
  const provider = aiProvider();
  if (provider === "anthropic") {
    return createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(
      claudeModelId(),
    );
  }
  if (provider === "openai") {
    return createOpenAI({ apiKey: process.env.OPENAI_API_KEY })(openAiModelId);
  }
  return null;
}

/** Model id actually used by chatModel(), for logs and sampling decisions. */
export function chatModelId(openAiModelId: string): string {
  return aiProvider() === "anthropic" ? claudeModelId() : openAiModelId;
}

/**
 * Agent call settings per provider. Current Claude models reject sampling parameters and always think,
 * so they get room for thinking plus a low effort for quick, tool-driven answers.
 */
export function outputBudget(maxOutputTokens: number) {
  if (aiProvider() === "anthropic") {
    return {
      maxOutputTokens: Math.max(maxOutputTokens, 8_000),
      providerOptions: { anthropic: { effort: "low" as const } },
    };
  }
  return { maxOutputTokens };
}

/** outputBudget() plus deterministic sampling where the OpenAI model accepts it. */
export function agentCallSettings(modelId: string, maxOutputTokens: number) {
  if (aiProvider() === "anthropic") return outputBudget(maxOutputTokens);
  return {
    maxOutputTokens,
    // Reasoning models reject sampling settings; everything else runs deterministically for tool selection.
    ...(/^(o\d|gpt-5)/.test(modelId) ? {} : { temperature: 0 }),
  };
}
