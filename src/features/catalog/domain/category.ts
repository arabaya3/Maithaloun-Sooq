import { z } from "zod";

export const ALL_CATEGORIES = "all";

export const categoryIconKeys = [
  "grid",
  "washing-machine",
  "cooking-pot",
  "bath",
  "brush",
  "house",
  "spray-can",
  "sparkles",
  "droplets",
  "shirt",
  "package",
  "leaf",
] as const;
export type CategoryIconKey = (typeof categoryIconKeys)[number];

export const categoryIconLabels: Record<CategoryIconKey, string> = {
  grid: "شبكة",
  "washing-machine": "غسالة",
  "cooking-pot": "طنجرة",
  bath: "حوض استحمام",
  brush: "فرشاة",
  house: "بيت",
  "spray-can": "بخاخ",
  sparkles: "لمعان",
  droplets: "قطرات",
  shirt: "قميص",
  package: "علبة",
  leaf: "ورقة شجر",
};

export const categoryCodeSchema = z
  .string()
  .min(2)
  .max(40)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .refine((value) => value !== ALL_CATEGORIES);

export const categoryNameSchema = z.string().trim().min(2).max(80);

export interface ProductCategory {
  code: string;
  nameAr: string;
  description: string | null;
  icon: CategoryIconKey;
  sortOrder: number;
  visible: boolean;
}

export interface AdminProductCategory extends ProductCategory {
  archived: boolean;
  mergedIntoCode: string | null;
  productCount: number;
  updatedAt: string;
}

export function categoryLabel(
  categories: readonly Pick<ProductCategory, "code" | "nameAr">[],
  code: string,
): string {
  return categories.find((category) => category.code === code)?.nameAr ?? code;
}

// Codes are ASCII so URLs and filters stay stable; Arabic names are labels only.
export function categoryCodeFrom(name: string, taken: ReadonlySet<string>) {
  const base =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 30) || "category";
  let code = base.length >= 2 ? base : `category-${base}`;
  for (let index = 2; taken.has(code); index += 1) {
    code = `${base}-${index}`;
  }
  return code;
}
