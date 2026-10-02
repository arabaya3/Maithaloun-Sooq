import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import {
  seedCategories,
  type Product,
} from "@/features/catalog/domain/product";
import { withDefaultVariant } from "@/test/mock-product-repository";
import { renderWithProviders } from "@/test/render-with-providers";

import { Storefront } from "./storefront";

const products: Product[] = [
  withDefaultVariant({
    id: "general-cleaner",
    slug: "general-cleaner-secret",
    nameAr: "منظف عام",
    latinName: "Secret",
    priceAgorot: 700,
    categoryId: "home",
    image: { kind: "placeholder", variant: "general-cleaner" },
    availability: "available",
    detailsStatus: "placeholder",
  }),
  withDefaultVariant({
    id: "arar-dish-liquid",
    slug: "arar-dish-liquid",
    nameAr: "سائل جلي",
    latinName: "Arar",
    priceAgorot: 1200,
    categoryId: "kitchen",
    image: { kind: "placeholder", variant: "dish-liquid" },
    availability: "available",
    detailsStatus: "placeholder",
  }),
  withDefaultVariant({
    id: "unavailable-cleaner",
    slug: "unavailable-cleaner",
    nameAr: "منظف غير متاح",
    priceAgorot: 800,
    categoryId: "bathroom",
    image: { kind: "placeholder", variant: "general-cleaner" },
    availability: "unavailable",
    detailsStatus: "placeholder",
  }),
];

const categories = seedCategories.map((category, sortOrder) => ({
  ...category,
  description: null,
  sortOrder,
  visible: true,
}));

function renderStorefront() {
  return renderWithProviders(
    <Storefront products={products} categories={categories} />,
    { products },
  );
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

  it("greets, then renders the hero text as HTML beside one decorative image", () => {
    const { container } = renderStorefront();

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "أهلًا! شو ناقص البيت اليوم؟",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: /أساسيات البيت،.*أقرب إلك/,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ابدأ التسوق" })).toHaveAttribute(
      "href",
      "#catalog",
    );
    const facts = container.querySelector(".hero-facts");
    expect(facts).toHaveTextContent("توصيل داخل ميثلون");
    expect(facts).toHaveTextContent("الدفع عند الاستلام");
    const images = container.querySelectorAll(".hero img");
    expect(images).toHaveLength(1);
    expect(images[0]).toHaveAttribute("alt", "");
    expect(images[0]).toHaveAttribute("fetchpriority", "high");
    expect(container.querySelectorAll(".hero source")).toHaveLength(1);
    expect(screen.queryByText(/جودة عالية|منتجات مختارة/)).toBeNull();
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
      screen.getByRole("searchbox", { name: "ابحث في المنتجات" }),
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
      screen.getByRole("searchbox", { name: "ابحث في المنتجات" }),
      "غير موجود",
    );
    expect(screen.getByText("لا توجد نتائج مطابقة")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "عرض كل المنتجات" }));
    expect(screen.getByText("منظف عام Secret")).toBeInTheDocument();
  });

  it("adds to the cart, then adjusts and removes the quantity in place", async () => {
    const user = userEvent.setup();
    renderStorefront();

    const card = screen.getByText("منظف عام Secret").closest("article")!;
    expect(
      within(card).queryByRole("button", {
        name: "زيادة كمية منظف عام Secret",
      }),
    ).toBeNull();
    await user.click(
      within(card).getByRole("button", { name: "أضف إلى السلة" }),
    );
    await user.click(
      within(card).getByRole("button", {
        name: "زيادة كمية منظف عام Secret",
      }),
    );
    expect(
      screen.getByRole("link", { name: /^السلة، عدد المنتجات\s*2$/ }),
    ).toBeVisible();

    await user.click(
      within(card).getByRole("button", {
        name: "تقليل كمية منظف عام Secret",
      }),
    );
    await user.click(
      within(card).getByRole("button", {
        name: "إزالة منظف عام Secret من السلة",
      }),
    );
    expect(
      within(card).getByRole("button", { name: "أضف إلى السلة" }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: /^السلة، عدد المنتجات\s*0$/ }),
    ).toBeInTheDocument();
  });

  it("prevents quantity changes and cart additions for unavailable products", () => {
    renderStorefront();

    const card = screen.getByText("منظف غير متاح").closest("article");
    expect(card).not.toBeNull();
    expect(
      within(card!).queryByRole("button", { name: "أضف إلى السلة" }),
    ).toBeNull();
    expect(
      within(card!).queryByRole("button", {
        name: "زيادة كمية منظف غير متاح",
      }),
    ).toBeNull();
    expect(within(card!).getByText("غير متوفر حالياً")).toBeVisible();
  });
});
