import "server-only";

import { and, asc, count, eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z } from "zod";

import { MAX_ACCOUNT_FAVORITES } from "@/features/accounts/domain/account-config";
import { productIdSchema } from "@/features/catalog/domain/product";
import * as schema from "@/server/db/schema";

type Database = PostgresJsDatabase<typeof schema>;

export const favoriteIdsSchema = z
  .array(productIdSchema)
  .max(MAX_ACCOUNT_FAVORITES);

export class CustomerFavoritesService {
  constructor(private readonly database: Database) {}

  async list(accountId: string): Promise<string[]> {
    const rows = await this.database
      .select({ id: schema.customerFavorites.productDomainId })
      .from(schema.customerFavorites)
      .where(eq(schema.customerFavorites.accountId, accountId))
      .orderBy(asc(schema.customerFavorites.createdAt));
    return rows.map((row) => row.id);
  }

  async retiredNames(
    accountId: string,
    visibleIds: ReadonlySet<string>,
  ): Promise<string[]> {
    const rows = await this.database
      .select({ id: schema.products.domainId, name: schema.products.nameAr })
      .from(schema.customerFavorites)
      .innerJoin(
        schema.products,
        eq(schema.customerFavorites.productDomainId, schema.products.domainId),
      )
      .where(eq(schema.customerFavorites.accountId, accountId));
    return rows.filter((row) => !visibleIds.has(row.id)).map((row) => row.name);
  }

  async set(
    accountId: string,
    productId: string,
    favorite: boolean,
  ): Promise<boolean> {
    if (!productIdSchema.safeParse(productId).success) return false;
    if (!favorite) {
      await this.database
        .delete(schema.customerFavorites)
        .where(
          and(
            eq(schema.customerFavorites.accountId, accountId),
            eq(schema.customerFavorites.productDomainId, productId),
          ),
        );
      return true;
    }
    return (await this.merge(accountId, [productId], false)).added >= 0;
  }

  // Adds only; never removes server favourites. Safe to retry: duplicates are ignored.
  async merge(
    accountId: string,
    productIds: unknown,
    record = true,
  ): Promise<{ added: number; total: number }> {
    const parsed = favoriteIdsSchema.safeParse(productIds);
    if (!parsed.success) return { added: 0, total: 0 };
    const ids = [...new Set(parsed.data)];
    return this.database.transaction(async (transaction) => {
      await transaction
        .select({ id: schema.customerAccounts.id })
        .from(schema.customerAccounts)
        .where(eq(schema.customerAccounts.id, accountId))
        .for("update");
      const known = ids.length
        ? await transaction
            .select({ id: schema.products.domainId })
            .from(schema.products)
            .where(inArray(schema.products.domainId, ids))
        : [];
      const [{ total: before } = { total: 0 }] = await transaction
        .select({ total: count() })
        .from(schema.customerFavorites)
        .where(eq(schema.customerFavorites.accountId, accountId));
      const room = Math.max(0, MAX_ACCOUNT_FAVORITES - before);
      const inserted =
        known.length && room
          ? await transaction
              .insert(schema.customerFavorites)
              .values(
                known
                  .slice(0, room)
                  .map((row) => ({ accountId, productDomainId: row.id })),
              )
              .onConflictDoNothing()
              .returning({ id: schema.customerFavorites.productDomainId })
          : [];
      if (record && inserted.length) {
        await transaction.insert(schema.customerAccountEvents).values({
          accountId,
          type: "favorites_merged",
          detail: { added: inserted.length },
        });
      }
      return { added: inserted.length, total: before + inserted.length };
    });
  }
}
