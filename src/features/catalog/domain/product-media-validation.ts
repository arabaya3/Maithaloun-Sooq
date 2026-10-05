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

export interface StructureInput extends MappingInput {
  variants: ReadonlyArray<
    MappingInput["variants"][number] & {
      labelAr: string;
      isDefault: boolean;
      available: boolean;
    }
  >;
  images: ReadonlyArray<
    MappingInput["images"][number] & { isPrimary: boolean }
  >;
}

export type StructureProblem = {
  code:
    | "no_default_variant"
    | "default_unavailable"
    | "incomplete_variant"
    | "archived_value"
    | "duplicate_combination"
    | "primary_not_shared";
  message: string;
};

export const structureMessages = {
  noDefault:
    "لا يوجد صنف افتراضي فعّال يظهر أولاً للزبون. اختاري صنفاً افتراضياً.",
  defaultUnavailable: (label: string) =>
    `الصنف الافتراضي «${label}» غير متوفر بينما توجد أصناف متوفرة. اختاري صنفاً افتراضياً متوفراً.`,
  incomplete: (label: string, option: string) =>
    `الصنف «${label}» ينقصه اختيار «${option}».`,
  archivedValue: (label: string, option: string) =>
    `الصنف «${label}» مربوط بقيمة مؤرشفة في «${option}». اختاري قيمة فعّالة.`,
  duplicate: (first: string, second: string) =>
    `الصنفان «${first}» و«${second}» لهما نفس الاختيارات، فلا يميّز الزبون بينهما.`,
  primaryNotShared:
    "الصورة الرئيسية يجب أن تكون صورة عامة للمنتج. اختاري صورة عامة كصورة رئيسية.",
} as const;

/**
 * Variant rules that keep the storefront selection and the cart on the same variant.
 * Products without live options keep their legacy behaviour; only the default and the primary image are checked.
 */
export function structureProblems(input: StructureInput): StructureProblem[] {
  const problems: StructureProblem[] = [];
  const live = input.variants.filter((variant) => !variant.archived);
  if (!live.length) return problems;
  const defaults = live.filter((variant) => variant.isDefault);
  if (!defaults.length) {
    problems.push({
      code: "no_default_variant",
      message: structureMessages.noDefault,
    });
  } else if (
    !defaults[0]!.available &&
    live.some((variant) => variant.available)
  ) {
    problems.push({
      code: "default_unavailable",
      message: structureMessages.defaultUnavailable(defaults[0]!.labelAr),
    });
  }

  const options = input.options.filter((option) => !option.archived);
  if (options.length) {
    const liveValues = new Map<string, Set<string>>(
      options.map((option) => [
        option.id,
        new Set(option.values.map((value) => value.id)),
      ]),
    );
    const seen = new Map<string, string>();
    for (const variant of live) {
      let complete = true;
      for (const option of options) {
        const value = variant.optionValues[option.id];
        if (!value) {
          complete = false;
          problems.push({
            code: "incomplete_variant",
            message: structureMessages.incomplete(
              variant.labelAr,
              option.nameAr,
            ),
          });
        } else if (!liveValues.get(option.id)!.has(value)) {
          complete = false;
          problems.push({
            code: "archived_value",
            message: structureMessages.archivedValue(
              variant.labelAr,
              option.nameAr,
            ),
          });
        }
      }
      if (!complete) continue;
      const key = options
        .map((option) => variant.optionValues[option.id])
        .join("|");
      const other = seen.get(key);
      if (other) {
        problems.push({
          code: "duplicate_combination",
          message: structureMessages.duplicate(other, variant.labelAr),
        });
      } else {
        seen.set(key, variant.labelAr);
      }
    }
  }

  const primary = input.images.find(
    (image) => image.isPrimary && !image.archived,
  );
  if (primary && primary.scope !== "product") {
    problems.push({
      code: "primary_not_shared",
      message: structureMessages.primaryNotShared,
    });
  }
  return problems;
}
