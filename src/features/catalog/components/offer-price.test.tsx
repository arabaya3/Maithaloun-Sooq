import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { VariantOffer } from "@/features/catalog/domain/offer-pricing";

import { OfferPrice } from "./offer-price";

const offer = (overrides: Partial<VariantOffer> = {}): VariantOffer => ({
  offerId: "o1",
  nameAr: "عرض الأسبوع",
  displayText: null,
  kind: "percentage",
  value: 20,
  minQuantity: 1,
  endsAt: null,
  ...overrides,
});

describe("OfferPrice", () => {
  it("shows the plain price when there is no offer", () => {
    const { container } = render(
      <OfferPrice className="product-price" variant={{ priceAgorot: 1_000 }} />,
    );
    expect(screen.getByLabelText("السعر 10 ₪")).toBeInTheDocument();
    expect(container.querySelector("del")).toBeNull();
  });

  it("crosses out the list price only when the offer applies to one item", () => {
    const { container } = render(
      <OfferPrice
        className="product-price"
        variant={{ priceAgorot: 1_000, offer: offer() }}
      />,
    );
    expect(
      screen.getByLabelText("السعر 8 ₪ بدلاً من 10 ₪"),
    ).toBeInTheDocument();
    expect(container.querySelector("del")).toHaveTextContent("10 ₪");
    expect(screen.getByText("خصم 20٪")).toBeInTheDocument();
  });

  it("keeps the list price and explains a minimum-quantity offer", () => {
    const { container } = render(
      <OfferPrice
        className="product-price"
        variant={{ priceAgorot: 1_000, offer: offer({ minQuantity: 3 }) }}
      />,
    );
    expect(screen.getByLabelText("السعر 10 ₪")).toBeInTheDocument();
    expect(container.querySelector("del")).toBeNull();
    expect(screen.getByText("خصم 20٪ عند شراء 3 أو أكثر")).toBeInTheDocument();
  });
});
