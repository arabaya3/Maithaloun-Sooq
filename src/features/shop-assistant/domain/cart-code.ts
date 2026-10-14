import { z } from "zod";

import {
  assistantCartSchema,
  type AssistantCartLine,
} from "./conversation-cart";

// Written into the website's WhatsApp message so the assistant can restore the exact cart.
// It carries identifiers and counts only; prices are always read again on the server.
const PREFIX = "MC1-";
const CODE_PATTERN = /MC1-([A-Za-z0-9_-]{8,1600})/;

const compactSchema = z
  .array(
    z.tuple([
      z.string(),
      z.string(),
      z.string().nullable(),
      z.number().int(),
      z.number().int(),
    ]),
  )
  .min(1);

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(code: string): string {
  const base64 = code.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return new TextDecoder().decode(
    Uint8Array.from(binary, (character) => character.charCodeAt(0)),
  );
}

export function encodeCartCode(lines: readonly AssistantCartLine[]): string {
  const compact = lines.map((line) => [
    line.productId,
    line.variantId,
    line.sellingUnitId ?? null,
    line.unitsPerSale ?? 1,
    line.quantity,
  ]);
  return PREFIX + toBase64Url(JSON.stringify(compact));
}

/** Finds and validates a cart code anywhere in a message; anything malformed is ignored. */
export function decodeCartCode(text: string): AssistantCartLine[] | null {
  const match = CODE_PATTERN.exec(text);
  if (!match) return null;
  try {
    const compact = compactSchema.parse(JSON.parse(fromBase64Url(match[1]!)));
    const lines = assistantCartSchema.safeParse(
      compact.map(
        ([productId, variantId, sellingUnitId, unitsPerSale, quantity]) => ({
          productId,
          variantId,
          ...(sellingUnitId ? { sellingUnitId } : {}),
          unitsPerSale,
          quantity,
        }),
      ),
    );
    return lines.success && lines.data.length ? lines.data : null;
  } catch {
    return null;
  }
}
