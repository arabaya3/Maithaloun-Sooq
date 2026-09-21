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
  const productIds = new Set(["general-cleaner", "dolphin-bleach"]);

  it("rejects malformed and out-of-range persisted payloads", () => {
    expect(parsePersistedCart("not-json", productIds)).toEqual(
      initialCartState,
    );
    expect(
      parsePersistedCart(
        JSON.stringify({
          version: 1,
          lines: [{ productId: "general-cleaner", quantity: 1000 }],
        }),
        productIds,
      ),
    ).toEqual(initialCartState);
    expect(
      parsePersistedCart(
        JSON.stringify({
          version: 2,
          lines: [{ productId: "general-cleaner", quantity: 1 }],
        }),
        productIds,
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
        productIds,
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
        productIds,
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
        productIds,
      ),
    ).toEqual(initialCartState);
  });

  it("stores identifiers and quantities without persisted prices", () => {
    const state = cartReducer(initialCartState, {
      type: "add",
      productId: "general-cleaner",
      quantity: 2,
    });

    expect(state.lines).toEqual([
      { productId: "general-cleaner", quantity: 2 },
    ]);
    expect(state.lines[0]).not.toHaveProperty("price");
  });

  it("enforces quantity boundaries and supports updating and removing lines", () => {
    const added = cartReducer(initialCartState, {
      type: "add",
      productId: "general-cleaner",
      quantity: MAX_CART_QUANTITY + 5,
    });
    expect(added.lines[0]?.quantity).toBe(MAX_CART_QUANTITY);

    const lowered = cartReducer(added, {
      type: "setQuantity",
      productId: "general-cleaner",
      quantity: 0,
    });
    expect(lowered.lines[0]?.quantity).toBe(1);

    const removed = cartReducer(lowered, {
      type: "remove",
      productId: "general-cleaner",
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
