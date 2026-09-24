import { z } from "zod";

import {
  placeholderKinds,
  productAvailabilityValues,
} from "@/features/catalog/domain/product-constants";

export const variantDomainIdSchema = z.string().regex(/^[a-z0-9-]{1,100}$/);

const attributeKeySchema = z.string().trim().min(1).max(40);
const attributeValueSchema = z.string().trim().min(1).max(80);

export const variantAttributesSchema = z
  .record(attributeKeySchema, attributeValueSchema)
  .superRefine((value, context) => {
    const keys = Object.keys(value);
    if (keys.length > 8) {
      context.addIssue({
        code: "custom",
        message: "Too many variant attributes.",
      });
    }
  });

export type VariantAttributes = z.infer<typeof variantAttributesSchema>;

export const variantImageSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("placeholder"),
    variant: z.enum(placeholderKinds),
  }),
  z.object({
    kind: z.literal("image"),
    src: z.string().min(1).max(500),
    alt: z.string().min(1).max(250),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
]);

export const productVariantSchema = z
  .object({
    id: variantDomainIdSchema,
    productId: z.string().regex(/^[a-z0-9-]{1,80}$/),
    labelAr: z.string().min(1).max(120),
    attributes: variantAttributesSchema,
    priceAgorot: z.number().int().nonnegative().max(10_000_000),
    availability: z.enum(productAvailabilityValues),
    image: variantImageSchema,
    sku: z.string().min(1).max(64).optional(),
    barcode: z.string().min(1).max(64).optional(),
    sortOrder: z.number().int().nonnegative(),
    isDefault: z.boolean(),
  })
  .strict();

export type ProductVariant = z.infer<typeof productVariantSchema>;

export const productSpecificationSchema = z
  .object({
    id: z.string().uuid(),
    labelAr: z.string().min(1).max(80),
    valueAr: z.string().min(1).max(200),
    sortOrder: z.number().int().nonnegative(),
  })
  .strict();

export type ProductSpecification = z.infer<typeof productSpecificationSchema>;

export function formatVariantAttributes(attributes: VariantAttributes): string {
  return Object.entries(attributes)
    .map(([key, value]) => `${key}: ${value}`)
    .join(" · ");
}

export function getVariantAttributeLabel(
  variants: readonly ProductVariant[],
): string | null {
  const keys = new Set<string>();
  for (const variant of variants) {
    for (const key of Object.keys(variant.attributes)) {
      keys.add(key);
    }
  }
  if (keys.size === 1) return [...keys][0] ?? null;
  return null;
}

export function resolveVariant(
  variants: readonly ProductVariant[],
  requestedVariantId: string | null | undefined,
): ProductVariant | null {
  if (!variants.length) return null;
  if (requestedVariantId) {
    const match = variants.find((variant) => variant.id === requestedVariantId);
    if (match) return match;
  }
  return variants.find((variant) => variant.isDefault) ?? variants[0] ?? null;
}

export function isVariantAvailable(variant: ProductVariant): boolean {
  return variant.availability === "available";
}

export function getProductPriceRangeAgorot(
  variants: readonly ProductVariant[],
): { min: number; max: number } | null {
  const prices = variants
    .filter((variant) => variant.availability === "available")
    .map((variant) => variant.priceAgorot);
  if (!prices.length) return null;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return { min, max };
}
