import { describe, expect, it } from "vitest";

import { products } from "@/server/db/schema";

import { mapProductRow, type SellingUnitRow } from "./product-row-mapper";

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
  archivedAt: null,
  mergedIntoProductId: null,
  publication: "published" as const,
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
  qaOwned: false,
  archivedAt: null,
  packCount: null,
  combinationKey: null,
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
      publication: "published",
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
          sellingUnits: [],
        },
      ],
      specifications: [],
    });
  });

  it("maps active selling units with availability from free base stock", () => {
    const unit = (
      id: string,
      labelAr: string,
      unitsPerSale: number,
      priceAgorot: number,
      extra: Partial<SellingUnitRow> = {},
    ): SellingUnitRow => ({
      id,
      productId: row.id,
      variantId: defaultVariant.id,
      labelAr,
      unitsPerSale,
      priceAgorot,
      isDefault: unitsPerSale === 1,
      mirrorsVariant: unitsPerSale === 1,
      sku: null,
      barcode: null,
      sortOrder: unitsPerSale,
      archivedAt: null,
      version: 1,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      ...extra,
    });
    const units = [
      unit("aaaaaaaa-aaaa-4aaa-8aaa-000000000003", "باكيج 3 حبات", 3, 1000),
      unit("aaaaaaaa-aaaa-4aaa-8aaa-000000000001", "حبة واحدة", 1, 400),
      unit("aaaaaaaa-aaaa-4aaa-8aaa-000000000006", "كرتونة", 6, 1800, {
        archivedAt: new Date("2026-02-01T00:00:00.000Z"),
      }),
    ];
    const withStock = (freeBaseMilli: number | null) =>
      mapProductRow(
        row,
        [defaultVariant],
        [],
        new Map(),
        new Map([[defaultVariant.id, { units, freeBaseMilli }]]),
      ).variants[0]!.sellingUnits.map((entry) => [
        entry.labelAr,
        entry.maxQuantity,
      ]);

    expect(withStock(10_000)).toEqual([
      ["حبة واحدة", 9],
      ["باكيج 3 حبات", 3],
    ]);
    expect(withStock(2_000)).toEqual([
      ["حبة واحدة", 2],
      ["باكيج 3 حبات", 0],
    ]);
    // Untracked stock leaves only the cart limit.
    expect(withStock(null)).toEqual([
      ["حبة واحدة", 9],
      ["باكيج 3 حبات", 9],
    ]);
  });

  it("rejects an inconsistent image representation", () => {
    expect(() =>
      mapProductRow(row, [{ ...defaultVariant, placeholderVariant: null }]),
    ).toThrow();
  });

  it("leaves archived variants out of the catalog", () => {
    const archived = {
      ...defaultVariant,
      id: "variant-2",
      domainId: "general-cleaner--large",
      labelAr: "كبير",
      isDefault: false,
      sortOrder: 1,
      archivedAt: new Date("2026-02-01T00:00:00.000Z"),
    };
    expect(
      mapProductRow(row, [defaultVariant, archived]).variants.map(
        (variant) => variant.id,
      ),
    ).toEqual(["general-cleaner--default"]);
  });

  it("rejects products without variants", () => {
    expect(() => mapProductRow(row, [])).toThrow(
      /Product general-cleaner has no variants/,
    );
  });
});
