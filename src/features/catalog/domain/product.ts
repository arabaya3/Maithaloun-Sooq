import { z } from "zod";

export const categoryIds = [
  "all",
  "laundry",
  "kitchen",
  "bathroom",
  "tools",
  "home",
] as const;

export type CategoryId = (typeof categoryIds)[number];

export const categorySchema = z.enum(categoryIds);

export const placeholderKinds = [
  "general-cleaner",
  "bleach",
  "brush",
  "dish-liquid",
  "floor-cleaner",
  "degreaser",
] as const;

export type PlaceholderKind = (typeof placeholderKinds)[number];

export const productSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  priceIls: z.number().positive(),
  categoryId: categorySchema.exclude(["all"]),
  image: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("placeholder"),
      variant: z.enum(placeholderKinds),
    }),
    z.object({
      kind: z.literal("image"),
      src: z.string().min(1),
      alt: z.string().min(1),
    }),
  ]),
  detailsStatus: z.enum(["unknown", "complete"]),
  purchasable: z.boolean(),
});

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
