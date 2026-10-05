import type { GalleryImageScope } from "./product-gallery";
import type { OptionKind } from "./product-options";

export interface MappingInput {
  options: ReadonlyArray<{
    id: string;
    nameAr: string;
    kind: OptionKind;
    archived: boolean;
    values: ReadonlyArray<{
      id: string;
      valueAr: string;
      usesSharedImage: boolean;
    }>;
  }>;
  variants: ReadonlyArray<{
    id: string;
    archived: boolean;
    optionValues: Readonly<Record<string, string>>;
  }>;
  images: ReadonlyArray<{
    id: string;
    archived: boolean;
    scope: GalleryImageScope;
    variantId: string | null;
    optionId: string | null;
    optionValueId: string | null;
  }>;
}

export type MappingProblem =
  | { code: "unassigned_image"; imageId: string; message: string }
  | { code: "stale_mapping"; imageId: string; message: string }
  | {
      code: "value_without_image";
      optionId: string;
      valueId: string;
      message: string;
    };

export const mappingMessages = {
  unassigned: "حدّد لأي لون أو رائحة تتبع هذه الصورة.",
  stale: "هذه الصورة مرتبطة بصنف لم يعد موجوداً.",
  blocked: "لا يمكن نشر المنتج قبل إكمال ربط الصور بالأصناف.",
  valueWithoutImage: (optionName: string, value: string) =>
    `${optionName} «${value}» لا يملك صورة. أضف صورة أو اختر استخدام الصورة العامة.`,
} as const;

/** Options whose values look different on the shelf, so each value needs its own picture or an explicit choice. */
export const VISUAL_OPTION_KINDS: ReadonlySet<OptionKind> = new Set([
  "color",
  "fragrance",
]);

/**
 * Everything that stops a product's images from matching its variants. Drafts may be saved with problems;
 * publishing requires an empty list. A product with a single variant is never asked for per-value images.
 */
export function mappingProblems(input: MappingInput): MappingProblem[] {
  const problems: MappingProblem[] = [];
  const liveVariants = input.variants.filter((variant) => !variant.archived);
  const liveVariantIds = new Set(liveVariants.map((variant) => variant.id));
  const liveValues = new Map<string, string>();
  for (const option of input.options) {
    if (option.archived) continue;
    for (const value of option.values) liveValues.set(value.id, option.id);
  }
  const images = input.images.filter((image) => !image.archived);

  for (const image of images) {
    if (image.scope === "unassigned") {
      problems.push({
        code: "unassigned_image",
        imageId: image.id,
        message: mappingMessages.unassigned,
      });
    } else if (
      (image.scope === "variant" &&
        !(image.variantId && liveVariantIds.has(image.variantId))) ||
      (image.scope === "option_value" &&
        !(
          image.optionValueId &&
          liveValues.get(image.optionValueId) === image.optionId
        ))
    ) {
      problems.push({
        code: "stale_mapping",
        imageId: image.id,
        message: mappingMessages.stale,
      });
    }
  }

  if (liveVariants.length < 2) return problems;
  for (const option of input.options) {
    if (option.archived || !VISUAL_OPTION_KINDS.has(option.kind)) continue;
    for (const value of option.values) {
      const carriers = liveVariants.filter(
        (variant) => variant.optionValues[option.id] === value.id,
      );
      if (!carriers.length || value.usesSharedImage) continue;
      const carrierIds = new Set(carriers.map((variant) => variant.id));
      const pictured = images.some(
        (image) =>
          (image.scope === "option_value" &&
            image.optionValueId === value.id) ||
          (image.scope === "variant" &&
            image.variantId !== null &&
            carrierIds.has(image.variantId)),
      );
      if (!pictured) {
        problems.push({
          code: "value_without_image",
          optionId: option.id,
          valueId: value.id,
          message: mappingMessages.valueWithoutImage(
            option.nameAr,
            value.valueAr,
          ),
        });
      }
    }
  }
  return problems;
}
