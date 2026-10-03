import { z } from "zod";

import {
  cartesian,
  MAX_GENERATED_VARIANTS,
  normalizeOptionText,
  optionKinds,
  sameOptionText,
  type OptionKind,
} from "@/features/catalog/domain/product-options";
import { moneyInputMessages, parseMoneyInput } from "@/shared/lib/money-input";

export const IMAGE_MATCH_CONFIDENCE = 0.8;

export interface DraftOption {
  nameAr: string;
  kind: OptionKind;
  values: string[];
}

export interface DraftVariant {
  values: Record<string, string>;
  price?: number;
  sku?: string;
  barcode?: string;
  packCount?: number;
  openingQuantity?: string;
  openingUnitCost?: number;
}

export interface DraftImage {
  attachmentId: string;
  primary: boolean;
  /** Key of the assigned variant (its option values), or "shared" for the whole product. */
  assignment: string | null;
  suggestion: { value: string; confidence: number } | null;
}

export interface VariantDraftData {
  options: DraftOption[];
  variants: DraftVariant[];
  images: DraftImage[];
}

export const emptyVariantDraft = (): VariantDraftData => ({
  options: [],
  variants: [],
  images: [],
});

export const draftOptionsSchema = z
  .array(
    z
      .object({
        nameAr: z.string().trim().min(1).max(40),
        kind: z.enum(optionKinds),
        values: z.array(z.string().trim().min(1).max(60)).min(1).max(20),
      })
      .strict(),
  )
  .max(4);

export const choicePairsSchema = z
  .array(
    z
      .object({
        option: z.string().trim().min(1).max(40),
        value: z.string().trim().min(1).max(60),
      })
      .strict(),
  )
  .max(4)
  .describe('اختيارات مثل [{ "option": "الرائحة", "value": "مسك" }]');

export const choicesToRecord = (
  pairs: ReadonlyArray<{ option: string; value: string }>,
) => Object.fromEntries(pairs.map((pair) => [pair.option, pair.value]));

export const draftVariantPatchSchema = z
  .object({
    match: choicePairsSchema,
    price: z.string().trim().min(1).max(40).optional(),
    sku: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._-]{3,64}$/)
      .optional(),
    barcode: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._-]{3,64}$/)
      .optional(),
    packCount: z.number().int().min(1).max(1_000).optional(),
    openingQuantity: z.string().trim().min(1).max(12).optional(),
    openingUnitCost: z.string().trim().min(1).max(40).optional(),
  })
  .strict();
export type DraftVariantPatch = z.infer<typeof draftVariantPatchSchema>;

export const variantKey = (values: Record<string, string>) =>
  Object.entries(values)
    .map(
      ([name, value]) =>
        `${normalizeOptionText(name)}=${normalizeOptionText(value)}`,
    )
    .sort()
    .join("|");

export function variantTitle(values: Record<string, string>): string {
  return Object.values(values).join(" · ");
}

// New options rebuild the combinations; details already entered survive when their combination still exists.
export function setDraftOptions(
  draft: VariantDraftData,
  options: DraftOption[],
): { draft: VariantDraftData; error: string | null } {
  const names = options.map((option) => normalizeOptionText(option.nameAr));
  if (new Set(names).size !== names.length) {
    return { draft, error: "في أسماء الخيارات تكرار." };
  }
  for (const option of options) {
    const values = option.values.map(normalizeOptionText);
    if (new Set(values).size !== values.length) {
      return { draft, error: `في قيم ${option.nameAr} تكرار.` };
    }
  }
  const combinations = cartesian(
    options.map((option) => ({ id: option.nameAr, valueIds: option.values })),
    MAX_GENERATED_VARIANTS,
  );
  if (!combinations) {
    return {
      draft,
      error: `التركيبات أكثر من ${MAX_GENERATED_VARIANTS} صنفاً.`,
    };
  }
  const previous = new Map(
    draft.variants.map((variant) => [variantKey(variant.values), variant]),
  );
  const variants = combinations.map((values) => ({
    ...(previous.get(variantKey(values)) ?? {}),
    values: { ...values },
  }));
  const keys = new Set(variants.map((variant) => variantKey(variant.values)));
  return {
    draft: {
      options,
      variants,
      images: draft.images.map((image) =>
        image.assignment &&
        image.assignment !== "shared" &&
        !keys.has(image.assignment)
          ? { ...image, assignment: null }
          : image,
      ),
    },
    error: null,
  };
}

function matches(variant: DraftVariant, match: Record<string, string>) {
  return Object.entries(match).every(([name, value]) =>
    Object.entries(variant.values).some(
      ([ownName, ownValue]) =>
        sameOptionText(ownName, name) && sameOptionText(ownValue, value),
    ),
  );
}

// "الأزرق 12" changes every variant whose choices include أزرق; an unknown choice is reported, never invented.
export function patchDraftVariants(
  draft: VariantDraftData,
  patches: DraftVariantPatch[],
): { draft: VariantDraftData; errors: string[] } {
  const errors: string[] = [];
  const variants = draft.variants.map((variant) => ({ ...variant }));
  for (const patch of patches) {
    const match = choicesToRecord(patch.match);
    const targets = Object.keys(match).length
      ? variants.filter((variant) => matches(variant, match))
      : variants;
    if (!targets.length) {
      errors.push(`ما في صنف «${variantTitle(match)}» في المسودة.`);
      continue;
    }
    for (const target of targets) {
      if (patch.price !== undefined) {
        const price = parseMoneyInput(patch.price);
        if (price.ok) target.price = price.agorot;
        else {
          delete target.price;
          errors.push(
            `${variantTitle(target.values)}: ${moneyInputMessages[price.code]}`,
          );
        }
      }
      if (patch.openingUnitCost !== undefined) {
        const cost = parseMoneyInput(patch.openingUnitCost);
        if (cost.ok) target.openingUnitCost = cost.agorot;
        else
          errors.push(
            `${variantTitle(target.values)}: ${moneyInputMessages[cost.code]}`,
          );
      }
      if (patch.openingQuantity !== undefined) {
        const quantity = Number(patch.openingQuantity.replace(",", "."));
        if (Number.isFinite(quantity) && quantity > 0)
          target.openingQuantity = String(quantity);
        else
          errors.push(
            `${variantTitle(target.values)}: الكمية لازم تكون أكبر من صفر.`,
          );
      }
      if (patch.packCount !== undefined) target.packCount = patch.packCount;
      if (patch.sku !== undefined || patch.barcode !== undefined) {
        if (targets.length > 1) {
          errors.push("SKU والباركود لصنف واحد فقط؛ حددي الصنف بكل اختياراته.");
          continue;
        }
        if (patch.sku !== undefined) target.sku = patch.sku;
        if (patch.barcode !== undefined) target.barcode = patch.barcode;
      }
    }
  }
  return { draft: { ...draft, variants }, errors };
}

// A reading from a photo becomes an assignment only when it is confident and names an existing value exactly.
export function resolveImageSuggestions(
  draft: VariantDraftData,
): VariantDraftData {
  return {
    ...draft,
    images: draft.images.map((image) => {
      if (image.assignment || !image.suggestion) return image;
      if (image.suggestion.confidence < IMAGE_MATCH_CONFIDENCE) return image;
      const reading = image.suggestion.value;
      const hits = draft.variants.filter((variant) =>
        Object.values(variant.values).some((value) =>
          sameOptionText(value, reading),
        ),
      );
      return hits.length === 1
        ? { ...image, assignment: variantKey(hits[0]!.values) }
        : image;
    }),
  };
}

export function assignDraftImage(
  draft: VariantDraftData,
  index: number,
  target: Record<string, string> | "shared",
  primary?: boolean,
): { draft: VariantDraftData; error: string | null } {
  const image = draft.images[index];
  if (!image)
    return { draft, error: `لا توجد صورة رقم ${index + 1} في المسودة.` };
  let assignment = "shared";
  if (target !== "shared") {
    const hits = draft.variants.filter((variant) => matches(variant, target));
    if (hits.length !== 1) {
      return {
        draft,
        error: hits.length
          ? `«${variantTitle(target)}» يطابق أكثر من صنف؛ حددي الصنف بكل اختياراته.`
          : `ما في صنف «${variantTitle(target)}» في المسودة.`,
      };
    }
    assignment = variantKey(hits[0]!.values);
  }
  return {
    draft: {
      ...draft,
      images: draft.images.map((item, position) => ({
        ...item,
        ...(position === index ? { assignment } : {}),
        primary: primary ? position === index : item.primary,
      })),
    },
    error: null,
  };
}

export function variantDraftMissing(
  draft: VariantDraftData,
  fallbackPrice: number | undefined,
): string[] {
  if (!draft.options.length) return [];
  const missing: string[] = [];
  const unpriced = draft.variants.filter(
    (variant) => variant.price === undefined && fallbackPrice === undefined,
  );
  if (unpriced.length) {
    missing.push(
      `سعر ${unpriced.map((variant) => variantTitle(variant.values)).join("، ")}`,
    );
  }
  const half = draft.variants.filter(
    (variant) =>
      (variant.openingQuantity === undefined) !==
      (variant.openingUnitCost === undefined),
  );
  if (half.length)
    missing.push(
      `الكمية والتكلفة معاً لـ ${half.map((variant) => variantTitle(variant.values)).join("، ")}`,
    );
  if (draft.images.length > 1 && draft.variants.length > 1) {
    draft.images.forEach((image, index) => {
      if (!image.assignment) missing.push(`ربط الصورة ${index + 1}`);
    });
  }
  return missing;
}

export function variantDraftToSet(
  draft: VariantDraftData,
  fallbackPrice: number | undefined,
): {
  options: DraftOption[];
  variants: Array<{
    values: Record<string, string>;
    priceAgorot: number;
    sku: string | null;
    barcode: string | null;
    packCount: number | null;
    available: boolean;
    openingStock: { quantityMilli: number; unitCostAgorot: number } | null;
  }>;
  attachments: Array<{
    attachmentId: string;
    variantIndex: number | null;
    primary: boolean;
  }>;
} {
  const keys = draft.variants.map((variant) => variantKey(variant.values));
  const primaryIndex = Math.max(
    0,
    draft.images.findIndex((image) => image.primary),
  );
  return {
    options: draft.options,
    variants: draft.variants.map((variant) => ({
      values: variant.values,
      priceAgorot: (variant.price ?? fallbackPrice)!,
      sku: variant.sku ?? null,
      barcode: variant.barcode ?? null,
      packCount: variant.packCount ?? null,
      available: true,
      openingStock:
        variant.openingQuantity && variant.openingUnitCost
          ? {
              quantityMilli: Math.round(
                Number(variant.openingQuantity) * 1_000,
              ),
              unitCostAgorot: variant.openingUnitCost,
            }
          : null,
    })),
    attachments: draft.images.map((image, index) => {
      const variantIndex =
        image.assignment && image.assignment !== "shared"
          ? keys.indexOf(image.assignment)
          : -1;
      return {
        attachmentId: image.attachmentId,
        variantIndex: variantIndex >= 0 ? variantIndex : null,
        primary: index === primaryIndex,
      };
    }),
  };
}
