import "server-only";

import { and, count, eq, gte } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type { AdminOrderListItem } from "@/features/admin/application/admin-order-service";
import { AdminOrderService } from "@/features/admin/application/admin-order-service";
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
  deliveredToday: number;
  actionableOrders: AdminOrderListItem[];
}

export class AdminDashboardService {
  constructor(private readonly database: PostgresJsDatabase<typeof schema>) {}

  async getSummary(actor: AdminActor): Promise<AdminDashboardSummary> {
    assertOwnerActor(actor);
    const orderService = new AdminOrderService(this.database);
    const startOfUtcDay = new Date();
    startOfUtcDay.setUTCHours(0, 0, 0, 0);

    const [orderRows, availabilityRows, deliveredTodayRows, actionableOrders] =
      await Promise.all([
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
          .select({ total: count() })
          .from(schema.orders)
          .where(
            and(
              eq(schema.orders.status, "delivered"),
              gte(schema.orders.updatedAt, startOfUtcDay),
            ),
          ),
        orderService.listActionable(actor, 8),
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
      deliveredToday: deliveredTodayRows[0]?.total ?? 0,
      actionableOrders,
    };
  }
}
