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

describe("product database mapping", () => {
  it("maps a database row without leaking database fields", () => {
    expect(mapProductRow(row)).toEqual({
      id: "general-cleaner",
      slug: "general-cleaner-secret",
      nameAr: "منظف عام",
      latinName: "Secret",
      priceAgorot: 700,
      categoryId: "home",
      availability: "available",
      image: { kind: "placeholder", variant: "general-cleaner" },
      detailsStatus: "placeholder",
    });
  });

  it("rejects an inconsistent image representation", () => {
    expect(() => mapProductRow({ ...row, placeholderVariant: null })).toThrow();
  });
});
