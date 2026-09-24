import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { CartProvider, useCart } from "@/features/cart/cart-provider";

import { CART_STORAGE_KEY, LEGACY_CART_STORAGE_KEY } from "./cart-store";

function CartProbe() {
  const { addItem, count } = useCart();

  return (
    <button
      type="button"
      onClick={() => addItem("general-cleaner", "general-cleaner--default", 2)}
    >
      {count}
    </button>
  );
}

const catalog = [
  {
    productId: "general-cleaner",
    defaultVariantId: "general-cleaner--default",
    variantIds: ["general-cleaner--default"],
  },
  {
    productId: "dolphin-bleach",
    defaultVariantId: "dolphin-bleach--default",
    variantIds: ["dolphin-bleach--default"],
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

    await waitFor(() => {
      expect(
        JSON.parse(window.localStorage.getItem(CART_STORAGE_KEY) ?? ""),
      ).toEqual({
        version: 2,
        lines: [
          {
            productId: "dolphin-bleach",
            variantId: "dolphin-bleach--default",
            quantity: 1,
          },
          {
            productId: "general-cleaner",
            variantId: "general-cleaner--default",
            quantity: 2,
          },
        ],
      });
    });
  });

  it("recovers safely from invalid persisted data", async () => {
    window.localStorage.setItem(
      CART_STORAGE_KEY,
      '{"version":1,"lines":"bad"}',
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
