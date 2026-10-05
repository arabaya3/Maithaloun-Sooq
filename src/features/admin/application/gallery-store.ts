import "server-only";

import { and, asc, eq, isNull, sql } from "drizzle-orm";

import type { Database } from "@/features/inventory/application/stock-ledger";
import { placeholderKinds } from "@/features/catalog/domain/product-constants";
import {
  MAX_PRODUCT_IMAGES,
  type GalleryImageScope,
} from "@/features/catalog/domain/product-gallery";
import { resolveImage } from "@/features/catalog/domain/product-media";
import type {
  MappingInput,
  StructureInput,
} from "@/features/catalog/domain/product-media-validation";
import { sortOptions } from "@/features/catalog/domain/product-options";
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
  /** Defaults to "variant" when variantId is set, otherwise "product". */
  scope?: GalleryImageScope;
  optionId?: string | null;
  optionValueId?: string | null;
  primary?: boolean;
}

export function scopeColumns(image: NewGalleryImage) {
  const scope =
    image.scope ?? (image.variantId ? "variant" : ("product" as const));
  return {
    scope,
    variantId: scope === "variant" ? (image.variantId ?? null) : null,
    optionId: scope === "option_value" ? (image.optionId ?? null) : null,
    optionValueId:
      scope === "option_value" ? (image.optionValueId ?? null) : null,
  };
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
  const columns = scopeColumns(image);
  // Only a shared product image can be the primary one; an image nobody has classified never is.
  const primary =
    columns.scope === "product" &&
    (Boolean(image.primary) ||
      !active.some((row) => row.isPrimary && row.scope === "product"));
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
      ...columns,
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
  const live = await liveStructure(transaction, productId);
  const visible = active.filter((row) => isLiveMapping(row, live));
  const variants = await transaction
    .select()
    .from(schema.productVariants)
    .where(eq(schema.productVariants.productId, productId));
  // Cards show the shared primary image, or else what the default variant's page would show.
  const defaultVariant = variants.find(
    (variant) => variant.isDefault && !variant.archivedAt,
  );
  const primary =
    resolveImage(visible, { variantId: null, selection: {} }) ??
    (defaultVariant
      ? resolveImage(visible, {
          variantId: defaultVariant.id,
          selection: live.selections.get(defaultVariant.id) ?? {},
          optionOrder: live.optionOrder,
        })
      : null);
  const fallbackKind = product.placeholderVariant ?? placeholderKinds[0];
  const productImage = primary ? photo(primary) : placeholder(fallbackKind);
  const now = new Date();
  await transaction
    .update(schema.products)
    .set({ ...productImage, updatedAt: now })
    .where(eq(schema.products.id, productId));
  for (const variant of variants) {
    // Cards, carts and invoices show what the product page would show for this exact variant.
    const own = resolveImage(visible, {
      variantId: variant.id,
      selection: live.selections.get(variant.id) ?? {},
      optionOrder: live.optionOrder,
    });
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

async function liveStructure(transaction: Transaction, productId: string) {
  const [options, values, variants, links] = await Promise.all([
    transaction
      .select()
      .from(schema.productOptions)
      .where(eq(schema.productOptions.productId, productId)),
    transaction
      .select()
      .from(schema.productOptionValues)
      .where(eq(schema.productOptionValues.productId, productId)),
    transaction
      .select({
        id: schema.productVariants.id,
        archivedAt: schema.productVariants.archivedAt,
        labelAr: schema.productVariants.labelAr,
        isDefault: schema.productVariants.isDefault,
        availability: schema.productVariants.availability,
      })
      .from(schema.productVariants)
      .where(eq(schema.productVariants.productId, productId)),
    transaction
      .select()
      .from(schema.productVariantOptionValues)
      .where(eq(schema.productVariantOptionValues.productId, productId)),
  ]);
  const liveOptionIds = new Set(
    options.filter((row) => !row.archivedAt).map((row) => row.id),
  );
  const selections = new Map<string, Record<string, string>>();
  for (const link of links) {
    selections.set(link.variantId, {
      ...(selections.get(link.variantId) ?? {}),
      [link.optionId]: link.valueId,
    });
  }
  return {
    options,
    values,
    variants,
    selections,
    optionOrder: sortOptions(options)
      .filter((row) => liveOptionIds.has(row.id))
      .map((row) => row.id),
    liveVariants: new Set(
      variants.filter((row) => !row.archivedAt).map((row) => row.id),
    ),
    liveValues: new Map(
      values
        .filter((row) => !row.archivedAt && liveOptionIds.has(row.optionId))
        .map((row) => [row.id, row.optionId]),
    ),
  };
}

// An image of an archived variant, option or value is treated as gone; it never falls back to looking shared.
function isLiveMapping(
  row: typeof schema.productImages.$inferSelect,
  live: Awaited<ReturnType<typeof liveStructure>>,
) {
  if (row.scope === "variant")
    return Boolean(row.variantId && live.liveVariants.has(row.variantId));
  if (row.scope === "option_value")
    return Boolean(
      row.optionValueId &&
      live.liveValues.get(row.optionValueId) === row.optionId,
    );
  return row.scope === "product";
}

/** The data mappingProblems() checks, read inside the caller's transaction. */
export async function mappingInputFor(
  transaction: Transaction | Database,
  productId: string,
): Promise<MappingInput> {
  return structureInputFor(transaction, productId);
}

export async function structureInputFor(
  transaction: Transaction | Database,
  productId: string,
): Promise<StructureInput> {
  const executor = transaction as Transaction;
  const [live, images] = await Promise.all([
    liveStructure(executor, productId),
    executor
      .select()
      .from(schema.productImages)
      .where(eq(schema.productImages.productId, productId)),
  ]);
  return {
    options: live.options.map((option) => ({
      id: option.id,
      nameAr: option.nameAr,
      kind: option.kind,
      archived: Boolean(option.archivedAt),
      values: live.values
        .filter((value) => value.optionId === option.id && !value.archivedAt)
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .map((value) => ({
          id: value.id,
          valueAr: value.valueAr,
          usesSharedImage: value.usesSharedImage,
        })),
    })),
    variants: live.variants.map((variant) => ({
      id: variant.id,
      archived: Boolean(variant.archivedAt),
      optionValues: live.selections.get(variant.id) ?? {},
      labelAr: variant.labelAr,
      isDefault: variant.isDefault,
      available: variant.availability === "available",
    })),
    images: images.map((image) => ({
      id: image.id,
      archived: Boolean(image.archivedAt),
      scope: image.scope,
      variantId: image.variantId,
      optionId: image.optionId,
      optionValueId: image.optionValueId,
      isPrimary: image.isPrimary,
    })),
  };
}
