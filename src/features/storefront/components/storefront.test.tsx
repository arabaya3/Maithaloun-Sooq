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
      screen.getByRole("link", { name: "MAYTHA، الرئيسية" }),
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

  it("leads with the editorial hero and only true trust facts", () => {
    const { container } = renderStorefront();

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "ماركات أصلية لبيت أنظف وحياة أجمل",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("ماركات بتعرفها وبتثق فيها.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "تسوّق الآن" })).toHaveAttribute(
      "href",
      "#catalog",
    );
    const facts = container.querySelector(".hero-facts");
    expect(facts).toHaveTextContent("توصيل داخل ميثلون");
    expect(facts).toHaveTextContent("الدفع عند الاستلام");
    // Nothing the store cannot back: no ratings, discounts or easy returns.
    expect(container.textContent).not.toMatch(
      /تقييم|خصم حتى|إرجاع سهل|دفع آمن/,
    );
    // Without real photos there is no hero image at all.
    expect(container.querySelector(".hero-media")).toBeNull();
  });

  it("hides the brands row and best sellers until there is enough real data", () => {
    const { container } = renderWithProviders(
      <Storefront
        products={products}
        categories={categories}
        merchandising={{
          heroProducts: [],
          brands: [
            { name: "Finish", productCount: 2 },
            { name: "Arar", productCount: 1 },
          ],
          bestSellers: products.slice(0, 2),
          offerProducts: [],
          featured: null,
        }}
      />,
      { products },
    );
    expect(screen.queryByRole("heading", { name: "ماركات مختارة" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "الأكثر طلباً" })).toBeNull();
    expect(container.querySelector(".promo-grid")).toBeNull();
  });

  it("shows owner-entered brands, best sellers and live offers when present", () => {
    renderWithProviders(
      <Storefront
        products={products}
        categories={categories}
        merchandising={{
          heroProducts: [],
          brands: [
            { name: "Finish", productCount: 3 },
            { name: "Arar", productCount: 2 },
            { name: "البركان", productCount: 1 },
          ],
          bestSellers: [...products, products[0]!].map((product, index) => ({
            ...product,
            id: `${product.id}-${index}`,
          })),
          offerProducts: [products[0]!],
          featured: null,
        }}
      />,
      { products },
    );
    const brands = screen
      .getByRole("heading", { name: "ماركات مختارة" })
      .closest("section")!;
    expect(
      within(brands).getByRole("link", { name: "Finish" }),
    ).toHaveAttribute("href", "/brands/Finish");
    expect(
      within(brands).getByRole("link", { name: "البركان" }),
    ).toHaveAttribute("href", `/brands/${encodeURIComponent("البركان")}`);
    expect(
      screen.getByRole("heading", { name: "الأكثر طلباً" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /تسوّق العروض/ })).toHaveAttribute(
      "href",
      "/offers",
    );
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

    // A new category starts from the first batch and counts only its own products.
    const homeButton = document.querySelector(
      '[data-category-id="home"]',
    ) as HTMLElement;
    await user.click(homeButton);
    expect(cards()).toHaveLength(12);
    expect(screen.getByText("يظهر 12 من 20")).toBeInTheDocument();

    // Search narrows inside the category and never hides a match behind the button.
    await user.type(screen.getByRole("searchbox"), "رقم 1");
    expect(cards().length).toBeLessThanOrEqual(12);
    expect(screen.queryByRole("button", { name: /عرض المزيد/ })).toBeNull();
  });
});
