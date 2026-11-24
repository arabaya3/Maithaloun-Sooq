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
      screen.getByRole("link", { name: "MAYTHA MARKET، الرئيسية" }),
    ).toBeInTheDocument();
    expect(screen.getByText("منظف عام Secret")).toHaveAttribute("dir", "auto");
    expect(screen.getByText("7 ₪")).toHaveAttribute("dir", "ltr");
    expect(screen.getByLabelText("السعر 7 ₪")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "إضافة منظف عام Secret إلى المفضلة" }),
    ).toHaveAttribute("aria-pressed", "false");
    // The home strip about delivery is gone; delivery rules live in the cart and checkout.
    expect(screen.queryByText("توصيل داخل ميثلون")).toBeNull();
  });

  it("keeps a page heading without the homepage banners", () => {
    const { container } = renderStorefront();

    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(container.querySelector(".hero-facts")).toBeNull();
    expect(screen.queryByRole("region", { name: "أقسام من البيت" })).toBeNull();
  });

  it("shows today's category from the server, category cards that open their page, and one product list", () => {
    const { container } = renderWithProviders(
      <Storefront
        products={products}
        categories={categories}
        daily={{ code: "kitchen", productIds: ["arar-dish-liquid"] }}
      />,
      { products },
    );
    const banner = container.querySelector(".daily-category")!;
    expect(banner).toHaveAttribute("data-category-id", "kitchen");
    expect(within(banner as HTMLElement).getByText("قسم اليوم")).toBeVisible();
    expect(
      within(banner as HTMLElement).getByRole("link", {
        name: /^تسوّق القسم: منظفات المطبخ/,
      }),
    ).toHaveAttribute("href", "/categories/kitchen");
    expect(screen.getByRole("link", { name: "منظفات الغسيل" })).toHaveAttribute(
      "href",
      "/categories/laundry",
    );
    expect(screen.getByRole("heading", { name: "وصل حديثًا" })).toBeVisible();
    expect(screen.getByRole("link", { name: "عرض الكل" })).toHaveAttribute(
      "href",
      "/products",
    );
    // No second rail of the same products, and no offers section.
    expect(screen.queryByRole("heading", { name: "منتجات مختارة" })).toBeNull();
    expect(screen.queryByRole("link", { name: "العروض" })).toBeNull();
    expect(container.querySelectorAll("article[data-product-id]")).toHaveLength(
      products.length,
    );
  });

  it("falls back to a plain link to every category when no category is picked", () => {
    const { container } = renderStorefront();
    const banner = container.querySelector(".daily-category")!;
    expect(banner).toHaveAttribute("data-fallback", "true");
    expect(
      within(banner as HTMLElement).getByRole("link", { name: /كل الأقسام/ }),
    ).toHaveAttribute("href", "/categories");
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
    renderWithProviders(
      <Storefront
        products={products}
        categories={categories}
        initialCategory="kitchen"
      />,
      { products },
    );

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
    await user.click(within(card).getByRole("button", { name: "أضف للسلة" }));
    await user.click(
      within(card).getByRole("button", {
        name: "زيادة كمية منظف عام Secret",
      }),
    );
    // The header and the bottom bar both carry the cart count.
    expect(
      screen.getAllByRole("link", { name: /^السلة، عدد المنتجات\s*2$/ }),
    ).toHaveLength(2);

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
      within(card).getByRole("button", { name: "أضف للسلة" }),
    ).toBeVisible();
    expect(
      screen.getAllByRole("link", { name: /^السلة، عدد المنتجات\s*0$/ }),
    ).toHaveLength(2);
  });

  it("prevents quantity changes and cart additions for unavailable products", () => {
    renderStorefront();

    const card = screen.getByText("منظف غير متاح").closest("article");
    expect(card).not.toBeNull();
    expect(
      within(card!).queryByRole("button", { name: "أضف للسلة" }),
    ).toBeNull();
    expect(
      within(card!).queryByRole("button", {
        name: "زيادة كمية منظف غير متاح",
      }),
    ).toBeNull();
    expect(within(card!).getByText("غير متوفر حالياً")).toBeVisible();
  });
});

describe("storefront catalog batches", () => {
  const many: Product[] = Array.from({ length: 30 }, (_, index) =>
    withDefaultVariant({
      id: `batch-${index + 1}`,
      slug: `batch-${index + 1}`,
      nameAr: `منتج رقم ${index + 1}`,
      priceAgorot: 500,
      categoryId: index < 20 ? "home" : "kitchen",
      image: { kind: "placeholder", variant: "general-cleaner" },
      availability: "available",
      detailsStatus: "placeholder",
    }),
  );
  const cards = () => document.querySelectorAll("article[data-product-id]");

  it("shows 12, reveals 12 more on request, and starts again on a new search or category", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <Storefront products={many} categories={categories} />,
      { products: many },
    );
    expect(cards()).toHaveLength(12);
    expect(screen.getByText("يظهر 12 من 30")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "عرض المزيد (12)" }));
    expect(cards()).toHaveLength(24);
    await user.click(screen.getByRole("button", { name: "عرض المزيد (6)" }));
    expect(cards()).toHaveLength(30);
    expect(screen.queryByRole("button", { name: /عرض المزيد/ })).toBeNull();

    // Search starts again from the first batch and never hides a match behind the button.
    await user.type(screen.getByRole("searchbox"), "رقم 1");
    expect(cards().length).toBeLessThanOrEqual(12);
    expect(screen.queryByRole("button", { name: /عرض المزيد/ })).toBeNull();
  });
});
