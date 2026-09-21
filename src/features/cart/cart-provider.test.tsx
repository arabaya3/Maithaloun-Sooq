import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { CartProvider, useCart } from "@/features/cart/cart-provider";

import { CART_STORAGE_KEY } from "./cart-store";

function CartProbe() {
  const { addItem, count } = useCart();

  return (
    <button type="button" onClick={() => addItem("general-cleaner", 2)}>
      {count}
    </button>
  );
}

describe("CartProvider", () => {
  it("restores valid persisted cart data and persists updates", async () => {
    window.localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        lines: [{ productId: "dolphin-bleach", quantity: 1 }],
      }),
    );

    const user = userEvent.setup();
    render(
      <CartProvider>
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
        version: 1,
        lines: [
          { productId: "dolphin-bleach", quantity: 1 },
          { productId: "general-cleaner", quantity: 2 },
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
      <CartProvider>
        <CartProbe />
      </CartProvider>,
    );

    expect(
      await screen.findByRole("button", { name: "0" }),
    ).toBeInTheDocument();
  });
});
