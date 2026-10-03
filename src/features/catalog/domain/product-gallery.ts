import { z } from "zod";

export const MAX_PRODUCT_IMAGES = 8;
export const MAX_VARIANT_IMAGES = 5;

export const galleryImageSchema = z
  .object({
    id: z.string().min(1).max(64),
    src: z.string().min(1).max(500),
    alt: z.string().min(1).max(250),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    sortOrder: z.number().int().nonnegative(),
    isPrimary: z.boolean(),
    variantId: z.string().min(1).max(100).nullable(),
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

// A variant shows its own images first, then the shared product images; another variant's images are left out.
export function galleryForVariant(
  images: readonly GalleryImage[],
  variantId: string | null,
): GalleryImage[] {
  const ordered = orderGallery(images);
  const own = ordered.filter(
    (image) => variantId && image.variantId === variantId,
  );
  const shared = ordered.filter((image) => !image.variantId);
  return [...own, ...shared];
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
