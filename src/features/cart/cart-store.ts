import { z } from "zod";

export const CART_STORAGE_KEY = "souq-maythalun:cart:v1";
export const MAX_CART_QUANTITY = 9;

const cartLineSchema = z
  .object({
    productId: z.string().regex(/^[a-z0-9-]{1,80}$/),
    quantity: z.number().int().min(1).max(MAX_CART_QUANTITY),
  })
  .strict();

const persistedCartSchema = z
  .object({
    version: z.literal(1),
    lines: z.array(cartLineSchema).max(100),
  })
  .strict();

export type CartLine = z.infer<typeof cartLineSchema>;

export interface CartState {
  lines: CartLine[];
}

export type CartAction =
  | { type: "restore"; lines: CartLine[] }
  | { type: "add"; productId: string; quantity: number }
  | { type: "setQuantity"; productId: string; quantity: number }
  | { type: "remove"; productId: string }
  | { type: "clear" };

export const initialCartState: CartState = { lines: [] };

export function parsePersistedCart(
  raw: string | null,
  allowedProductIds: ReadonlySet<string>,
): CartState {
  if (!raw) return initialCartState;

  try {
    const parsed = persistedCartSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return initialCartState;

    const productIds = parsed.data.lines.map((line) => line.productId);
    const uniqueIds = new Set(productIds);
    if (
      uniqueIds.size !== productIds.length ||
      productIds.some((productId) => !allowedProductIds.has(productId))
    ) {
      return initialCartState;
    }

    return { lines: parsed.data.lines };
  } catch {
    return initialCartState;
  }
}

export function cartReducer(state: CartState, action: CartAction): CartState {
  if (action.type === "restore") return { lines: action.lines };
  if (action.type === "clear") return initialCartState;
  if (action.type === "remove") {
    return {
      lines: state.lines.filter((line) => line.productId !== action.productId),
    };
  }

  const quantity = Math.max(
    1,
    Math.min(MAX_CART_QUANTITY, Math.trunc(action.quantity)),
  );

  if (action.type === "setQuantity") {
    return {
      lines: state.lines.map((line) =>
        line.productId === action.productId ? { ...line, quantity } : line,
      ),
    };
  }

  const existing = state.lines.find(
    (line) => line.productId === action.productId,
  );

  if (!existing) {
    return {
      lines: [...state.lines, { productId: action.productId, quantity }],
    };
  }

  return {
    lines: state.lines.map((line) =>
      line.productId === action.productId
        ? {
            ...line,
            quantity: Math.min(MAX_CART_QUANTITY, line.quantity + quantity),
          }
        : line,
    ),
  };
}

export function serializeCart(state: CartState): string {
  return JSON.stringify({ version: 1, lines: state.lines });
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
