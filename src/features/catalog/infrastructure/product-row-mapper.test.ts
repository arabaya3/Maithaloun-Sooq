import { describe, expect, it } from "vitest";

import { products } from "@/server/db/schema";

import { mapProductRow } from "./product-row-mapper";

const row: typeof products.$inferSelect = {
  id: "4077df44-66f8-458d-a5e2-b5d98fa2ec72",
  domainId: "general-cleaner",
  slug: "general-cleaner-secret",
  nameAr: "منظف عام",
  latinName: "Secret",
  priceAgorot: 700,
  sortOrder: 1,
  categoryId: "home",
  availability: "available",
  imageKind: "placeholder",
  imageSrc: null,
  imageAlt: null,
  imageWidth: null,
  imageHeight: null,
  placeholderVariant: "general-cleaner",
  description: null,
  usageNotes: null,
  unit: null,
  detailsStatus: "placeholder",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

const defaultVariant = {
  id: "5177df44-66f8-458d-a5e2-b5d98fa2ec72",
  productId: row.id,
  domainId: "general-cleaner--default",
  labelAr: "الافتراضي",
  attributes: {},
  priceAgorot: 700,
  availability: "available" as const,
  imageKind: "placeholder" as const,
  imageSrc: null,
  imageAlt: null,
  imageWidth: null,
  imageHeight: null,
  placeholderVariant: "general-cleaner" as const,
  sku: null,
  barcode: null,
  sortOrder: 0,
  isDefault: true,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

describe("product database mapping", () => {
  it("maps a database row without leaking database fields", () => {
    expect(mapProductRow(row, [defaultVariant])).toEqual({
      id: "general-cleaner",
      slug: "general-cleaner-secret",
      nameAr: "منظف عام",
      latinName: "Secret",
      priceAgorot: 700,
      categoryId: "home",
      availability: "available",
      image: { kind: "placeholder", variant: "general-cleaner" },
      detailsStatus: "placeholder",
      defaultVariantId: "general-cleaner--default",
      variants: [
        {
          id: "general-cleaner--default",
          productId: "general-cleaner",
          labelAr: "الافتراضي",
          attributes: {},
          priceAgorot: 700,
          availability: "available",
          image: { kind: "placeholder", variant: "general-cleaner" },
          sortOrder: 0,
          isDefault: true,
        },
      ],
      specifications: [],
    });
  });

  it("rejects an inconsistent image representation", () => {
    expect(() =>
      mapProductRow(row, [{ ...defaultVariant, placeholderVariant: null }]),
    ).toThrow();
  });

  it("rejects products without variants", () => {
    expect(() => mapProductRow(row, [])).toThrow(
      /Product general-cleaner has no variants/,
    );
  });
});
