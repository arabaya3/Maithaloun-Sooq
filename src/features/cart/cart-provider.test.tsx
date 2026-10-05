import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { CartProvider, useCart } from "@/features/cart/cart-provider";

import {
  CART_STORAGE_KEY,
  LEGACY_CART_STORAGE_KEY,
  PREVIOUS_CART_STORAGE_KEY,
} from "./cart-store";

const CLEANER = "11111111-1111-4111-8111-000000000001";
const CLEANER_PACK = "11111111-1111-4111-8111-000000000003";
const BLEACH = "11111111-1111-4111-8111-000000000010";

function CartProbe() {
  const { addItem, count } = useCart();

  return (
    <>
      <button
        type="button"
        onClick={() =>
          addItem(
            {
              productId: "general-cleaner",
              variantId: "general-cleaner--default",
              sellingUnitId: CLEANER_PACK,
              unitsPerSale: 3,
            },
            2,
          )
        }
      >
        {count}
      </button>
      <button
        type="button"
        onClick={() =>
          addItem(
            {
              productId: "general-cleaner",
              variantId: "general-cleaner--default",
              sellingUnitId: CLEANER_PACK,
              unitsPerSale: 6,
            },
            1,
          )
        }
      >
        forged
      </button>
    </>
  );
}

const catalog = [
  {
    productId: "general-cleaner",
    defaultVariantId: "general-cleaner--default",
    variants: [
      {
        id: "general-cleaner--default",
        sellingUnits: [
          { id: CLEANER, unitsPerSale: 1 },
          { id: CLEANER_PACK, unitsPerSale: 3 },
        ],
      },
    ],
  },
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
];

describe("CartProvider", () => {
  it("restores valid persisted cart data and persists updates", async () => {
    window.localStorage.setItem(
      LEGACY_CART_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        lines: [{ productId: "dolphin-bleach", quantity: 1 }],
      }),
    );

    const user = userEvent.setup();
    render(
      <CartProvider catalog={catalog}>
        <CartProbe />
      </CartProvider>,
    );

    expect(
      await screen.findByRole("button", { name: "1" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "1" }));
    // A unit with a pieces count the catalog does not sell is refused.
    await user.click(screen.getByRole("button", { name: "forged" }));

    await waitFor(() => {
      expect(
        JSON.parse(window.localStorage.getItem(CART_STORAGE_KEY) ?? ""),
      ).toEqual({
        version: 3,
        lines: [
          {
            productId: "dolphin-bleach",
            variantId: "dolphin-bleach--default",
            sellingUnitId: BLEACH,
            unitsPerSale: 1,
            quantity: 1,
          },
          {
            productId: "general-cleaner",
            variantId: "general-cleaner--default",
            sellingUnitId: CLEANER_PACK,
            unitsPerSale: 3,
            quantity: 2,
          },
        ],
      });
    });
    expect(window.localStorage.getItem(LEGACY_CART_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(PREVIOUS_CART_STORAGE_KEY)).toBeNull();
  });

  it("recovers safely from invalid persisted data", async () => {
    window.localStorage.setItem(
      CART_STORAGE_KEY,
      '{"version":3,"lines":"bad"}',
    );

    render(
      <CartProvider catalog={catalog}>
        <CartProbe />
      </CartProvider>,
    );

    expect(
      await screen.findByRole("button", { name: "0" }),
    ).toBeInTheDocument();
  });
});
