import { z } from "zod";

export const MAX_PRODUCT_IMAGES = 8;
export const MAX_VARIANT_IMAGES = 5;

export const galleryImageScopes = [
  "unassigned",
  "product",
  "option_value",
  "variant",
] as const;
export type GalleryImageScope = (typeof galleryImageScopes)[number];

export const galleryImageSchema = z
  .object({
    id: z.string().min(1).max(64),
    src: z.string().min(1).max(500),
    alt: z.string().min(1).max(250),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    sortOrder: z.number().int().nonnegative(),
    isPrimary: z.boolean(),
    scope: z.enum(galleryImageScopes),
    /** Variant domain id, only for scope "variant". */
    variantId: z.string().min(1).max(100).nullable(),
    /** Option and value ids, only for scope "option_value". */
    optionId: z.string().min(1).max(64).nullable(),
    optionValueId: z.string().min(1).max(64).nullable(),
  })
  .strict();

export type GalleryImage = z.infer<typeof galleryImageSchema>;

export function orderGallery<
  T extends { isPrimary: boolean; sortOrder: number },
>(images: readonly T[]): T[] {
  return [...images].sort(
    (left, right) =>
      Number(right.isPrimary) - Number(left.isPrimary) ||
      left.sortOrder - right.sortOrder,
  );
}

export function isPermutation(
  current: readonly string[],
  proposed: readonly string[],
): boolean {
  if (current.length !== proposed.length) return false;
  const wanted = new Set(current);
  return (
    new Set(proposed).size === proposed.length &&
    proposed.every((id) => wanted.has(id))
  );
}
