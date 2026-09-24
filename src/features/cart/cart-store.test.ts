import { describe, expect, it } from "vitest";

import {
  calculateCartSubtotal,
  calculateLineSubtotal,
  cartReducer,
  initialCartState,
  MAX_CART_QUANTITY,
  parsePersistedCart,
} from "./cart-store";

describe("cart store", () => {
  const allowedPairs = new Map<string, ReadonlySet<string>>([
    ["general-cleaner", new Set(["general-cleaner--default"])],
    ["dolphin-bleach", new Set(["dolphin-bleach--default"])],
  ]);
  const defaultVariantByProduct = new Map([
    ["general-cleaner", "general-cleaner--default"],
    ["dolphin-bleach", "dolphin-bleach--default"],
  ]);

  it("rejects malformed and out-of-range persisted payloads", () => {
    expect(
      parsePersistedCart("not-json", allowedPairs, defaultVariantByProduct),
    ).toEqual(initialCartState);
    expect(
      parsePersistedCart(
        JSON.stringify({
          version: 1,
          lines: [{ productId: "general-cleaner", quantity: 1000 }],
        }),
        allowedPairs,
        defaultVariantByProduct,
      ),
    ).toEqual(initialCartState);
    expect(
      parsePersistedCart(
        JSON.stringify({
          version: 2,
          lines: [{ productId: "general-cleaner", quantity: 1 }],
        }),
        allowedPairs,
        defaultVariantByProduct,
      ),
    ).toEqual(initialCartState);
    expect(
      parsePersistedCart(
        JSON.stringify({
          version: 1,
          lines: [
            {
              productId: "general-cleaner",
              quantity: 1,
              price: 0,
            },
          ],
        }),
        allowedPairs,
        defaultVariantByProduct,
      ),
    ).toEqual(initialCartState);
  });

  it("rejects unknown and duplicated persisted product IDs", () => {
    expect(
      parsePersistedCart(
        JSON.stringify({
          version: 1,
          lines: [{ productId: "unknown-product", quantity: 1 }],
        }),
        allowedPairs,
        defaultVariantByProduct,
      ),
    ).toEqual(initialCartState);
    expect(
      parsePersistedCart(
        JSON.stringify({
          version: 1,
          lines: [
            { productId: "general-cleaner", quantity: 1 },
            { productId: "general-cleaner", quantity: 2 },
          ],
        }),
        allowedPairs,
        defaultVariantByProduct,
      ),
    ).toEqual(initialCartState);
  });

  it("migrates legacy v1 lines to default variants", () => {
    expect(
      parsePersistedCart(
        null,
        allowedPairs,
        defaultVariantByProduct,
        JSON.stringify({
          version: 1,
          lines: [{ productId: "general-cleaner", quantity: 2 }],
        }),
      ),
    ).toEqual({
      lines: [
        {
          productId: "general-cleaner",
          variantId: "general-cleaner--default",
          quantity: 2,
        },
      ],
    });
  });

  it("stores identifiers and quantities without persisted prices", () => {
    const state = cartReducer(initialCartState, {
      type: "add",
      productId: "general-cleaner",
      variantId: "general-cleaner--default",
      quantity: 2,
    });

    expect(state.lines).toEqual([
      {
        productId: "general-cleaner",
        variantId: "general-cleaner--default",
        quantity: 2,
      },
    ]);
    expect(state.lines[0]).not.toHaveProperty("price");
  });

  it("enforces quantity boundaries and supports updating and removing lines", () => {
    const added = cartReducer(initialCartState, {
      type: "add",
      productId: "general-cleaner",
      variantId: "general-cleaner--default",
      quantity: MAX_CART_QUANTITY + 5,
    });
    expect(added.lines[0]?.quantity).toBe(MAX_CART_QUANTITY);

    const lowered = cartReducer(added, {
      type: "setQuantity",
      productId: "general-cleaner",
      variantId: "general-cleaner--default",
      quantity: 0,
    });
    expect(lowered.lines[0]?.quantity).toBe(1);

    const removed = cartReducer(lowered, {
      type: "remove",
      productId: "general-cleaner",
      variantId: "general-cleaner--default",
    });
    expect(removed).toEqual(initialCartState);
    expect(cartReducer(added, { type: "clear" })).toEqual(initialCartState);
  });

  it("calculates line and cart subtotals using integer minor units", () => {
    expect(calculateLineSubtotal(700, 3)).toBe(2100);
    expect(
      calculateCartSubtotal([
        { unitPriceAgorot: 700, quantity: 2 },
        { unitPriceAgorot: 1200, quantity: 1 },
      ]),
    ).toBe(2600);
  });
});
