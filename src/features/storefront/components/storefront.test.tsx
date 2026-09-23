import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { Product } from "@/features/catalog/domain/product";
import { renderWithProviders } from "@/test/render-with-providers";

import { Storefront } from "./storefront";

const products: Product[] = [
  {
    id: "general-cleaner",
    slug: "general-cleaner-secret",
    nameAr: "منظف عام",
    latinName: "Secret",
    priceAgorot: 700,
    categoryId: "home",
    image: { kind: "placeholder", variant: "general-cleaner" },
    availability: "available",
    detailsStatus: "placeholder",
  },
  {
    id: "arar-dish-liquid",
    slug: "arar-dish-liquid",
    nameAr: "سائل جلي",
    latinName: "Arar",
    priceAgorot: 1200,
    categoryId: "kitchen",
    image: { kind: "placeholder", variant: "dish-liquid" },
    availability: "available",
    detailsStatus: "placeholder",
  },
  {
    id: "unavailable-cleaner",
    slug: "unavailable-cleaner",
    nameAr: "منظف غير متاح",
    priceAgorot: 800,
    categoryId: "bathroom",
    image: { kind: "placeholder", variant: "general-cleaner" },
    availability: "unavailable",
    detailsStatus: "placeholder",
  },
];

function renderStorefront() {
  return renderWithProviders(<Storefront products={products} />, {
    productIds: products.map((product) => product.id),
  });
}

describe("storefront", () => {
  it("renders the official identity, products, currency, and accessible controls", () => {
    renderStorefront();

    expect(
      screen.getByRole("link", { name: "سوق ميثلون، الرئيسية" }),
    ).toBeInTheDocument();
    expect(screen.getByText("منظف عام Secret")).toHaveAttribute("dir", "auto");
    expect(screen.getByText("7 ₪")).toHaveAttribute("dir", "ltr");
    expect(screen.getByLabelText("السعر 7 ₪")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "إضافة منظف عام Secret إلى المفضلة",
      }),
    ).toBeInTheDocument();
  });

  it("provides a concise commercial hero without decorative art", () => {
    const { container } = renderStorefront();

    expect(screen.getByRole("combobox", { name: "منطقة التوصيل" })).toHaveValue(
      "",
    );

    expect(container.querySelector(".promo-copy")).not.toBeNull();
    expect(container.querySelector(".promo-art")).toBeNull();
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "منتجات تنظيف للبيت، بأسعار واضحة",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "تسوّق المنتجات" }),
    ).toBeInTheDocument();
  });

  it("orders RTL categories from all to home and exposes selection semantics", async () => {
    const user = userEvent.setup();
    const { container } = renderStorefront();
    const categoryButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".category-item"),
    );

    expect(categoryButtons[0]).toHaveTextContent("الكل");
    expect(categoryButtons.at(-1)).toHaveTextContent("مستلزمات منزلية");
    expect(categoryButtons[0]).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "مستلزمات منزلية" }));
    expect(
      screen.getByRole("button", { name: "مستلزمات منزلية" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "الكل" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("selects distinct local placeholder variants from product data", () => {
    const { container } = renderStorefront();

    expect(
      container.querySelector('[data-placeholder-kind="general-cleaner"]'),
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-placeholder-kind="dish-liquid"]'),
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
    expect(screen.getByText("لا توجد نتائج مطابقة")).toBeInTheDocument();
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

    expect(screen.getAllByRole("link", { name: "السلة، منتجان" })).toHaveLength(
      2,
    );
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
