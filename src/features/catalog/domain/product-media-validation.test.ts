import { describe, expect, it } from "vitest";

import {
  mappingMessages,
  mappingProblems,
  structureProblems,
  type MappingInput,
} from "./product-media-validation";

const base = (): MappingInput => ({
  options: [
    {
      id: "color",
      nameAr: "اللون",
      kind: "color",
      archived: false,
      values: [
        { id: "blue", valueAr: "الأزرق", usesSharedImage: false },
        { id: "pink", valueAr: "الزهري", usesSharedImage: false },
      ],
    },
    {
      id: "size",
      nameAr: "الحجم",
      kind: "size",
      archived: false,
      values: [
        { id: "small", valueAr: "صغير", usesSharedImage: false },
        { id: "large", valueAr: "كبير", usesSharedImage: false },
      ],
    },
  ],
  variants: [
    {
      id: "bs",
      archived: false,
      optionValues: { color: "blue", size: "small" },
    },
    {
      id: "bl",
      archived: false,
      optionValues: { color: "blue", size: "large" },
    },
    {
      id: "ps",
      archived: false,
      optionValues: { color: "pink", size: "small" },
    },
    {
      id: "pl",
      archived: false,
      optionValues: { color: "pink", size: "large" },
    },
  ],
  images: [],
});

const img = (
  id: string,
  scope: MappingInput["images"][number]["scope"],
  extra: Partial<MappingInput["images"][number]> = {},
) => ({
  id,
  archived: false,
  scope,
  variantId: null,
  optionId: null,
  optionValueId: null,
  ...extra,
});

describe("mappingProblems", () => {
  it("asks for a picture of every colour, in Arabic, but not of every size", () => {
    const problems = mappingProblems({
      ...base(),
      images: [img("main", "product")],
    });
    expect(problems.map((problem) => problem.message)).toEqual([
      "اللون «الأزرق» لا يملك صورة. أضف صورة أو اختر استخدام الصورة العامة.",
      "اللون «الزهري» لا يملك صورة. أضف صورة أو اختر استخدام الصورة العامة.",
    ]);
  });

  it("is satisfied by value images, exact-variant images or an explicit shared choice", () => {
    const input = base();
    input.options[0]!.values[1]!.usesSharedImage = true;
    expect(
      mappingProblems({
        ...input,
        images: [img("blue", "variant", { variantId: "bl" })],
      }),
    ).toEqual([]);
    expect(
      mappingProblems({
        ...base(),
        images: [
          img("b", "option_value", {
            optionId: "color",
            optionValueId: "blue",
          }),
          img("p", "option_value", {
            optionId: "color",
            optionValueId: "pink",
          }),
        ],
      }),
    ).toEqual([]);
  });

  it("flags an unclassified image", () => {
    const problems = mappingProblems({
      ...base(),
      images: [
        img("loose", "unassigned"),
        img("b", "option_value", { optionId: "color", optionValueId: "blue" }),
        img("p", "option_value", { optionId: "color", optionValueId: "pink" }),
      ],
    });
    expect(problems).toEqual([
      {
        code: "unassigned_image",
        imageId: "loose",
        message: "حدّد لأي لون أو رائحة تتبع هذه الصورة.",
      },
    ]);
  });

  it("flags images of archived variants and values as stale", () => {
    const input = base();
    input.variants[1]!.archived = true;
    input.options[0]!.values = input.options[0]!.values.filter(
      (value) => value.id !== "pink",
    );
    const problems = mappingProblems({
      ...input,
      images: [
        img("old-variant", "variant", { variantId: "bl" }),
        img("old-value", "option_value", {
          optionId: "color",
          optionValueId: "pink",
        }),
        img("blue", "option_value", {
          optionId: "color",
          optionValueId: "blue",
        }),
      ],
    });
    expect(
      problems.filter((problem) => problem.code === "stale_mapping"),
    ).toHaveLength(2);
    expect(problems[0]!.message).toBe("هذه الصورة مرتبطة بصنف لم يعد موجوداً.");
  });

  it("does not count a value that no live variant uses, nor archived images", () => {
    const input = base();
    input.variants = input.variants.filter(
      (variant) => variant.optionValues.color === "blue",
    );
    const problems = mappingProblems({
      ...input,
      images: [
        img("blue", "option_value", {
          optionId: "color",
          optionValueId: "blue",
        }),
        { ...img("archived-loose", "unassigned"), archived: true },
      ],
    });
    expect(problems).toEqual([]);
  });

  it("never asks a single-variant product for per-value images", () => {
    const input = base();
    input.variants = [input.variants[0]!];
    expect(mappingProblems({ ...input, images: [] })).toEqual([]);
  });

  it("does not require pictures for sizes or packs", () => {
    const input = base();
    input.options = [input.options[1]!];
    expect(mappingProblems(input)).toEqual([]);
  });

  it("has the publish-blocking headline", () => {
    expect(mappingMessages.blocked).toBe(
      "لا يمكن نشر المنتج قبل إكمال ربط الصور بالأصناف.",
    );
  });
});

describe("structureProblems", () => {
  const colour = {
    id: "c",
    nameAr: "اللون",
    kind: "color" as const,
    archived: false,
    values: [
      { id: "blue", valueAr: "أزرق", usesSharedImage: false },
      { id: "pink", valueAr: "زهري", usesSharedImage: false },
    ],
  };
  const variant = (
    id: string,
    optionValues: Record<string, string>,
    extra: {
      isDefault?: boolean;
      available?: boolean;
      archived?: boolean;
    } = {},
  ) => ({
    id,
    labelAr: id,
    archived: extra.archived ?? false,
    isDefault: extra.isDefault ?? false,
    available: extra.available ?? true,
    optionValues,
  });
  const base = {
    options: [colour],
    variants: [
      variant("أزرق", { c: "blue" }, { isDefault: true }),
      variant("زهري", { c: "pink" }),
    ],
    images: [],
  };
  const codes = (input: Parameters<typeof structureProblems>[0]) =>
    structureProblems(input).map((problem) => problem.code);

  it("accepts a complete product and a simple one", () => {
    expect(codes(base)).toEqual([]);
    expect(
      codes({
        options: [],
        variants: [variant("الأساسي", {}, { isDefault: true })],
        images: [],
      }),
    ).toEqual([]);
  });

  it("finds missing and unavailable defaults", () => {
    expect(
      codes({
        ...base,
        variants: base.variants.map((row) => ({ ...row, isDefault: false })),
      }),
    ).toEqual(["no_default_variant"]);
    expect(
      codes({
        ...base,
        variants: [
          variant("أزرق", { c: "blue" }, { isDefault: true, available: false }),
          variant("زهري", { c: "pink" }),
        ],
      }),
    ).toEqual(["default_unavailable"]);
    expect(
      codes({
        ...base,
        variants: [
          variant("أزرق", { c: "blue" }, { isDefault: true, available: false }),
          variant("زهري", { c: "pink" }, { available: false }),
        ],
      }),
    ).toEqual([]);
  });

  it("finds incomplete, archived-value and duplicate variants, ignoring archived variants", () => {
    expect(
      codes({ ...base, variants: [variant("أزرق", {}, { isDefault: true })] }),
    ).toEqual(["incomplete_variant"]);
    expect(
      codes({
        ...base,
        variants: [variant("أزرق", { c: "gone" }, { isDefault: true })],
      }),
    ).toEqual(["archived_value"]);
    expect(
      codes({
        ...base,
        variants: [
          variant("أزرق", { c: "blue" }, { isDefault: true }),
          variant("أزرق 2", { c: "blue" }),
          variant("قديم", { c: "blue" }, { archived: true }),
        ],
      }),
    ).toEqual(["duplicate_combination"]);
  });

  it("requires the primary picture to be shared", () => {
    const image = (scope: "product" | "option_value", isPrimary: boolean) => ({
      id: scope,
      archived: false,
      scope,
      variantId: null,
      optionId: scope === "option_value" ? "c" : null,
      optionValueId: scope === "option_value" ? "blue" : null,
      isPrimary,
    });
    expect(codes({ ...base, images: [image("product", true)] })).toEqual([]);
    expect(codes({ ...base, images: [image("option_value", true)] })).toEqual([
      "primary_not_shared",
    ]);
  });
});
