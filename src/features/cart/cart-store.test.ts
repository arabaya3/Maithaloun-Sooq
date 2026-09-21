import { describe, expect, it } from "vitest";

import {
  cartReducer,
  initialCartState,
  parsePersistedCart,
} from "./cart-store";

describe("cart store", () => {
  it("rejects malformed and out-of-range persisted payloads", () => {
    expect(parsePersistedCart("not-json")).toEqual(initialCartState);
    expect(
      parsePersistedCart(
        JSON.stringify({
          version: 1,
          lines: [{ productId: "general-cleaner", quantity: 1000 }],
        }),
      ),
    ).toEqual(initialCartState);
    expect(
      parsePersistedCart(
        JSON.stringify({
          version: 2,
          lines: [{ productId: "general-cleaner", quantity: 1 }],
        }),
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
});
