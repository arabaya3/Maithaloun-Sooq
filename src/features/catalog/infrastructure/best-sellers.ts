import "server-only";

import { and, desc, eq, gte, ne, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { cache } from "react";

import { db } from "@/server/db/db";
import * as schema from "@/server/db/schema";

const WINDOW_DAYS = 90;

/** Product ids ranked by how many non-cancelled orders included them recently. */
export async function rankBestSellers(
  database: PostgresJsDatabase<typeof schema>,
  limit: number,
  now = new Date(),
): Promise<string[]> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);
  const orders = sql<number>`count(distinct ${schema.orderItems.orderId})`;
  const rows = await database
    .select({ productId: schema.orderItems.productDomainId })
    .from(schema.orderItems)
    .innerJoin(
      schema.orders,
      sql`${schema.orders.id} = ${schema.orderItems.orderId}`,
    )
    .where(
      and(
        ne(schema.orders.status, "cancelled"),
        eq(schema.orders.isTest, false),
        gte(schema.orders.createdAt, since),
      ),
    )
    .groupBy(schema.orderItems.productDomainId)
    .orderBy(desc(orders), schema.orderItems.productDomainId)
    .limit(limit);
  return rows.map((row) => row.productId);
}

export const bestSellerIds = cache(() => rankBestSellers(db, 24));
