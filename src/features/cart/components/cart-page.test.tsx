import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { CartPage } from "@/features/cart/components/cart-page";
import {
  CART_STORAGE_KEY,
  PREVIOUS_CART_STORAGE_KEY,
} from "@/features/cart/cart-store";
import type { Product } from "@/features/catalog/domain/product";
import { renderWithProviders } from "@/test/render-with-providers";
import {
  MockProductRepository,
  fixtureUuid,
  multipackClothFixture,
} from "@/test/mock-product-repository";

const blueSingle = fixtureUuid("test-cloth--blue:single");
const bluePack = fixtureUuid("test-cloth--blue:pack3");
const clothLine = (
  sellingUnitId: string,
  unitsPerSale: number,
  quantity: number,
) => ({
  productId: "test-cloth",
  variantId: "test-cloth--blue",
  sellingUnitId,
  unitsPerSale,
  quantity,
});

describe("cart page", () => {
  const productRepository = new MockProductRepository();

  it("renders an empty-cart state", async () => {
    const products = await productRepository.list();
    renderWithProviders(<CartPage products={products} />, { products });

    expect(
      await screen.findByRole("heading", { name: "سلتك فارغة" }),
    ).toBeInTheDocument();
  });

  it("resolves authoritative prices, updates quantities, and removes a line", async () => {
    const products = await productRepository.list();
    window.localStorage.setItem(
      PREVIOUS_CART_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        lines: [
          {
            productId: "general-cleaner",
            variantId: "general-cleaner--default",
            quantity: 2,
          },
        ],
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<CartPage products={products} />, { products });

    const line = await screen.findByRole("article");
    expect(
      within(line).getByLabelText("مجموع منظف عام Secret 14 ₪"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("مجموع المنتجات 14 ₪")).toBeInTheDocument();
    expect(screen.getByLabelText("التوصيل 5 ₪")).toBeInTheDocument();
    expect(screen.getByLabelText("الإجمالي 19 ₪")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "متابعة إلى بيانات الطلب" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("أضف 36 ₪ لتحصل على توصيل مجاني"),
    ).toBeInTheDocument();

    await user.click(
      within(line).getByRole("button", {
        name: "زيادة كمية منظف عام Secret",
      }),
    );
    expect(screen.getByLabelText("مجموع المنتجات 21 ₪")).toBeInTheDocument();

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
      PREVIOUS_CART_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        lines: [
          {
            productId: "dolphin-bleach",
            variantId: "dolphin-bleach--default",
            quantity: 1,
          },
        ],
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<CartPage products={products} />, { products });

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
        ? {
            ...product,
            availability: "unavailable",
            variants: product.variants.map((variant) => ({
              ...variant,
              availability: "unavailable" as const,
            })),
          }
        : product,
    );
    window.localStorage.setItem(
      PREVIOUS_CART_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        lines: [
          {
            productId: "general-cleaner",
            variantId: "general-cleaner--default",
            quantity: 1,
          },
        ],
      }),
    );
    renderWithProviders(<CartPage products={unavailableProducts} />, {
      products: unavailableProducts,
    });

    expect(
      await screen.findByText("غير متاح حالياً ولا يدخل في المجموع."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("مجموع المنتجات 0 ₪")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "زيادة كمية منظف عام Secret",
      }),
    ).toBeDisabled();
  });

  it("shows two 3-packs as packs with their piece count and price", async () => {
    const products = [multipackClothFixture({ blueFreePieces: 10 })];
    window.localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify({
        version: 3,
        lines: [clothLine(bluePack, 3, 2), clothLine(blueSingle, 1, 1)],
      }),
    );
    renderWithProviders(<CartPage products={products} />, { products });

    const [packLine, singleLine] = await screen.findAllByRole("article");
    expect(within(packLine!).getByText("باكيج 3 حبات × 2")).toBeInTheDocument();
    expect(within(packLine!).getByText("إجمالي القطع: 6")).toBeInTheDocument();
    expect(
      within(packLine!).getByLabelText("مجموع ممسحة تنظيف 20 ₪"),
    ).toBeInTheDocument();
    expect(within(packLine!).queryByText(/2 حبة/)).not.toBeInTheDocument();
    expect(within(singleLine!).getByText("حبة واحدة × 1")).toBeInTheDocument();
    expect(screen.getByLabelText("مجموع المنتجات 24 ₪")).toBeInTheDocument();
  });

  it("limits pack quantity to what base stock can fill", async () => {
    const products = [multipackClothFixture({ blueFreePieces: 7 })];
    window.localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify({ version: 3, lines: [clothLine(bluePack, 3, 2)] }),
    );
    renderWithProviders(<CartPage products={products} />, { products });
    expect(
      await screen.findByRole("button", {
        name: "زيادة كمية ممسحة تنظيف — باكيج 3 حبات",
      }),
    ).toBeDisabled();
  });

  it("asks for a new choice when the unit was archived or changed", async () => {
    const products = [multipackClothFixture({ blueFreePieces: 10 })];
    const user = userEvent.setup();
    window.localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify({
        version: 3,
        // Saved when the pack held 2 pieces; it now holds 3, so it is not converted silently.
        lines: [clothLine(bluePack, 2, 1)],
      }),
    );
    renderWithProviders(<CartPage products={products} />, { products });

    expect(
      await screen.findByText(/تغيّرت طريقة الشراء لهذا المنتج/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("مجموع المنتجات 0 ₪")).toBeInTheDocument();
    expect(
      screen.getByText("راجع المنتجات المعلَّمة في السلة قبل المتابعة."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /باكيج 3 حبات/ }));
    expect(await screen.findByText("باكيج 3 حبات × 1")).toBeInTheDocument();
    expect(screen.getByLabelText("مجموع المنتجات 10 ₪")).toBeInTheDocument();
  });
});
