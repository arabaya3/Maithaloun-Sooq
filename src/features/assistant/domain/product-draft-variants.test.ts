import { describe, expect, it } from "vitest";

import {
  assignDraftImage,
  emptyVariantDraft,
  patchDraftVariants,
  resolveImageSuggestions,
  setDraftOptions,
  variantDraftMissing,
  variantDraftToSet,
  variantKey,
  type VariantDraftData,
} from "./product-draft-variants";

const scents = {
  nameAr: "الرائحة",
  kind: "fragrance" as const,
  values: ["لافندر", "ورد أبيض", "مسك"],
};

function withImages(
  draft: VariantDraftData,
  suggestions: Array<[string, number] | null>,
): VariantDraftData {
  return {
    ...draft,
    images: suggestions.map((suggestion, index) => ({
      attachmentId: `00000000-0000-4000-8000-00000000000${index}`,
      primary: index === 0,
      assignment: null,
      suggestion: suggestion
        ? { value: suggestion[0], confidence: suggestion[1] }
        : null,
    })),
  };
}

describe("multi-variant draft", () => {
  it("builds one variant per value and keeps prices when options are re-entered", () => {
    let draft = setDraftOptions(emptyVariantDraft(), [scents]).draft;
    expect(draft.variants.map((variant) => variant.values["الرائحة"])).toEqual([
      "لافندر",
      "ورد أبيض",
      "مسك",
    ]);
    draft = patchDraftVariants(draft, [
      { match: [{ option: "الرائحة", value: "مسك" }], price: "12" },
    ]).draft;
    draft = setDraftOptions(draft, [
      scents,
      { nameAr: "الحجم", kind: "size", values: ["450 مل"] },
    ]).draft;
    expect(draft.variants).toHaveLength(3);
    expect(
      draft.variants.find((variant) => variant.values["الرائحة"] === "مسك")
        ?.price,
    ).toBeUndefined();
    const sizes = setDraftOptions(emptyVariantDraft(), [scents]).draft;
    const priced = patchDraftVariants(sizes, [
      { match: [{ option: "الرائحة", value: "مسك" }], price: "12" },
    ]).draft;
    expect(setDraftOptions(priced, [scents]).draft.variants[2]?.price).toBe(
      1_200,
    );
  });

  it("rejects duplicate options and values and caps the combinations", () => {
    expect(
      setDraftOptions(emptyVariantDraft(), [scents, scents]).error,
    ).toBeTruthy();
    expect(
      setDraftOptions(emptyVariantDraft(), [
        { ...scents, values: ["مسك", "مسك"] },
      ]).error,
    ).toBeTruthy();
    const many = Array.from({ length: 4 }, (_, index) => ({
      nameAr: `خيار ${index}`,
      kind: "other" as const,
      values: ["أ", "ب", "ج"],
    }));
    expect(setDraftOptions(emptyVariantDraft(), many).error).toMatch(/أكثر من/);
  });

  it("applies «كلهم عشرة» and «الأزرق 12 والزهري 10» without inventing variants", () => {
    const colours = setDraftOptions(emptyVariantDraft(), [
      { nameAr: "اللون", kind: "color", values: ["زهري", "أزرق", "أخضر"] },
    ]).draft;
    let result = patchDraftVariants(colours, [
      { match: [], price: "عشرة شيكل" },
    ]);
    expect(
      result.draft.variants.every((variant) => variant.price === 1_000),
    ).toBe(true);
    result = patchDraftVariants(result.draft, [
      { match: [{ option: "اللون", value: "الأزرق" }], price: "12" },
      { match: [{ option: "اللون", value: "زهري" }], price: "10" },
      { match: [{ option: "اللون", value: "بنفسجي" }], price: "9" },
    ]);
    expect(result.draft.variants.map((variant) => variant.price)).toEqual([
      1_000, 1_200, 1_000,
    ]);
    expect(result.errors).toEqual(["ما في صنف «بنفسجي» في المسودة."]);
  });

  it("records pack counts per sellable unit", () => {
    const draft = setDraftOptions(emptyVariantDraft(), [
      { nameAr: "العبوة", kind: "pack", values: ["3 قطع"] },
    ]).draft;
    const patched = patchDraftVariants(draft, [
      { match: [], packCount: 3, price: "15" },
    ]).draft;
    expect(variantDraftToSet(patched, undefined).variants[0]).toMatchObject({
      packCount: 3,
      priceAgorot: 1_500,
    });
  });

  it("maps confident photo readings and asks only about the uncertain one", () => {
    let draft = withImages(
      setDraftOptions(emptyVariantDraft(), [scents]).draft,
      [
        ["لافندر", 0.9],
        ["ورد أبيض", 0.92],
        ["مسك", 0.45],
      ],
    );
    draft = resolveImageSuggestions(draft);
    expect(draft.images.map((image) => image.assignment)).toEqual([
      variantKey({ الرائحة: "لافندر" }),
      variantKey({ الرائحة: "ورد أبيض" }),
      null,
    ]);
    expect(variantDraftMissing(draft, 1_000)).toEqual(["ربط الصورة 3"]);
    draft = assignDraftImage(draft, 2, { الرائحة: "مسك" }).draft;
    expect(variantDraftMissing(draft, 1_000)).toEqual([]);
    expect(
      variantDraftToSet(draft, 1_000).attachments.map(
        (row) => row.variantIndex,
      ),
    ).toEqual([0, 1, 2]);
  });

  it("never assigns a photo to a value that is not an option", () => {
    const draft = resolveImageSuggestions(
      withImages(setDraftOptions(emptyVariantDraft(), [scents]).draft, [
        ["ياسمين", 0.99],
        ["لافندر", 0.9],
      ]),
    );
    expect(draft.images[0]?.assignment).toBeNull();
    expect(assignDraftImage(draft, 0, { الرائحة: "ياسمين" }).error).toMatch(
      /ما في صنف/,
    );
    expect(assignDraftImage(draft, 5, "shared").error).toMatch(/لا توجد صورة/);
  });

  it("requires a price for every variant unless one price was given for all", () => {
    const draft = setDraftOptions(emptyVariantDraft(), [scents]).draft;
    expect(variantDraftMissing(draft, undefined)[0]).toMatch(/^سعر /);
    expect(variantDraftMissing(draft, 1_000)).toEqual([]);
  });
});
