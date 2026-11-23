import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import {
  seedCategories,
  type Product,
} from "@/features/catalog/domain/product";
import { productsInCategory } from "@/features/catalog/domain/product-categories";
import { withDefaultVariant } from "@/test/mock-product-repository";
import { renderWithProviders } from "@/test/render-with-providers";

import { ProductListing } from "./product-listing";

const item = (
  index: number,
  categoryId: string,
  extra: string[] = [],
): Product => ({
  ...withDefaultVariant({
    id: `p${String(index).padStart(2, "0")}`,
    slug: `p${index}`,
    nameAr: `منتج ${index}`,
    priceAgorot: 500 + index,
    categoryId,
    image: { kind: "placeholder", variant: "general-cleaner" },
    availability: "available",
    detailsStatus: "placeholder",
  }),
  categoryIds: [categoryId, ...extra],
  // One day apart: p29 is the newest.
  createdAt: new Date(Date.UTC(2026, 9, 1 + index)).toISOString(),
});

const categories = seedCategories.map((category, sortOrder) => ({
  ...category,
  description: null,
  sortOrder,
  visible: true,
}));

// 30 products; p05 belongs to the kitchen and is also listed in home.
const products = Array.from({ length: 30 }, (_, index) =>
  index === 5
    ? item(index, "kitchen", ["home"])
    : item(index, index < 20 ? "home" : "kitchen"),
);
const cards = () =>
  Array.from(document.querySelectorAll("article[data-product-id]")).map(
    (node) => node.getAttribute("data-product-id"),
  );

describe("ProductListing", () => {
  beforeEach(() => window.history.replaceState(null, "", "/products"));

  it("shows the newest first, sorted before the first page, each product once", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ProductListing
        products={products}
        categories={categories}
        heading={<h1>كل المنتجات</h1>}
      />,
      { products },
    );
    expect(cards()).toHaveLength(12);
    expect(cards()[0]).toBe("p29");
    expect(screen.getByText("يظهر 12 من 30")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "عرض المزيد (12)" }));
    await user.click(screen.getByRole("button", { name: "عرض المزيد (6)" }));
    expect(cards()).toHaveLength(30);
    expect(new Set(cards()).size).toBe(30);
    expect(new URL(window.location.href).searchParams.get("shown")).toBe("36");
  });

  it("lists a product with an extra category in both categories", () => {
    const home = productsInCategory(products, "home").map((p) => p.id);
    const kitchen = productsInCategory(products, "kitchen").map((p) => p.id);
    expect(home).toContain("p05");
    expect(kitchen).toContain("p05");
    expect(home).toHaveLength(20);
    expect(kitchen).toHaveLength(11);
  });

  it("restores sort and the number shown from the address", async () => {
    window.history.replaceState(null, "", "/products?sort=price-asc&shown=24");
    renderWithProviders(
      <ProductListing products={products} heading={<h1>كل المنتجات</h1>} />,
      { products },
    );
    await screen.findByText("يظهر 24 من 30");
    expect(cards()[0]).toBe("p00");
  });

  it("marks only products created since the cut-off as new", () => {
    renderWithProviders(
      <ProductListing
        products={products.slice(28)}
        heading={<h1>كل المنتجات</h1>}
        newSince={new Date(Date.UTC(2026, 9, 30)).toISOString()}
      />,
      { products },
    );
    expect(screen.getAllByText("جديد")).toHaveLength(1);
  });
});
