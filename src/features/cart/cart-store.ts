import { z } from "zod";

import { variantDomainIdSchema } from "@/features/catalog/domain/product-variant";

export const CART_STORAGE_KEY = "souq-maythalun:cart:v2";
export const LEGACY_CART_STORAGE_KEY = "souq-maythalun:cart:v1";
export const MAX_CART_QUANTITY = 9;

const cartLineSchema = z
  .object({
    productId: z.string().regex(/^[a-z0-9-]{1,80}$/),
    variantId: variantDomainIdSchema,
    quantity: z.number().int().min(1).max(MAX_CART_QUANTITY),
  })
  .strict();

const persistedCartV2Schema = z
  .object({
    version: z.literal(2),
    lines: z.array(cartLineSchema).max(100),
  })
  .strict();

const legacyCartLineSchema = z
  .object({
    productId: z.string().regex(/^[a-z0-9-]{1,80}$/),
    quantity: z.number().int().min(1).max(MAX_CART_QUANTITY),
  })
  .strict();

const persistedCartV1Schema = z
  .object({
    version: z.literal(1),
    lines: z.array(legacyCartLineSchema).max(100),
  })
  .strict();

export type CartLine = z.infer<typeof cartLineSchema>;

export interface CartState {
  lines: CartLine[];
}

export type CartAction =
  | { type: "restore"; lines: CartLine[] }
  | {
      type: "add";
      productId: string;
      variantId: string;
      quantity: number;
    }
  | {
      type: "setQuantity";
      productId: string;
      variantId: string;
      quantity: number;
    }
  | { type: "remove"; productId: string; variantId: string }
  | { type: "clear" };

export const initialCartState: CartState = { lines: [] };

function lineKey(productId: string, variantId: string): string {
  return `${productId}::${variantId}`;
}

export function parsePersistedCart(
  raw: string | null,
  allowedPairs: ReadonlyMap<string, ReadonlySet<string>>,
  defaultVariantByProduct: ReadonlyMap<string, string>,
  legacyRaw: string | null = null,
): CartState {
  const fromV2 = parseV2(raw, allowedPairs);
  if (fromV2) return fromV2;

  const fromV1 = parseV1(
    legacyRaw ?? raw,
    allowedPairs,
    defaultVariantByProduct,
  );
  if (fromV1) return fromV1;

  return initialCartState;
}

function parseV2(
  raw: string | null,
  allowedPairs: ReadonlyMap<string, ReadonlySet<string>>,
): CartState | null {
  if (!raw) return null;
  try {
    const parsed = persistedCartV2Schema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;

    const keys = parsed.data.lines.map((line) =>
      lineKey(line.productId, line.variantId),
    );
    if (new Set(keys).size !== keys.length) return null;

    const lines = parsed.data.lines.filter((line) =>
      allowedPairs.get(line.productId)?.has(line.variantId),
    );
    if (!lines.length && parsed.data.lines.length) return initialCartState;
    return { lines };
  } catch {
    return null;
  }
}

function parseV1(
  raw: string | null,
  allowedPairs: ReadonlyMap<string, ReadonlySet<string>>,
  defaultVariantByProduct: ReadonlyMap<string, string>,
): CartState | null {
  if (!raw) return null;
  try {
    const parsed = persistedCartV1Schema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;

    const productIds = parsed.data.lines.map((line) => line.productId);
    if (new Set(productIds).size !== productIds.length) return null;

    const lines: CartLine[] = [];
    for (const line of parsed.data.lines) {
      const variantId = defaultVariantByProduct.get(line.productId);
      if (!variantId) continue;
      if (!allowedPairs.get(line.productId)?.has(variantId)) continue;
      lines.push({
        productId: line.productId,
        variantId,
        quantity: line.quantity,
      });
    }
    return { lines };
  } catch {
    return null;
  }
}

export function cartReducer(state: CartState, action: CartAction): CartState {
  if (action.type === "restore") return { lines: action.lines };
  if (action.type === "clear") return initialCartState;
  if (action.type === "remove") {
    return {
      lines: state.lines.filter(
        (line) =>
          !(
            line.productId === action.productId &&
            line.variantId === action.variantId
          ),
      ),
    };
  }

  const quantity = Math.max(
    1,
    Math.min(MAX_CART_QUANTITY, Math.trunc(action.quantity)),
  );

  if (action.type === "setQuantity") {
    return {
      lines: state.lines.map((line) =>
        line.productId === action.productId &&
        line.variantId === action.variantId
          ? { ...line, quantity }
          : line,
      ),
    };
  }

  const existing = state.lines.find(
    (line) =>
      line.productId === action.productId &&
      line.variantId === action.variantId,
  );

  if (!existing) {
    return {
      lines: [
        ...state.lines,
        {
          productId: action.productId,
          variantId: action.variantId,
          quantity,
        },
      ],
    };
  }

  return {
    lines: state.lines.map((line) =>
      line.productId === action.productId && line.variantId === action.variantId
        ? {
            ...line,
            quantity: Math.min(MAX_CART_QUANTITY, line.quantity + quantity),
          }
        : line,
    ),
  };
}

export function serializeCart(state: CartState): string {
  return JSON.stringify({ version: 2, lines: state.lines });
}

export function calculateLineSubtotal(
  unitPriceAgorot: number,
  quantity: number,
): number {
  if (
    !Number.isInteger(unitPriceAgorot) ||
    unitPriceAgorot < 0 ||
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > MAX_CART_QUANTITY
  ) {
    throw new RangeError("Invalid cart subtotal input");
  }

  return unitPriceAgorot * quantity;
}

export function calculateCartSubtotal(
  lines: readonly { unitPriceAgorot: number; quantity: number }[],
): number {
  return lines.reduce(
    (total, line) =>
      total + calculateLineSubtotal(line.unitPriceAgorot, line.quantity),
    0,
  );
}
