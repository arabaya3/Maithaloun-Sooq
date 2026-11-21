import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { aiProvider, claudeModelId } from "./provider";

export type AiErrorCode =
  "AI_NOT_CONFIGURED" | "AI_REQUEST_FAILED" | "AI_RESPONSE_INVALID";

export class AiError extends Error {
  constructor(readonly code: AiErrorCode) {
    super(code);
    this.name = "AiError";
  }
}

export type AiContentPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail?: "low" | "high" }
  | { type: "input_file"; filename: string; file_data: string };

const responseSchema = z.object({
  output: z.array(
    z.object({
      type: z.string(),
      content: z
        .array(z.object({ type: z.string(), text: z.string().optional() }))
        .optional(),
    }),
  ),
});

function apiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new AiError("AI_NOT_CONFIGURED");
  return key;
}

export function isAiConfigured(): boolean {
  return aiProvider() !== null;
}

const DATA_URL = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([\s\S]+)$/;
const CLAUDE_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

function toClaudeBlock(part: AiContentPart): Anthropic.ContentBlockParam {
  if (part.type === "input_text") return { type: "text", text: part.text };
  const source = part.type === "input_image" ? part.image_url : part.file_data;
  const match = DATA_URL.exec(source);
  if (part.type === "input_image") {
    if (!match) return { type: "image", source: { type: "url", url: source } };
    if (!CLAUDE_IMAGE_TYPES.has(match[1])) {
      throw new AiError("AI_REQUEST_FAILED");
    }
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: match[1] as "image/jpeg",
        data: match[2],
      },
    };
  }
  if (!match || match[1] !== "application/pdf") {
    throw new AiError("AI_REQUEST_FAILED");
  }
  return {
    type: "document",
    title: part.filename,
    source: { type: "base64", media_type: "application/pdf", data: match[2] },
  };
}

// Constraints Claude's structured outputs don't accept; callers re-validate the result with Zod anyway.
const UNSUPPORTED_SCHEMA_KEYS = new Set([
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
]);

export function toClaudeSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toClaudeSchema);
  if (!schema || typeof schema !== "object") return schema;
  return Object.fromEntries(
    Object.entries(schema)
      .filter(([key]) => !UNSUPPORTED_SCHEMA_KEYS.has(key))
      .map(([key, value]) => [
        key,
        key === "enum" || key === "const"
          ? value
          : key === "properties" && value && typeof value === "object"
            ? Object.fromEntries(
                Object.entries(value).map(([name, child]) => [
                  name,
                  toClaudeSchema(child),
                ]),
              )
            : toClaudeSchema(value),
      ]),
  );
}

// Claude path: same contract (JSON matching the schema, validated again by the caller). Documents and
// images go before the text, as the Messages API recommends.
async function requestClaudeJson(input: {
  schema: Record<string, unknown>;
  instructions: string;
  content: AiContentPart[];
  timeoutMs: number;
}): Promise<unknown> {
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    timeout: input.timeoutMs,
    maxRetries: 1,
  });
  const blocks = input.content.map(toClaudeBlock);
  blocks.sort((a, b) => Number(a.type === "text") - Number(b.type === "text"));
  let message: Anthropic.Message;
  try {
    message = await client.messages.create({
      model: claudeModelId(),
      max_tokens: 16_000,
      system: input.instructions,
      messages: [{ role: "user", content: blocks }],
      output_config: {
        effort: "low",
        format: {
          type: "json_schema",
          schema: toClaudeSchema(input.schema) as Record<string, unknown>,
        },
      },
    });
  } catch (error) {
    if (error instanceof AiError) throw error;
    throw new AiError("AI_REQUEST_FAILED");
  }
  if (message.stop_reason !== "end_turn") {
    throw new AiError("AI_RESPONSE_INVALID");
  }
  for (const block of message.content) {
    if (block.type === "text") {
      try {
        return JSON.parse(block.text);
      } catch {
        throw new AiError("AI_RESPONSE_INVALID");
      }
    }
  }
  throw new AiError("AI_RESPONSE_INVALID");
}

// Strict JSON-schema output; the caller still validates the result with Zod.
export async function requestStructuredJson(input: {
  model: string;
  schemaName: string;
  schema: Record<string, unknown>;
  instructions: string;
  content: AiContentPart[];
  timeoutMs: number;
}): Promise<unknown> {
  if (aiProvider() === "anthropic") return requestClaudeJson(input);
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: input.model,
        store: false,
        instructions: input.instructions,
        input: [{ role: "user", content: input.content }],
        text: {
          format: {
            type: "json_schema",
            name: input.schemaName,
            strict: true,
            schema: input.schema,
          },
        },
      }),
      signal: AbortSignal.timeout(input.timeoutMs),
    });
  } catch (error) {
    if (error instanceof AiError) throw error;
    throw new AiError("AI_REQUEST_FAILED");
  }
  if (!response.ok) throw new AiError("AI_REQUEST_FAILED");

  const parsed = responseSchema.safeParse(await response.json());
  if (!parsed.success) throw new AiError("AI_RESPONSE_INVALID");
  for (const item of parsed.data.output) {
    for (const part of item.content ?? []) {
      if (part.type === "output_text" && part.text) {
        try {
          return JSON.parse(part.text);
        } catch {
          throw new AiError("AI_RESPONSE_INVALID");
        }
      }
    }
  }
  throw new AiError("AI_RESPONSE_INVALID");
}

export async function transcribeAudio(input: {
  bytes: Buffer;
  mimeType: string;
  filename: string;
  model: string;
  language: string;
  timeoutMs: number;
}): Promise<string> {
  const body = new FormData();
  body.set(
    "file",
    new Blob([new Uint8Array(input.bytes)], { type: input.mimeType }),
    input.filename,
  );
  body.set("model", input.model);
  body.set("language", input.language);
  body.set("response_format", "json");
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey()}` },
      body,
      signal: AbortSignal.timeout(input.timeoutMs),
    });
  } catch (error) {
    if (error instanceof AiError) throw error;
    throw new AiError("AI_REQUEST_FAILED");
  }
  if (!response.ok) throw new AiError("AI_REQUEST_FAILED");
  const parsed = z
    .object({ text: z.string() })
    .safeParse(await response.json());
  if (!parsed.success) throw new AiError("AI_RESPONSE_INVALID");
  return parsed.data.text;
}
