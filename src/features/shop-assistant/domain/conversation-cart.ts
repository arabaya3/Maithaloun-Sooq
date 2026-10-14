import { z } from "zod";

import { MAX_CART_QUANTITY } from "@/features/cart/cart-store";
import { checkoutItemSchema } from "@/features/orders/domain/checkout-request";

export const MAX_ASSISTANT_CART_LINES = 20;

export const assistantCartLineSchema = checkoutItemSchema;
export type AssistantCartLine = z.output<typeof assistantCartLineSchema>;

export const assistantCartSchema = z
  .array(assistantCartLineSchema)
  .max(MAX_ASSISTANT_CART_LINES);

const sameLine = (a: AssistantCartLine, b: AssistantCartLine) =>
  a.productId === b.productId &&
  a.variantId === b.variantId &&
  (a.sellingUnitId ?? null) === (b.sellingUnitId ?? null);

/** Adds to a line or creates it; quantities stay within the cart limit. */
export function addToCart(
  cart: readonly AssistantCartLine[],
  line: AssistantCartLine,
): AssistantCartLine[] {
  const existing = cart.find((entry) => sameLine(entry, line));
  if (existing) {
    return cart.map((entry) =>
      entry === existing
        ? {
            ...entry,
            quantity: Math.min(
              MAX_CART_QUANTITY,
              entry.quantity + line.quantity,
            ),
          }
        : entry,
    );
  }
  if (cart.length >= MAX_ASSISTANT_CART_LINES) {
    throw new RangeError("cart_full");
  }
  return [
    ...cart,
    { ...line, quantity: Math.min(MAX_CART_QUANTITY, line.quantity) },
  ];
}

/** Sets a line's quantity; zero removes it. */
export function setCartQuantity(
  cart: readonly AssistantCartLine[],
  line: Omit<AssistantCartLine, "quantity">,
  quantity: number,
): AssistantCartLine[] {
  const target = { ...line, quantity: 1 };
  if (quantity <= 0) return cart.filter((entry) => !sameLine(entry, target));
  return cart.map((entry) =>
    sameLine(entry, target)
      ? { ...entry, quantity: Math.min(MAX_CART_QUANTITY, quantity) }
      : entry,
  );
}
