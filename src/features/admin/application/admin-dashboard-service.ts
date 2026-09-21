import "server-only";

import { count, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  assertOwnerActor,
  type AdminActor,
} from "@/features/admin/domain/admin-actor";
import {
  orderStatuses,
  type OrderStatus,
} from "@/features/orders/domain/order-status";
import * as schema from "@/server/db/schema";

export interface AdminDashboardSummary {
  orders: Record<OrderStatus, number>;
  availableProducts: number;
  unavailableProducts: number;
  deliveredKnownRevenueAgorot: number;
}

export class AdminDashboardService {
  constructor(private readonly database: PostgresJsDatabase<typeof schema>) {}

  async getSummary(actor: AdminActor): Promise<AdminDashboardSummary> {
    assertOwnerActor(actor);

    const [orderRows, availabilityRows, revenueRows] = await Promise.all([
      this.database
        .select({
          status: schema.orders.status,
          total: count(),
        })
        .from(schema.orders)
        .groupBy(schema.orders.status),
      this.database
        .select({
          availability: schema.products.availability,
          total: count(),
        })
        .from(schema.products)
        .groupBy(schema.products.availability),
      this.database
        .select({
          total: sql<number>`coalesce(sum(${schema.orders.finalTotalAgorot}), 0)`,
        })
        .from(schema.orders)
        .where(
          sql`${schema.orders.status} = 'delivered' AND ${schema.orders.finalTotalAgorot} IS NOT NULL`,
        ),
    ]);

    const orders = Object.fromEntries(
      orderStatuses.map((status) => [status, 0]),
    ) as Record<OrderStatus, number>;
    for (const row of orderRows) {
      orders[row.status] = row.total;
    }

    return {
      orders,
      availableProducts:
        availabilityRows.find((row) => row.availability === "available")
          ?.total ?? 0,
      unavailableProducts:
        availabilityRows.find((row) => row.availability === "unavailable")
          ?.total ?? 0,
      deliveredKnownRevenueAgorot: Number(revenueRows[0]?.total ?? 0),
    };
  }
}
