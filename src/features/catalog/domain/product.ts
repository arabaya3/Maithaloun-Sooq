import { z } from "zod";

export const productCategoryIds = [
  "laundry",
  "kitchen",
  "bathroom",
  "tools",
  "home",
] as const;
export const categoryIds = ["all", ...productCategoryIds] as const;

export type CategoryId = (typeof categoryIds)[number];

export const categorySchema = z.enum(categoryIds);
export const productCategorySchema = categorySchema.exclude(["all"]);
export type ProductCategoryId = z.infer<typeof productCategorySchema>;

export const productIdSchema = z.string().regex(/^[a-z0-9-]{1,80}$/);
export const productSlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const placeholderKinds = [
  "general-cleaner",
  "bleach",
  "brush",
  "dish-liquid",
  "floor-cleaner",
  "degreaser",
] as const;

export type PlaceholderKind = (typeof placeholderKinds)[number];
export const productAvailabilityValues = ["available", "unavailable"] as const;
export const productDetailsStatusValues = ["placeholder", "verified"] as const;

export const productSchema = z
  .object({
    id: productIdSchema,
    slug: productSlugSchema,
    nameAr: z.string().min(1),
    latinName: z.string().min(1).optional(),
    priceAgorot: z.number().int().positive(),
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
  })
  .strict();

export type Product = z.infer<typeof productSchema>;

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
  return product.availability === "available";
}
