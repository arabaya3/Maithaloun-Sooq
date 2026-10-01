import { z } from "zod";

import { MAX_USER_TEXT } from "./assistant-policy";

export const assistantRequestSchema = z
  .object({
    conversationId: z.uuid().nullable().optional(),
    message: z
      .object({
        id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
        role: z.literal("user"),
        parts: z
          .array(
            z
              .object({
                type: z.literal("text"),
                text: z.string().max(MAX_USER_TEXT),
              })
              .strip(),
          )
          .min(1)
          .max(4),
        metadata: z
          .object({ attachmentIds: z.array(z.uuid()).max(6).optional() })
          .strip()
          .optional(),
      })
      .strip(),
  })
  .strict();
export type AssistantRequest = z.infer<typeof assistantRequestSchema>;

// Attachments reach the model only as opaque ids; their content never becomes prompt text.
export function toModelUserText(
  text: string,
  attachments: ReadonlyArray<{ id: string; kind: "image" | "pdf" }>,
): string {
  const trimmed = text.replace(/\s+/g, " ").trim().slice(0, MAX_USER_TEXT);
  if (!attachments.length) return trimmed;
  const list = attachments
    .map((item) => `${item.kind === "pdf" ? "ملف PDF" : "صورة"} ${item.id}`)
    .join("، ");
  return `${trimmed || "أرفقت ملفات."}\n[مرفقات: ${list}]`;
}
