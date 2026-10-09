import { describe, expect, it } from "vitest";

import {
  calculateCartSubtotal,
  calculateLineSubtotal,
  cartReducer,
  initialCartState,
  isCartLineCurrent,
  MAX_CART_QUANTITY,
  parsePersistedCart,
  type CartCatalog,
  type CartLine,
} from "./cart-store";

const SINGLE = "11111111-1111-4111-8111-000000000001";
const PACK = "11111111-1111-4111-8111-000000000003";
const BLEACH = "11111111-1111-4111-8111-000000000010";

const catalog: CartCatalog = new Map([
  [
    "general-cleaner",
    {
      productId: "general-cleaner",
      defaultVariantId: "general-cleaner--default",
      variants: [
        {
          id: "general-cleaner--default",
          sellingUnits: [
            { id: SINGLE, unitsPerSale: 1 },
            { id: PACK, unitsPerSale: 3 },
          ],
        },
      ],
    },
  ],
  [
    "dolphin-bleach",
    {
      productId: "dolphin-bleach",
      defaultVariantId: "dolphin-bleach--default",
      variants: [
        {
          id: "dolphin-bleach--default",
          sellingUnits: [{ id: BLEACH, unitsPerSale: 1 }],
        },
      ],
    },
  ],
]);

const single = {
  productId: "general-cleaner",
  variantId: "general-cleaner--default",
  sellingUnitId: SINGLE,
  unitsPerSale: 1,
};
const pack = { ...single, sellingUnitId: PACK, unitsPerSale: 3 };

function v3(lines: unknown[]) {
  return { v3: JSON.stringify({ version: 3, lines }) };
}

describe("cart store", () => {
  it("rejects malformed and out-of-range persisted payloads", () => {
    expect(parsePersistedCart({ v3: "not-json" }, catalog)).toEqual(
      initialCartState,
    );
    expect(
      parsePersistedCart(v3([{ ...single, quantity: 1000 }]), catalog),
    ).toEqual(initialCartState);
    expect(
      parsePersistedCart(
        v3([{ ...single, quantity: 1, unitsPerSale: 0 }]),
        catalog,
      ),
    ).toEqual(initialCartState);
    expect(
      parsePersistedCart(
        v3([{ ...single, quantity: 1, unitsPerSale: 2.5 }]),
        catalog,
      ),
    ).toEqual(initialCartState);
    expect(
      parsePersistedCart(
        v3([{ ...single, quantity: 1, sellingUnitId: "not-a-uuid" }]),
        catalog,
      ),
    ).toEqual(initialCartState);
    expect(
      parsePersistedCart(v3([{ ...single, quantity: 1, price: 0 }]), catalog),
    ).toEqual(initialCartState);
  });

  it("rejects duplicated lines and drops products that left the catalog", () => {
    expect(
      parsePersistedCart(
        v3([
          { ...single, quantity: 1 },
          { ...single, quantity: 2 },
        ]),
        catalog,
      ),
    ).toEqual(initialCartState);
    expect(
      parsePersistedCart(
        v3([
          { ...single, quantity: 1 },
          { ...single, productId: "unknown-product", quantity: 1 },
        ]),
        catalog,
      ).lines,
    ).toEqual([{ ...single, quantity: 1 }]);
  });

  it("keeps a line whose variant was removed so the shopper sees why", () => {
    const removed = {
      ...single,
      variantId: "general-cleaner--old-size",
      quantity: 2,
    };
    expect(
      parsePersistedCart(v3([{ ...single, quantity: 1 }, removed]), catalog)
        .lines,
    ).toEqual([{ ...single, quantity: 1 }, removed]);
    expect(isCartLineCurrent(catalog, removed)).toBe(false);
  });

  it("keeps a single and a pack of the same variant as separate lines", () => {
    const restored = parsePersistedCart(
      v3([
        { ...single, quantity: 1 },
        { ...pack, quantity: 2 },
      ]),
      catalog,
    );
    expect(restored.lines).toHaveLength(2);

    let state = cartReducer(initialCartState, {
      type: "add",
      line: single,
      quantity: 1,
    });
    state = cartReducer(state, { type: "add", line: pack, quantity: 2 });
    state = cartReducer(state, { type: "add", line: pack, quantity: 1 });
    expect(state.lines).toEqual([
      { ...single, quantity: 1 },
      { ...pack, quantity: 3 },
    ]);
  });

  it("keeps a changed or unknown unit for review instead of converting it", () => {
    const changed: CartLine = { ...pack, unitsPerSale: 6, quantity: 1 };
    const unknown: CartLine = {
      ...single,
      sellingUnitId: "11111111-1111-4111-8111-0000000000ff",
      quantity: 1,
    };
    const state = parsePersistedCart(v3([changed, unknown]), catalog);
    expect(state.lines).toEqual([changed, unknown]);
    expect(isCartLineCurrent(catalog, changed)).toBe(false);
    expect(isCartLineCurrent(catalog, unknown)).toBe(false);
    expect(isCartLineCurrent(catalog, { ...pack, quantity: 1 })).toBe(true);
  });

  it("upgrades v2 and v1 lines through the one-piece unit only", () => {
    expect(
      parsePersistedCart(
        {
          v2: JSON.stringify({
            version: 2,
            lines: [
              {
                productId: "general-cleaner",
                variantId: "general-cleaner--default",
                quantity: 2,
              },
            ],
          }),
        },
        catalog,
      ),
    ).toEqual({ lines: [{ ...single, quantity: 2 }] });
    expect(
      parsePersistedCart(
        {
          v1: JSON.stringify({
            version: 1,
            lines: [{ productId: "dolphin-bleach", quantity: 2 }],
          }),
        },
        catalog,
      ),
    ).toEqual({
      lines: [
        {
          productId: "dolphin-bleach",
          variantId: "dolphin-bleach--default",
          sellingUnitId: BLEACH,
          unitsPerSale: 1,
          quantity: 2,
        },
      ],
    });
    // A variant without a one-piece unit keeps the line for review.
    const packOnly: CartCatalog = new Map([
      [
        "general-cleaner",
        {
          productId: "general-cleaner",
          defaultVariantId: "general-cleaner--default",
          variants: [
            {
              id: "general-cleaner--default",
              sellingUnits: [{ id: PACK, unitsPerSale: 3 }],
            },
          ],
        },
      ],
    ]);
    expect(
      parsePersistedCart(
        {
          v2: JSON.stringify({
            version: 2,
            lines: [
              {
                productId: "general-cleaner",
                variantId: "general-cleaner--default",
                quantity: 2,
              },
            ],
          }),
        },
        packOnly,
      ).lines,
    ).toEqual([{ ...single, sellingUnitId: null, quantity: 2 }]);
  });

  it("stores identifiers and counts without persisted prices", () => {
    const state = cartReducer(initialCartState, {
      type: "add",
      line: pack,
      quantity: 2,
    });
    expect(state.lines).toEqual([{ ...pack, quantity: 2 }]);
    expect(state.lines[0]).not.toHaveProperty("price");
  });

  it("enforces quantity boundaries and supports updating and removing lines", () => {
    const added = cartReducer(initialCartState, {
      type: "add",
      line: single,
      quantity: MAX_CART_QUANTITY + 5,
    });
    expect(added.lines[0]?.quantity).toBe(MAX_CART_QUANTITY);

    const lowered = cartReducer(added, {
      type: "setQuantity",
      line: single,
      quantity: 0,
    });
    expect(lowered.lines[0]?.quantity).toBe(1);

    const removed = cartReducer(lowered, { type: "remove", line: single });
    expect(removed).toEqual(initialCartState);
    expect(cartReducer(added, { type: "clear" })).toEqual(initialCartState);
  });

  it("moves a line to another unit and merges with an existing line for it", () => {
    let state = cartReducer(initialCartState, {
      type: "add",
      line: { ...single, sellingUnitId: null } as never,
      quantity: 2,
    });
    state = cartReducer(state, {
      type: "changeSellingUnit",
      line: { ...single, sellingUnitId: null },
      to: { sellingUnitId: PACK, unitsPerSale: 3 },
    });
    expect(state.lines).toEqual([{ ...pack, quantity: 2 }]);

    state = cartReducer(state, { type: "add", line: single, quantity: 1 });
    state = cartReducer(state, {
      type: "changeSellingUnit",
      line: single,
      to: { sellingUnitId: PACK, unitsPerSale: 3 },
    });
    expect(state.lines).toEqual([{ ...pack, quantity: 3 }]);
  });

  it("calculates line and cart subtotals using integer minor units", () => {
    expect(calculateLineSubtotal(700, 3)).toBe(2100);
    expect(calculateLineSubtotal(1000, 2)).toBe(2000);
    expect(
      calculateCartSubtotal([
        { unitPriceAgorot: 400, quantity: 1 },
        { unitPriceAgorot: 1000, quantity: 2 },
      ]),
    ).toBe(2400);
    expect(() => calculateLineSubtotal(400, 0)).toThrow(RangeError);
  });
});
