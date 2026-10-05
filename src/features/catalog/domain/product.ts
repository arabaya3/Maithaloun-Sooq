import { z } from "zod";

import {
  placeholderKinds,
  productAvailabilityValues,
  productCategoryIds,
  productDetailsStatusValues,
  productPublicationValues,
  type PlaceholderKind,
} from "@/features/catalog/domain/product-constants";
import {
  categoryCodeSchema,
  type CategoryIconKey,
} from "@/features/catalog/domain/category";
import {
  isVariantAvailable,
  productSpecificationSchema,
  productVariantSchema,
  type ProductSpecification,
  type ProductVariant,
} from "@/features/catalog/domain/product-variant";

export {
  placeholderKinds,
  productAvailabilityValues,
  productDetailsStatusValues,
  productPublicationValues,
  type PlaceholderKind,
};

export type ProductPublication = (typeof productPublicationValues)[number];

export type CategoryId = string;

export const productCategorySchema = categoryCodeSchema;
export type ProductCategoryId = string;

// The categories that existed before categories became data; only seeds and fixtures use them.
export { productCategoryIds };

export const productIdSchema = z.string().regex(/^[a-z0-9-]{1,80}$/);
export const productSlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const productSchema = z
  .object({
    id: productIdSchema,
    slug: productSlugSchema,
    nameAr: z.string().min(1),
    latinName: z.string().min(1).optional(),
    priceAgorot: z.number().int().nonnegative(),
    categoryId: productCategorySchema,
    image: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("placeholder"),
        variant: z.enum(placeholderKinds),
      }),
      z.object({
        kind: z.literal("image"),
        src: z.string().min(1),
        alt: z.string().min(1),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      }),
    ]),
    availability: z.enum(productAvailabilityValues),
    publication: z.enum(productPublicationValues),
    description: z.string().min(1).optional(),
    usageNotes: z.string().min(1).optional(),
    unit: z.string().min(1).optional(),
    detailsStatus: z.enum(productDetailsStatusValues),
    defaultVariantId: z.string().regex(/^[a-z0-9-]{1,100}$/),
    variants: z.array(productVariantSchema).min(1),
    specifications: z.array(productSpecificationSchema),
  })
  .strict()
  .superRefine((value, context) => {
    const defaultVariant = value.variants.find(
      (variant) => variant.id === value.defaultVariantId,
    );
    if (!defaultVariant) {
      context.addIssue({
        code: "custom",
        path: ["defaultVariantId"],
        message: "Default variant is missing.",
      });
      return;
    }
    if (!defaultVariant.isDefault) {
      context.addIssue({
        code: "custom",
        path: ["defaultVariantId"],
        message: "Default variant flag mismatch.",
      });
    }
  });

export type Product = z.infer<typeof productSchema>;
export type { ProductSpecification, ProductVariant };

// Initial category rows; the database is the source of truth once migrated.
export const seedCategories: ReadonlyArray<{
  code: string;
  nameAr: string;
  icon: CategoryIconKey;
}> = [
  { code: "laundry", nameAr: "منظفات الغسيل", icon: "washing-machine" },
  { code: "kitchen", nameAr: "منظفات المطبخ", icon: "cooking-pot" },
  { code: "bathroom", nameAr: "منظفات الحمام", icon: "bath" },
  { code: "tools", nameAr: "أدوات التنظيف", icon: "brush" },
  { code: "home", nameAr: "مستلزمات منزلية", icon: "house" },
];

export function getProductDisplayName(
  product: Pick<Product, "nameAr" | "latinName">,
): string {
  return product.latinName
    ? `${product.nameAr} ${product.latinName}`
    : product.nameAr;
}

export function isProductAvailable(product: Product): boolean {
  return product.variants.some(isVariantAvailable);
}

export function getDefaultVariant(product: Product): ProductVariant {
  return (
    product.variants.find(
      (variant) => variant.id === product.defaultVariantId,
    ) ?? product.variants[0]!
  );
}
