import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { CartProvider } from "@/features/cart/cart-provider";
import type { Product } from "@/features/catalog/domain/product";

import { Storefront } from "./storefront";

const products: Product[] = [
  {
    id: "general-cleaner",
    name: "منظف عام Secret",
    priceIls: 7,
    categoryId: "home",
    image: { kind: "placeholder" },
    detailsStatus: "unknown",
    purchasable: true,
  },
  {
    id: "arar-dish-liquid",
    name: "سائل جلي Arar",
    priceIls: 12,
    categoryId: "kitchen",
    image: { kind: "placeholder" },
    detailsStatus: "unknown",
    purchasable: true,
  },
  {
    id: "unavailable-cleaner",
    name: "منظف غير متاح",
    priceIls: 8,
    categoryId: "bathroom",
    image: { kind: "placeholder" },
    detailsStatus: "unknown",
    purchasable: false,
  },
];

function renderStorefront() {
  return render(
    <CartProvider>
      <Storefront products={products} />
    </CartProvider>,
  );
}

describe("storefront", () => {
  it("renders the official identity, products, currency, and accessible controls", () => {
    renderStorefront();

    expect(
      screen.getByRole("link", { name: "سوق ميثلون، الرئيسية" }),
    ).toBeInTheDocument();
    expect(screen.getByText("منظف عام Secret")).toBeInTheDocument();
    expect(screen.getByText(/٧ ₪/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "إضافة منظف عام Secret إلى المفضلة",
      }),
    ).toBeInTheDocument();
  });

  it("filters by search and exposes a clear action", async () => {
    const user = userEvent.setup();
    renderStorefront();

    await user.type(
      screen.getByRole("searchbox", { name: "ابحث في منتجات التنظيف" }),
      "Arar",
    );

    expect(screen.queryByText("منظف عام Secret")).not.toBeInTheDocument();
    expect(screen.getByText("سائل جلي Arar")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "مسح البحث" }));
    expect(screen.getByText("منظف عام Secret")).toBeInTheDocument();
  });

  it("filters by category", async () => {
    const user = userEvent.setup();
    renderStorefront();

    await user.click(screen.getByRole("button", { name: "منظفات المطبخ" }));
    expect(screen.queryByText("منظف عام Secret")).not.toBeInTheDocument();
    expect(screen.getByText("سائل جلي Arar")).toBeInTheDocument();

    await user.type(
      screen.getByRole("searchbox", { name: "ابحث في منتجات التنظيف" }),
      "غير موجود",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "لا توجد نتائج مطابقة",
    );
    await user.click(screen.getByRole("button", { name: "عرض كل المنتجات" }));
    expect(screen.getByText("منظف عام Secret")).toBeInTheDocument();
  });

  it("adds the selected quantity and updates the cart count", async () => {
    const user = userEvent.setup();
    renderStorefront();

    const firstCard = screen.getByText("منظف عام Secret").closest("article");
    expect(firstCard).not.toBeNull();
    await user.click(
      within(firstCard!).getByRole("button", {
        name: "زيادة كمية منظف عام Secret",
      }),
    );
    await user.click(within(firstCard!).getByRole("button", { name: /^أضف$/ }));

    expect(
      screen.getByRole("button", { name: "السلة، منتجان" }),
    ).toBeInTheDocument();
  });

  it("prevents quantity changes and cart additions for unavailable products", () => {
    renderStorefront();

    const card = screen.getByText("منظف غير متاح").closest("article");
    expect(card).not.toBeNull();
    expect(
      within(card!).getByRole("button", { name: "غير متاح" }),
    ).toBeDisabled();
    expect(
      within(card!).getByRole("button", {
        name: "زيادة كمية منظف غير متاح",
      }),
    ).toBeDisabled();
  });
});
