import { z } from "zod";

export const CART_STORAGE_KEY = "souq-maythalun:cart:v1";

const cartLineSchema = z
  .object({
    productId: z.string().regex(/^[a-z0-9-]{1,80}$/),
    quantity: z.number().int().min(1).max(99),
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
  | { type: "clear" };

export const initialCartState: CartState = { lines: [] };

export function parsePersistedCart(raw: string | null): CartState {
  if (!raw) return initialCartState;

  try {
    const parsed = persistedCartSchema.safeParse(JSON.parse(raw));
    return parsed.success ? { lines: parsed.data.lines } : initialCartState;
  } catch {
    return initialCartState;
  }
}

export function cartReducer(state: CartState, action: CartAction): CartState {
  if (action.type === "restore") return { lines: action.lines };
  if (action.type === "clear") return initialCartState;

  const quantity = Math.max(1, Math.min(99, Math.trunc(action.quantity)));
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
        ? { ...line, quantity: Math.min(99, line.quantity + quantity) }
        : line,
    ),
  };
}

export function serializeCart(state: CartState): string {
  return JSON.stringify({ version: 1, lines: state.lines });
}
