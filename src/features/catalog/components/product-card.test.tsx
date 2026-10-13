import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { withDefaultVariant } from "@/test/mock-product-repository";
import { renderWithProviders } from "@/test/render-with-providers";

import { ProductCard } from "./product-card";

const base = {
  id: "general-cleaner",
  slug: "general-cleaner-secret",
  nameAr: "منظف عام",
  latinName: "Secret",
  priceAgorot: 700,
  categoryId: "home",
  image: { kind: "placeholder", variant: "general-cleaner" },
  availability: "available",
  detailsStatus: "placeholder",
} as const;

describe("ProductCard", () => {
  it("shows the owner's English name and English actions under /en", async () => {
    const product = withDefaultVariant({
      ...base,
      nameEn: "Secret All-Purpose Cleaner",
    });
    const user = userEvent.setup();
    renderWithProviders(<ProductCard product={product} />, {
      products: [product],
      locale: "en",
    });

    expect(
      screen.getByRole("link", { name: "Secret All-Purpose Cleaner" }),
    ).toHaveAttribute("href", "/en/products/general-cleaner-secret");
    expect(screen.getByLabelText("Price 7 ₪")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Add Secret All-Purpose Cleaner to wishlist",
      }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add to cart" }));
    expect(
      screen.getByRole("button", {
        name: "Increase Secret All-Purpose Cleaner quantity",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Remove Secret All-Purpose Cleaner from cart",
      }),
    ).toBeInTheDocument();
  });

  it("falls back to the original name in English when none was written", () => {
    const product = withDefaultVariant(base);
    renderWithProviders(<ProductCard product={product} />, {
      products: [product],
      locale: "en",
    });

    expect(
      screen.getByRole("link", { name: "منظف عام Secret" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add to cart" }),
    ).toBeInTheDocument();
  });

  it("stays Arabic by default and ignores the English name", () => {
    const product = withDefaultVariant({ ...base, nameEn: "Secret Cleaner" });
    renderWithProviders(<ProductCard product={product} />, {
      products: [product],
    });

    expect(
      screen.getByRole("link", { name: "منظف عام Secret" }),
    ).toHaveAttribute("href", "/products/general-cleaner-secret");
    expect(
      screen.getByRole("button", { name: "أضف إلى السلة" }),
    ).toBeInTheDocument();
  });
});
