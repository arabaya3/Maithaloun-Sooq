import { z } from "zod";

import {
  placeholderKinds,
  productAvailabilityValues,
  productCategoryIds,
  productDetailsStatusValues,
  type PlaceholderKind,
} from "@/features/catalog/domain/product-constants";
import {
  productSpecificationSchema,
  productVariantSchema,
  type ProductSpecification,
  type ProductVariant,
} from "@/features/catalog/domain/product-variant";

export {
  placeholderKinds,
  productAvailabilityValues,
  productDetailsStatusValues,
  type PlaceholderKind,
};

export const categoryIds = ["all", ...productCategoryIds] as const;

export type CategoryId = (typeof categoryIds)[number];

export const categorySchema = z.enum(categoryIds);
export const productCategorySchema = categorySchema.exclude(["all"]);
export type ProductCategoryId = z.infer<typeof productCategorySchema>;

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

export const categories: ReadonlyArray<{
  id: CategoryId;
  label: string;
}> = [
  { id: "all", label: "الكل" },
  { id: "laundry", label: "منظفات الغسيل" },
  { id: "kitchen", label: "منظفات المطبخ" },
  { id: "bathroom", label: "منظفات الحمام" },
  { id: "tools", label: "أدوات التنظيف" },
  { id: "home", label: "مستلزمات منزلية" },
];

export function getProductDisplayName(product: Product): string {
  return product.latinName
    ? `${product.nameAr} ${product.latinName}`
    : product.nameAr;
}

export function getCategoryLabel(categoryId: ProductCategoryId): string {
  return (
    categories.find((category) => category.id === categoryId)?.label ??
    categoryId
  );
}

export function isProductAvailable(product: Product): boolean {
  return product.variants.some(
    (variant) => variant.availability === "available",
  );
}

export function getDefaultVariant(product: Product): ProductVariant {
  return (
    product.variants.find(
      (variant) => variant.id === product.defaultVariantId,
    ) ?? product.variants[0]!
  );
}
