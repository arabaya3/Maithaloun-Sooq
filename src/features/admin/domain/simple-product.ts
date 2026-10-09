/** The kinds of difference the simple product editor offers; anything else lives in the advanced section. */
export const simpleKinds = [
  "single",
  "fragrance",
  "size",
  "color",
  "other",
] as const;
export type SimpleKind = (typeof simpleKinds)[number];

export const simpleKindLabels: Record<
  Exclude<SimpleKind, "single">,
  { tab: string; one: string; add: string; example: string }
> = {
  fragrance: {
    tab: "روائح",
    one: "الرائحة",
    add: "إضافة رائحة",
    example: "مثل: لافندر",
  },
  size: { tab: "أحجام", one: "الحجم", add: "إضافة حجم", example: "مثل: 1 لتر" },
  color: { tab: "ألوان", one: "اللون", add: "إضافة لون", example: "مثل: أزرق" },
  other: {
    tab: "غير ذلك",
    one: "النوع",
    add: "إضافة نوع",
    example: "مثل: عبوة كبيرة",
  },
};

interface MatrixLike {
  options: Array<{
    id: string;
    nameAr: string;
    kind: string;
    archived: boolean;
    values: Array<{ id: string; valueAr: string }>;
  }>;
  variants: Array<{
    id: string;
    priceAgorot: number;
    availability: "available" | "unavailable";
    isDefault: boolean;
    archived: boolean;
    optionValues: Record<string, string>;
    onHandMilli: number;
  }>;
  images: Array<{
    id: string;
    src: string;
    alt: string;
    scope: string;
    variantId: string | null;
    optionValueId: string | null;
    archived: boolean;
  }>;
}

export interface SimpleEditorRow {
  key: string;
  variantId: string | null;
  valueId: string | null;
  label: string;
  priceIls: string;
  available: boolean;
  onHand: number | null;
  images: Array<{ id: string; src: string; alt: string }>;
}

const ils = (agorot: number) =>
  agorot % 100 === 0 ? String(agorot / 100) : (agorot / 100).toFixed(2);

/**
 * What the simple editor shows for a saved product. Products with more than one live option, or
 * several variants without an option, are "locked": their types are edited in the advanced section.
 */
export function simpleEditorState(
  matrix: MatrixLike,
  trackedVariantIds: ReadonlySet<string>,
): {
  kind: SimpleKind;
  optionName: string;
  rows: SimpleEditorRow[];
  generalImages: Array<{ id: string; src: string; alt: string }>;
  locked: boolean;
} {
  const options = matrix.options.filter((option) => !option.archived);
  const variants = matrix.variants.filter((variant) => !variant.archived);
  const images = matrix.images.filter((image) => !image.archived);
  const picture = (image: MatrixLike["images"][number]) => ({
    id: image.id,
    src: image.src,
    alt: image.alt,
  });
  const onHand = (variant: MatrixLike["variants"][number]) =>
    trackedVariantIds.has(variant.id)
      ? Math.floor(variant.onHandMilli / 1000)
      : null;
  const locked =
    options.length > 1 || (options.length === 0 && variants.length > 1);
  const option = options.length === 1 ? options[0]! : null;

  if (!option) {
    const variant =
      variants.find((item) => item.isDefault) ?? variants[0] ?? null;
    return {
      kind: "single",
      optionName: "",
      locked,
      rows: variant
        ? [
            {
              key: variant.id,
              variantId: variant.id,
              valueId: null,
              label: "",
              priceIls: ils(variant.priceAgorot),
              available: variant.availability === "available",
              onHand: onHand(variant),
              images: images
                .filter((image) => image.scope !== "option_value")
                .map(picture),
            },
          ]
        : [],
      generalImages: [],
    };
  }

  const kind: SimpleKind = (["fragrance", "size", "color"] as const).includes(
    option.kind as never,
  )
    ? (option.kind as SimpleKind)
    : "other";
  const rows: SimpleEditorRow[] = [];
  for (const value of option.values) {
    const variant = variants.find(
      (item) => item.optionValues[option.id] === value.id,
    );
    if (!variant) continue;
    rows.push({
      key: variant.id,
      variantId: variant.id,
      valueId: value.id,
      label: value.valueAr,
      priceIls: ils(variant.priceAgorot),
      available: variant.availability === "available",
      onHand: onHand(variant),
      images: images
        .filter(
          (image) =>
            (image.scope === "option_value" &&
              image.optionValueId === value.id) ||
            (image.scope === "variant" && image.variantId === variant.id),
        )
        .map(picture),
    });
  }
  return {
    kind,
    optionName: kind === "other" ? option.nameAr : "",
    locked: locked || rows.length !== variants.length,
    rows,
    generalImages: images
      .filter(
        (image) => image.scope === "product" || image.scope === "unassigned",
      )
      .map(picture),
  };
}
