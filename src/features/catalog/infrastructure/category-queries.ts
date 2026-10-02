import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  categoryIconKeys,
  type CategoryIconKey,
  type ProductCategory,
} from "@/features/catalog/domain/category";
import * as schema from "@/server/db/schema";

const icons = new Set<string>(categoryIconKeys);

export async function listStorefrontCategories(
  database: PostgresJsDatabase<typeof schema>,
): Promise<ProductCategory[]> {
  const rows = await database
    .select()
    .from(schema.productCategories)
    .where(
      and(
        isNull(schema.productCategories.archivedAt),
        eq(schema.productCategories.visible, true),
      ),
    )
    .orderBy(
      asc(schema.productCategories.sortOrder),
      asc(schema.productCategories.code),
    );
  return rows.map((row) => ({
    code: row.code,
    nameAr: row.nameAr,
    description: row.description,
    icon: (icons.has(row.icon) ? row.icon : "grid") as CategoryIconKey,
    sortOrder: row.sortOrder,
    visible: row.visible,
  }));
}

// Categories a product can be filed under, including ones hidden from the storefront.
export async function listAssignableCategories(
  database: PostgresJsDatabase<typeof schema>,
): Promise<Array<{ code: string; nameAr: string }>> {
  return database
    .select({
      code: schema.productCategories.code,
      nameAr: schema.productCategories.nameAr,
    })
    .from(schema.productCategories)
    .where(isNull(schema.productCategories.archivedAt))
    .orderBy(
      asc(schema.productCategories.sortOrder),
      asc(schema.productCategories.code),
    );
}
