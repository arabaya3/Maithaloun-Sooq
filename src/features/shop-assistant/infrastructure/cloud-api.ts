import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import type { InboundMessage, MessageSender } from "../domain/transport";

/**
 * Sends text through the official WhatsApp Business Cloud API, directly from Meta or through a
 * Business Solution Provider with the same message format (360dialog).
 */
export class CloudApiSender implements MessageSender {
  readonly provider = "whatsapp";

  constructor(
    private readonly config: {
      apiUrl: string;
      token: string;
      authStyle: "bearer" | "d360";
      fetch?: typeof fetch;
    },
  ) {}

  async sendText(toE164: string, text: string) {
    const response = await (this.config.fetch ?? fetch)(
      `${this.config.apiUrl.replace(/\/$/, "")}/messages`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.config.authStyle === "d360"
            ? { "D360-API-KEY": this.config.token }
            : { authorization: `Bearer ${this.config.token}` }),
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: toE164.replace(/^\+/, ""),
          type: "text",
          text: { preview_url: true, body: text.slice(0, 4096) },
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) {
      throw new Error(`WhatsApp send failed with status ${response.status}`);
    }
    const payload = (await response.json().catch(() => null)) as {
      messages?: { id?: string }[];
    } | null;
    return { providerMessageId: payload?.messages?.[0]?.id ?? null };
  }
}

/** Stores replies only; used by the admin simulator and tests. Nothing leaves the server. */
export class SimulatorSender implements MessageSender {
  readonly provider = "simulator";
  readonly sent: { to: string; text: string }[] = [];

  async sendText(to: string, text: string) {
    this.sent.push({ to, text });
    return { providerMessageId: null };
  }
}

/** Meta signs each webhook body with the app secret (X-Hub-Signature-256). */
export function validCloudSignature(
  rawBody: string,
  header: string | null,
  appSecret: string,
): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(
    createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex"),
  );
  const given = Buffer.from(header.slice(7));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function sameSecret(given: string | null, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const webhookSchema = z.object({
  entry: z
    .array(
      z.object({
        changes: z
          .array(
            z.object({
              value: z
                .object({
                  messages: z
                    .array(
                      z
                        .object({
                          id: z.string().max(128),
                          from: z.string().max(20),
                          timestamp: z.string().max(20).optional(),
                          type: z.string().max(30),
                          text: z.object({ body: z.string() }).optional(),
                          button: z.object({ text: z.string() }).optional(),
                          interactive: z.unknown().optional(),
                        })
                        .passthrough(),
                    )
                    .optional(),
                })
                .passthrough(),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
});

/**
 * Reads customer text messages from a Cloud API webhook body. Status updates, reactions and
 * media are ignored here; media gets a polite text answer from the caller.
 */
export function parseCloudWebhook(body: unknown): {
  messages: InboundMessage[];
  unsupported: { providerMessageId: string; fromE164: string }[];
} {
  const parsed = webhookSchema.safeParse(body);
  const messages: InboundMessage[] = [];
  const unsupported: { providerMessageId: string; fromE164: string }[] = [];
  if (!parsed.success) return { messages, unsupported };
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      for (const message of change.value.messages ?? []) {
        if (!/^[1-9]\d{7,14}$/.test(message.from)) continue;
        const fromE164 = `+${message.from}`;
        const text = message.text?.body ?? message.button?.text;
        if (!text?.trim()) {
          unsupported.push({ providerMessageId: message.id, fromE164 });
          continue;
        }
        const seconds = Number(message.timestamp);
        messages.push({
          provider: "whatsapp",
          providerMessageId: message.id,
          fromE164,
          text: text.slice(0, 4000),
          receivedAt: Number.isFinite(seconds)
            ? new Date(seconds * 1000)
            : new Date(),
        });
      }
    }
  }
  return { messages, unsupported };
}
