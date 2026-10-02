import "server-only";

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  productIdSchema,
  productSlugSchema,
  type Product,
} from "@/features/catalog/domain/product";
import type { ProductRepository } from "@/features/catalog/domain/product-repository";
import * as schema from "@/server/db/schema";

// The storefront only ever sees published, unarchived products.
const onStorefront = and(
  eq(schema.products.publication, "published"),
  isNull(schema.products.archivedAt),
);

import { liveOffersForVariants } from "./offer-queries";
import { mapProductRow } from "./product-row-mapper";

export class PostgresProductRepository implements ProductRepository {
  constructor(private readonly database: PostgresJsDatabase<typeof schema>) {}

  async list(): Promise<readonly Product[]> {
    const rows = await this.database
      .select()
      .from(schema.products)
      .where(onStorefront)
      .orderBy(asc(schema.products.sortOrder));
    return this.mapProducts(rows);
  }

  async getById(id: string): Promise<Product | null> {
    if (!productIdSchema.safeParse(id).success) return null;
    const [row] = await this.database
      .select()
      .from(schema.products)
      .where(and(eq(schema.products.domainId, id), onStorefront))
      .limit(1);
    if (!row) return null;
    const [product] = await this.mapProducts([row]);
    return product ?? null;
  }

  async getBySlug(slug: string): Promise<Product | null> {
    if (!productSlugSchema.safeParse(slug).success) return null;
    const [row] = await this.database
      .select()
      .from(schema.products)
      .where(and(eq(schema.products.slug, slug), onStorefront))
      .limit(1);
    if (!row) return null;
    const [product] = await this.mapProducts([row]);
    return product ?? null;
  }

  async getByIds(ids: readonly string[]): Promise<readonly Product[]> {
    const validIds = [...new Set(ids)].filter(
      (id) => productIdSchema.safeParse(id).success,
    );
    if (!validIds.length) return [];

    const rows = await this.database
      .select()
      .from(schema.products)
      .where(and(inArray(schema.products.domainId, validIds), onStorefront));
    const products = await this.mapProducts(rows);
    const byId = new Map(products.map((product) => [product.id, product]));
    return validIds.flatMap((id) => {
      const product = byId.get(id);
      return product ? [product] : [];
    });
  }

  private async mapProducts(
    rows: (typeof schema.products.$inferSelect)[],
  ): Promise<Product[]> {
    if (!rows.length) return [];
    const productIds = rows.map((row) => row.id);
    const [variantRows, specRows] = await Promise.all([
      this.database
        .select()
        .from(schema.productVariants)
        .where(inArray(schema.productVariants.productId, productIds))
        .orderBy(asc(schema.productVariants.sortOrder)),
      this.database
        .select()
        .from(schema.productSpecifications)
        .where(inArray(schema.productSpecifications.productId, productIds))
        .orderBy(asc(schema.productSpecifications.sortOrder)),
    ]);

    const variantsByProductId = new Map<
      string,
      (typeof schema.productVariants.$inferSelect)[]
    >();
    for (const variant of variantRows) {
      const list = variantsByProductId.get(variant.productId) ?? [];
      list.push(variant);
      variantsByProductId.set(variant.productId, list);
    }

    const specsByProductId = new Map<
      string,
      (typeof schema.productSpecifications.$inferSelect)[]
    >();
    for (const spec of specRows) {
      const list = specsByProductId.get(spec.productId) ?? [];
      list.push(spec);
      specsByProductId.set(spec.productId, list);
    }

    const categoryByProductId = new Map(
      rows.map((row) => [row.id, row.categoryId]),
    );
    const offers = await liveOffersForVariants(
      this.database,
      variantRows
        .filter((variant) => !variant.archivedAt)
        .map((variant) => ({
          variantId: variant.id,
          productId: variant.productId,
          categoryCode: categoryByProductId.get(variant.productId)!,
          priceAgorot: variant.priceAgorot,
        })),
      new Date(),
    );

    return rows.map((row) =>
      mapProductRow(
        row,
        variantsByProductId.get(row.id) ?? [],
        specsByProductId.get(row.id) ?? [],
        offers,
      ),
    );
  }
}
