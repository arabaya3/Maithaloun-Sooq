import "server-only";

import { z } from "zod";

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
  return Boolean(process.env.OPENAI_API_KEY);
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
