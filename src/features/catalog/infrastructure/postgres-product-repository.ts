import "server-only";

import { asc, eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  productIdSchema,
  productSlugSchema,
  type Product,
} from "@/features/catalog/domain/product";
import type { ProductRepository } from "@/features/catalog/domain/product-repository";
import * as schema from "@/server/db/schema";

import { mapProductRow } from "./product-row-mapper";

export class PostgresProductRepository implements ProductRepository {
  constructor(private readonly database: PostgresJsDatabase<typeof schema>) {}

  async list(): Promise<readonly Product[]> {
    const rows = await this.database
      .select()
      .from(schema.products)
      .orderBy(asc(schema.products.sortOrder));
    return rows.map(mapProductRow);
  }

  async getById(id: string): Promise<Product | null> {
    if (!productIdSchema.safeParse(id).success) return null;
    const [row] = await this.database
      .select()
      .from(schema.products)
      .where(eq(schema.products.domainId, id))
      .limit(1);
    return row ? mapProductRow(row) : null;
  }

  async getBySlug(slug: string): Promise<Product | null> {
    if (!productSlugSchema.safeParse(slug).success) return null;
    const [row] = await this.database
      .select()
      .from(schema.products)
      .where(eq(schema.products.slug, slug))
      .limit(1);
    return row ? mapProductRow(row) : null;
  }

  async getByIds(ids: readonly string[]): Promise<readonly Product[]> {
    const validIds = [...new Set(ids)].filter(
      (id) => productIdSchema.safeParse(id).success,
    );
    if (!validIds.length) return [];

    const rows = await this.database
      .select()
      .from(schema.products)
      .where(inArray(schema.products.domainId, validIds));
    const rowsById = new Map(rows.map((row) => [row.domainId, row]));

    return validIds.flatMap((id) => {
      const row = rowsById.get(id);
      return row ? [mapProductRow(row)] : [];
    });
  }
}
