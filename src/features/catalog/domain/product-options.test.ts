import { describe, expect, it } from "vitest";

import {
  galleryForVariant,
  isPermutation,
  orderGallery,
  type GalleryImage,
} from "./product-gallery";
import {
  cartesian,
  combinationKey,
  duplicateCombinations,
  incompleteVariants,
  missingCombinations,
  nextSelection,
  packLabel,
  selectionAttributes,
  selectionLabel,
  valueStates,
  variantForSelection,
  type ProductOption,
} from "./product-options";

const options: ProductOption[] = [
  {
    id: "o-size",
    nameAr: "الحجم",
    kind: "size",
    sortOrder: 1,
    values: [
      { id: "450", valueAr: "450 مل", sortOrder: 0 },
      { id: "750", valueAr: "750 مل", sortOrder: 1 },
    ],
  },
  {
    id: "o-scent",
    nameAr: "الرائحة",
    kind: "fragrance",
    sortOrder: 0,
    values: [
      { id: "lav", valueAr: "لافندر", sortOrder: 0 },
      { id: "rose", valueAr: "ورد أبيض", sortOrder: 1 },
      { id: "musk", valueAr: "مسك", sortOrder: 2 },
    ],
  },
];

const variants = [
  {
    id: "v1",
    optionValues: { "o-scent": "lav", "o-size": "450" },
    available: true,
  },
  {
    id: "v2",
    optionValues: { "o-scent": "rose", "o-size": "450" },
    available: true,
  },
  {
    id: "v3",
    optionValues: { "o-scent": "musk", "o-size": "450" },
    available: false,
  },
  {
    id: "v4",
    optionValues: { "o-scent": "lav", "o-size": "750" },
    available: true,
  },
];

describe("combinations", () => {
  it("canonicalizes regardless of entry order", () => {
    expect(combinationKey({ b: "2", a: "1" })).toBe(
      combinationKey({ a: "1", b: "2" }),
    );
    expect(combinationKey({})).toBeNull();
  });

  it("finds duplicates, incomplete variants and missing combinations", () => {
    expect(
      duplicateCombinations([
        ...variants,
        {
          id: "v5",
          optionValues: { "o-size": "450", "o-scent": "lav" },
          available: true,
        },
      ]),
    ).toEqual([["v1", "v5"]]);
    expect(
      incompleteVariants(options, [
        ...variants,
        { id: "v6", optionValues: { "o-scent": "lav" }, available: true },
      ]),
    ).toEqual(["v6"]);
    const missing = missingCombinations(options, variants)!;
    expect(
      missing.map((row) => `${row["o-scent"]}/${row["o-size"]}`).sort(),
    ).toEqual(["musk/750", "rose/750"]);
  });

  it("bounds generated combinations", () => {
    const many = Array.from({ length: 4 }, (_, index) => ({
      id: `o${index}`,
      valueIds: Array.from({ length: 4 }, (__, value) => `v${value}`),
    }));
    expect(cartesian(many, 60)).toBeNull();
    expect(cartesian(many.slice(0, 2), 60)).toHaveLength(16);
  });

  it("labels and snapshots a selection in option order", () => {
    const selection = { "o-size": "450", "o-scent": "rose" };
    expect(selectionLabel(options, selection)).toBe("ورد أبيض · 450 مل");
    expect(selectionAttributes(options, selection)).toEqual({
      الرائحة: "ورد أبيض",
      الحجم: "450 مل",
    });
  });
});

describe("storefront selection", () => {
  it("marks impossible and unavailable values for the current choice", () => {
    const states = valueStates(options, variants, { "o-size": "750" });
    expect(states["o-scent"]).toEqual({
      lav: "selectable",
      rose: "impossible",
      musk: "impossible",
    });
    expect(
      valueStates(options, variants, { "o-size": "450" })["o-scent"]!.musk,
    ).toBe("unavailable");
  });

  it("resolves only complete selections", () => {
    expect(
      variantForSelection(options, variants, { "o-scent": "lav" }),
    ).toBeNull();
    expect(
      variantForSelection(options, variants, {
        "o-scent": "lav",
        "o-size": "750",
      })?.id,
    ).toBe("v4");
  });

  it("moves to the closest valid combination when a choice has no match", () => {
    expect(
      nextSelection(
        options,
        variants,
        { "o-scent": "lav", "o-size": "750" },
        "o-scent",
        "rose",
      ),
    ).toEqual({
      "o-scent": "rose",
      "o-size": "450",
    });
  });

  it("describes packs without changing stock units", () => {
    expect(packLabel(3)).toBe("العبوة فيها 3 قطع");
    expect(packLabel(1)).toBeNull();
    expect(packLabel(null)).toBeNull();
  });
});

describe("gallery", () => {
  const image = (
    id: string,
    sortOrder: number,
    isPrimary = false,
    variantId: string | null = null,
  ): GalleryImage => ({
    id,
    src: `/${id}.webp`,
    alt: id,
    width: 100,
    height: 100,
    sortOrder,
    isPrimary,
    variantId,
  });

  it("puts the primary image first, then the saved order", () => {
    expect(
      orderGallery([image("b", 0), image("a", 1, true), image("c", 2)]).map(
        (row) => row.id,
      ),
    ).toEqual(["a", "b", "c"]);
  });

  it("shows a variant's own images before shared ones and hides other variants' images", () => {
    const images = [
      image("main", 0, true),
      image("lav", 1, false, "v1"),
      image("rose", 2, false, "v2"),
    ];
    expect(galleryForVariant(images, "v1").map((row) => row.id)).toEqual([
      "lav",
      "main",
    ]);
    expect(galleryForVariant(images, null).map((row) => row.id)).toEqual([
      "main",
    ]);
  });

  it("accepts only a complete reorder of the same images", () => {
    expect(isPermutation(["a", "b"], ["b", "a"])).toBe(true);
    expect(isPermutation(["a", "b"], ["a", "a"])).toBe(false);
    expect(isPermutation(["a", "b"], ["a", "c"])).toBe(false);
  });
});
