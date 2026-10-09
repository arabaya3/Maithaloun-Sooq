import "server-only";

import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "@/server/db/schema";

export interface OrderLineImageSnapshot {
  src: string;
  alt: string;
}

export interface OrderLineOptionSnapshot {
  option: string;
  value: string;
}

export interface OrderLineSnapshot {
  image: OrderLineImageSnapshot | null;
  optionValues: OrderLineOptionSnapshot[] | null;
}

type Reader = Pick<PostgresJsDatabase<typeof schema>, "select">;

/**
 * What the customer saw for each exact variant at ordering time: its own picture first, then a picture
 * of one of its option values, then the variant's stored image. Option values follow the option order.
 */
export async function orderLineSnapshots(
  reader: Reader,
  variants: ReadonlyArray<{
    id: string;
    imageKind: string;
    imageSrc: string | null;
    imageAlt: string | null;
  }>,
): Promise<Map<string, OrderLineSnapshot>> {
  const ids = variants.map((variant) => variant.id);
  if (!ids.length) return new Map();
  const [values, images] = await Promise.all([
    reader
      .select({
        variantId: schema.productVariantOptionValues.variantId,
        valueId: schema.productVariantOptionValues.valueId,
        option: schema.productOptions.nameAr,
        value: schema.productOptionValues.valueAr,
      })
      .from(schema.productVariantOptionValues)
      .innerJoin(
        schema.productOptions,
        eq(
          schema.productOptions.id,
          schema.productVariantOptionValues.optionId,
        ),
      )
      .innerJoin(
        schema.productOptionValues,
        eq(
          schema.productOptionValues.id,
          schema.productVariantOptionValues.valueId,
        ),
      )
      .where(inArray(schema.productVariantOptionValues.variantId, ids))
      .orderBy(asc(schema.productOptions.sortOrder)),
    reader
      .select({
        variantId: schema.productImages.variantId,
        optionValueId: schema.productImages.optionValueId,
        scope: schema.productImages.scope,
        src: schema.productImages.src,
        alt: schema.productImages.altAr,
      })
      .from(schema.productImages)
      .innerJoin(
        schema.productVariants,
        eq(schema.productVariants.productId, schema.productImages.productId),
      )
      .where(
        and(
          inArray(schema.productVariants.id, ids),
          isNull(schema.productImages.archivedAt),
          inArray(schema.productImages.scope, ["variant", "option_value"]),
        ),
      )
      .orderBy(
        desc(schema.productImages.isPrimary),
        asc(schema.productImages.sortOrder),
      ),
  ]);

  const snapshots = new Map<string, OrderLineSnapshot>();
  for (const variant of variants) {
    const own = values.filter((row) => row.variantId === variant.id);
    const valueIds = new Set(own.map((row) => row.valueId));
    const picture =
      images.find(
        (image) => image.scope === "variant" && image.variantId === variant.id,
      ) ??
      images.find(
        (image) =>
          image.scope === "option_value" &&
          image.optionValueId !== null &&
          valueIds.has(image.optionValueId),
      );
    const image = picture
      ? { src: picture.src, alt: picture.alt }
      : variant.imageKind === "image" && variant.imageSrc
        ? { src: variant.imageSrc, alt: variant.imageAlt ?? "" }
        : null;
    snapshots.set(variant.id, {
      image,
      optionValues: own.length
        ? own.map((row) => ({ option: row.option, value: row.value }))
        : null,
    });
  }
  return snapshots;
}
