import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { CartPage } from "@/features/cart/components/cart-page";
import { CART_STORAGE_KEY } from "@/features/cart/cart-store";
import type { Product } from "@/features/catalog/domain/product";
import { renderWithProviders } from "@/test/render-with-providers";
import { MockProductRepository } from "@/test/mock-product-repository";

describe("cart page", () => {
  const productRepository = new MockProductRepository();

  it("renders an empty-cart state", async () => {
    const products = await productRepository.list();
    renderWithProviders(<CartPage products={products} />, {
      productIds: products.map((product) => product.id),
    });

    expect(
      await screen.findByRole("heading", { name: "سلتك فارغة" }),
    ).toBeInTheDocument();
  });

  it("resolves authoritative prices, updates quantities, and removes a line", async () => {
    const products = await productRepository.list();
    window.localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        lines: [{ productId: "general-cleaner", quantity: 2 }],
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<CartPage products={products} />, {
      productIds: products.map((product) => product.id),
    });

    const line = await screen.findByRole("article");
    expect(
      within(line).getByLabelText("مجموع منظف عام Secret 14 ₪"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("المجموع الفرعي 14 ₪")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "متابعة إلى بيانات الطلب" }),
    ).toBeInTheDocument();

    await user.click(
      within(line).getByRole("button", {
        name: "زيادة كمية منظف عام Secret",
      }),
    );
    expect(screen.getByLabelText("المجموع الفرعي 21 ₪")).toBeInTheDocument();

    await user.click(
      within(line).getByRole("button", {
        name: "إزالة منظف عام Secret من السلة",
      }),
    );
    expect(
      await screen.findByRole("heading", { name: "سلتك فارغة" }),
    ).toBeInTheDocument();
  });

  it("clears the cart after explicit confirmation", async () => {
    const products = await productRepository.list();
    window.localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        lines: [{ productId: "dolphin-bleach", quantity: 1 }],
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<CartPage products={products} />, {
      productIds: products.map((product) => product.id),
    });

    await user.click(
      await screen.findByRole("button", { name: "إفراغ السلة" }),
    );
    await user.click(screen.getByRole("button", { name: "نعم، أفرغ السلة" }));
    expect(
      await screen.findByRole("heading", { name: "سلتك فارغة" }),
    ).toBeInTheDocument();
  });

  it("marks unavailable lines and excludes them from the subtotal", async () => {
    const products = await productRepository.list();
    const unavailableProducts: Product[] = products.map((product) =>
      product.id === "general-cleaner"
        ? { ...product, availability: "unavailable" }
        : product,
    );
    window.localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        lines: [{ productId: "general-cleaner", quantity: 1 }],
      }),
    );
    renderWithProviders(<CartPage products={unavailableProducts} />, {
      productIds: products.map((product) => product.id),
    });

    expect(
      await screen.findByText("غير متاح حالياً ولا يدخل في المجموع."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("المجموع الفرعي 0 ₪")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "زيادة كمية منظف عام Secret",
      }),
    ).toBeDisabled();
  });
});
