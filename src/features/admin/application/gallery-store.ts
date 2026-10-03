import "server-only";

import { and, asc, eq, isNull, sql } from "drizzle-orm";

import type { Database } from "@/features/inventory/application/stock-ledger";
import { placeholderKinds } from "@/features/catalog/domain/product-constants";
import { MAX_PRODUCT_IMAGES } from "@/features/catalog/domain/product-gallery";
import * as schema from "@/server/db/schema";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export class GalleryLimitError extends Error {
  constructor() {
    super("gallery_full");
  }
}

export interface NewGalleryImage {
  src: string;
  alt: string;
  width: number;
  height: number;
  variantId?: string | null;
  primary?: boolean;
}

export async function activeGallery(
  transaction: Transaction,
  productId: string,
) {
  return transaction
    .select()
    .from(schema.productImages)
    .where(
      and(
        eq(schema.productImages.productId, productId),
        isNull(schema.productImages.archivedAt),
      ),
    )
    .orderBy(
      sql`${schema.productImages.isPrimary} DESC`,
      asc(schema.productImages.sortOrder),
      asc(schema.productImages.createdAt),
    );
}

export async function addGalleryImage(
  transaction: Transaction,
  productId: string,
  image: NewGalleryImage,
) {
  const active = await activeGallery(transaction, productId);
  if (active.length >= MAX_PRODUCT_IMAGES) throw new GalleryLimitError();
  const primary = image.primary || !active.some((row) => row.isPrimary);
  if (primary) {
    await transaction
      .update(schema.productImages)
      .set({ isPrimary: false, updatedAt: new Date() })
      .where(
        and(
          eq(schema.productImages.productId, productId),
          eq(schema.productImages.isPrimary, true),
        ),
      );
  }
  const [row] = await transaction
    .insert(schema.productImages)
    .values({
      productId,
      variantId: image.variantId ?? null,
      src: image.src,
      altAr: image.alt.slice(0, 250),
      width: image.width,
      height: image.height,
      sortOrder: primary
        ? 0
        : Math.max(-1, ...active.map((item) => item.sortOrder)) + 1,
      isPrimary: primary,
    })
    .returning();
  if (primary) {
    await renumber(transaction, productId, row!.id);
  }
  return row!;
}

// Keeps sort orders dense after a change, with the primary image first.
export async function renumber(
  transaction: Transaction,
  productId: string,
  firstId?: string,
) {
  const active = await activeGallery(transaction, productId);
  const ordered = firstId
    ? [
        ...active.filter((row) => row.id === firstId),
        ...active.filter((row) => row.id !== firstId),
      ]
    : active;
  for (const [index, row] of ordered.entries()) {
    if (row.sortOrder !== index) {
      await transaction
        .update(schema.productImages)
        .set({ sortOrder: index })
        .where(eq(schema.productImages.id, row.id));
    }
  }
}

const placeholder = (kind: (typeof placeholderKinds)[number]) => ({
  imageKind: "placeholder" as const,
  placeholderVariant: kind,
  imageSrc: null,
  imageAlt: null,
  imageWidth: null,
  imageHeight: null,
});

const photo = (row: typeof schema.productImages.$inferSelect) => ({
  imageKind: "image" as const,
  placeholderVariant: null,
  imageSrc: row.src,
  imageAlt: row.altAr,
  imageWidth: row.width,
  imageHeight: row.height,
});

// The gallery is authoritative; the older single-image columns mirror it for cards, carts and existing readers.
export async function syncImageMirrors(
  transaction: Transaction,
  productId: string,
) {
  const [product] = await transaction
    .select()
    .from(schema.products)
    .where(eq(schema.products.id, productId));
  if (!product) return;
  const active = await activeGallery(transaction, productId);
  const primary = active.find((row) => row.isPrimary) ?? active[0] ?? null;
  const fallbackKind = product.placeholderVariant ?? placeholderKinds[0];
  const productImage = primary ? photo(primary) : placeholder(fallbackKind);
  const now = new Date();
  await transaction
    .update(schema.products)
    .set({ ...productImage, updatedAt: now })
    .where(eq(schema.products.id, productId));
  const variants = await transaction
    .select()
    .from(schema.productVariants)
    .where(eq(schema.productVariants.productId, productId));
  for (const variant of variants) {
    const own = active.find((row) => row.variantId === variant.id);
    const image = own
      ? photo(own)
      : primary
        ? photo(primary)
        : placeholder(variant.placeholderVariant ?? fallbackKind);
    if (
      variant.imageKind !== image.imageKind ||
      variant.imageSrc !== image.imageSrc ||
      variant.imageAlt !== image.imageAlt
    ) {
      await transaction
        .update(schema.productVariants)
        .set({ ...image, updatedAt: now })
        .where(eq(schema.productVariants.id, variant.id));
    }
  }
}
