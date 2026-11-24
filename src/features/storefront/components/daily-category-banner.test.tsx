import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { ProductCategory } from "@/features/catalog/domain/category";
import { withDefaultVariant } from "@/test/mock-product-repository";
import { renderWithProviders } from "@/test/render-with-providers";

import { DailyCategoryBanner } from "./daily-category-banner";

const category = {
  code: "laundry",
  nameAr: "الغسيل",
  nameEn: "Laundry",
  icon: "shirt",
  sortOrder: 30,
} as unknown as ProductCategory;

function renderBanner(count: number) {
  const products = Array.from({ length: count }, (_, index) =>
    withDefaultVariant({
      id: `laundry-${index}`,
      slug: `laundry-item-${index}`,
      nameAr: `منتج غسيل ${index + 1}`,
      priceAgorot: 900,
      categoryId: "laundry",
      image: { kind: "placeholder", variant: "general-cleaner" },
      availability: "available",
      detailsStatus: "placeholder",
    }),
  );
  renderWithProviders(
    <DailyCategoryBanner
      category={category}
      products={products}
      productCount={14}
    />,
    { products },
  );
  return products;
}

describe("DailyCategoryBanner", () => {
  it("shows the category, its product count and a link to shop it", () => {
    renderBanner(3);
    expect(
      screen.getByRole("heading", { level: 2, name: "الغسيل" }),
    ).toBeVisible();
    expect(screen.getByText("14 منتجًا في هذا القسم")).toBeVisible();
    expect(screen.getByRole("link", { name: /تسوّق الغسيل/ })).toHaveAttribute(
      "href",
      expect.stringContaining("/categories/laundry"),
    );
  });

  it("switches the showcased product when a dot is chosen", async () => {
    const user = userEvent.setup();
    const products = renderBanner(3);
    const dots = screen.getAllByRole("button", { name: /^عرض المنتج/ });
    expect(dots).toHaveLength(3);
    expect(dots[0]).toHaveAttribute("aria-current", "true");

    await user.click(dots[2]!);

    expect(dots[2]).toHaveAttribute("aria-current", "true");
    expect(
      screen.getByRole("link", { name: new RegExp(products[2]!.nameAr) }),
    ).toHaveAttribute("href", expect.stringContaining(products[2]!.slug));
  });

  it("has no dots for a single product", () => {
    renderBanner(1);
    expect(screen.queryByRole("button", { name: /^عرض المنتج/ })).toBeNull();
  });
});
