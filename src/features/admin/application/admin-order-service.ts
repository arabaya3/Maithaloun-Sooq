import "server-only";

import { and, asc, count, desc, eq, gte, lte, or, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  assertOwnerActor,
  type AdminActor,
} from "@/features/admin/domain/admin-actor";
import {
  assertSafeAuditState,
  redactOrderStatusAuditState,
} from "@/features/admin/domain/audit";
import {
  buildWhatsAppContactUrl,
  formatWhatsAppDisplay,
  isSupportedWhatsAppE164,
  normalizePalestinianPhone,
} from "@/features/orders/domain/phone";
import {
  canTransitionOrderStatus,
  isOrderStatus,
  type OrderStatus,
} from "@/features/orders/domain/order-status";
import * as schema from "@/server/db/schema";

export class AdminOrderError extends Error {
  constructor(
    readonly code:
      | "not_found"
      | "invalid_transition"
      | "concurrency_conflict"
      | "invalid_input",
  ) {
    super(code);
    this.name = "AdminOrderError";
  }
}

export interface AdminOrderListQuery {
  status?: OrderStatus;
  createdFrom?: Date;
  createdTo?: Date;
  publicReference?: string;
  phone?: string;
  page: number;
}

export interface AdminOrderListItem {
  publicReference: string;
  status: OrderStatus;
  createdAt: string;
  itemsSubtotalAgorot: number;
  deliveryFeeAgorot: number | null;
  finalTotalAgorot: number | null;
}

export interface AdminOrderDetail {
  publicReference: string;
  status: OrderStatus;
  version: number;
  customerName: string;
  phone: string;
  address: string;
  landmark: string | null;
  customerNote: string | null;
  whatsappPhoneE164: string | null;
  whatsappContactUrl: string | null;
  serviceAreaCode: string;
  serviceAreaName: string;
  items: ReadonlyArray<{
    productId: string;
    productName: string;
    quantity: number;
    unitPriceAgorot: number;
    lineSubtotalAgorot: number;
  }>;
  itemsSubtotalAgorot: number;
  deliveryFeeAgorot: number | null;
  finalTotalAgorot: number | null;
  paymentMethod: "cash_on_delivery";
  createdAt: string;
  history: ReadonlyArray<{
    previousStatus: OrderStatus;
    newStatus: OrderStatus;
    reason: string | null;
    actorName: string;
    createdAt: string;
  }>;
}

const PAGE_SIZE = 20;
const PUBLIC_REFERENCE_PATTERN = /^MS-[A-Za-z0-9_-]{24}$/;

export class AdminOrderService {
  constructor(private readonly database: PostgresJsDatabase<typeof schema>) {}

  async list(
    actor: AdminActor,
    query: AdminOrderListQuery,
  ): Promise<{ items: AdminOrderListItem[]; total: number; page: number }> {
    assertOwnerActor(actor);
    const page =
      Number.isInteger(query.page) && query.page > 0 ? query.page : 1;
    const filters = this.buildFilters(query);

    const [totalRow] = await this.database
      .select({ total: count() })
      .from(schema.orders)
      .where(filters);
    const rows = await this.database
      .select({
        publicReference: schema.orders.publicReference,
        status: schema.orders.status,
        createdAt: schema.orders.createdAt,
        itemsSubtotalAgorot: schema.orders.itemsSubtotalAgorot,
        deliveryFeeAgorot: schema.orders.deliveryFeeAgorot,
        finalTotalAgorot: schema.orders.finalTotalAgorot,
      })
      .from(schema.orders)
      .where(filters)
      .orderBy(
        desc(schema.orders.createdAt),
        desc(schema.orders.publicReference),
      )
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE);

    return {
      items: rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      })),
      total: totalRow?.total ?? 0,
      page,
    };
  }

  async getByPublicReference(
    actor: AdminActor,
    publicReference: string,
  ): Promise<AdminOrderDetail | null> {
    assertOwnerActor(actor);
    if (!PUBLIC_REFERENCE_PATTERN.test(publicReference)) return null;

    const [order] = await this.database
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.publicReference, publicReference))
      .limit(1);
    if (!order) return null;

    const [items, history] = await Promise.all([
      this.database
        .select()
        .from(schema.orderItems)
        .where(eq(schema.orderItems.orderId, order.id))
        .orderBy(asc(schema.orderItems.productDomainId)),
      this.database
        .select({
          previousStatus: schema.orderStatusHistory.previousStatus,
          newStatus: schema.orderStatusHistory.newStatus,
          reason: schema.orderStatusHistory.reason,
          createdAt: schema.orderStatusHistory.createdAt,
          actorName: schema.adminUsers.displayName,
        })
        .from(schema.orderStatusHistory)
        .innerJoin(
          schema.adminUsers,
          eq(schema.orderStatusHistory.adminUserId, schema.adminUsers.id),
        )
        .where(eq(schema.orderStatusHistory.orderId, order.id))
        .orderBy(
          asc(schema.orderStatusHistory.createdAt),
          asc(schema.orderStatusHistory.id),
        ),
    ]);

    const customerName = order.customerFullName ?? order.customerName;
    const deliveryAddress = order.deliveryAddress ?? order.address;
    const whatsappPhoneE164 =
      order.whatsappPhoneE164 ??
      (isSupportedWhatsAppE164(order.normalizedPhone)
        ? order.normalizedPhone
        : null);

    return {
      publicReference: order.publicReference,
      status: order.status,
      version: order.version,
      customerName,
      phone: whatsappPhoneE164
        ? formatWhatsAppDisplay(whatsappPhoneE164)
        : order.normalizedPhone,
      address: deliveryAddress,
      landmark: order.landmark,
      customerNote: order.customerNote,
      whatsappPhoneE164,
      whatsappContactUrl: whatsappPhoneE164
        ? buildWhatsAppContactUrl(whatsappPhoneE164, order.publicReference)
        : null,
      serviceAreaCode: order.serviceAreaCodeSnapshot,
      serviceAreaName: order.serviceAreaNameSnapshot,
      items: items.map((item) => ({
        productId: item.productDomainId,
        productName: item.productNameSnapshot,
        quantity: item.quantity,
        unitPriceAgorot: item.unitPriceAgorot,
        lineSubtotalAgorot: item.lineSubtotalAgorot,
      })),
      itemsSubtotalAgorot: order.itemsSubtotalAgorot,
      deliveryFeeAgorot: order.deliveryFeeAgorot,
      finalTotalAgorot: order.finalTotalAgorot,
      paymentMethod: order.paymentMethod,
      createdAt: order.createdAt.toISOString(),
      history: history.map((entry) => ({
        ...entry,
        createdAt: entry.createdAt.toISOString(),
      })),
    };
  }

  async changeStatus(
    actor: AdminActor,
    input: {
      publicReference: string;
      nextStatus: OrderStatus;
      expectedVersion: number;
      reason?: string;
    },
  ): Promise<AdminOrderDetail> {
    assertOwnerActor(actor);
    if (!PUBLIC_REFERENCE_PATTERN.test(input.publicReference)) {
      throw new AdminOrderError("invalid_input");
    }
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new AdminOrderError("invalid_input");
    }
    const reason = input.reason?.trim() ?? "";
    if (reason.length > 180) throw new AdminOrderError("invalid_input");

    await this.database.transaction(async (transaction) => {
      const [order] = await transaction
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.publicReference, input.publicReference))
        .for("update");
      if (!order) throw new AdminOrderError("not_found");
      if (order.version !== input.expectedVersion) {
        throw new AdminOrderError("concurrency_conflict");
      }
      if (!canTransitionOrderStatus(order.status, input.nextStatus)) {
        throw new AdminOrderError("invalid_transition");
      }

      const now = new Date();
      const [updated] = await transaction
        .update(schema.orders)
        .set({
          status: input.nextStatus,
          version: order.version + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.orders.id, order.id),
            eq(schema.orders.version, order.version),
            eq(schema.orders.status, order.status),
          ),
        )
        .returning({ id: schema.orders.id });
      if (!updated) throw new AdminOrderError("concurrency_conflict");

      await transaction.insert(schema.orderStatusHistory).values({
        orderId: order.id,
        previousStatus: order.status,
        newStatus: input.nextStatus,
        adminUserId: actor.id,
        reason: reason || null,
        createdAt: now,
      });

      const beforeState = redactOrderStatusAuditState(order);
      const afterState = redactOrderStatusAuditState({
        publicReference: order.publicReference,
        status: input.nextStatus,
        version: order.version + 1,
      });
      assertSafeAuditState(beforeState);
      assertSafeAuditState(afterState);
      await transaction.insert(schema.adminAuditEvents).values({
        adminUserId: actor.id,
        actionType: "order_status_change",
        entityType: "order",
        entityId: order.publicReference,
        beforeState,
        afterState,
        createdAt: now,
      });
    });

    const detail = await this.getByPublicReference(
      actor,
      input.publicReference,
    );
    if (!detail) throw new AdminOrderError("not_found");
    return detail;
  }

  private buildFilters(query: AdminOrderListQuery) {
    const conditions = [];
    if (query.status && isOrderStatus(query.status)) {
      conditions.push(eq(schema.orders.status, query.status));
    }
    if (query.createdFrom) {
      conditions.push(gte(schema.orders.createdAt, query.createdFrom));
    }
    if (query.createdTo) {
      conditions.push(lte(schema.orders.createdAt, query.createdTo));
    }
    if (query.publicReference) {
      const reference = query.publicReference.trim();
      if (PUBLIC_REFERENCE_PATTERN.test(reference)) {
        conditions.push(eq(schema.orders.publicReference, reference));
      } else {
        conditions.push(sql`false`);
      }
    }
    if (query.phone) {
      const phone = normalizePalestinianPhone(query.phone);
      if (phone) {
        conditions.push(
          or(
            eq(schema.orders.normalizedPhone, phone),
            eq(schema.orders.whatsappPhoneE164, phone),
          ),
        );
      } else {
        conditions.push(sql`false`);
      }
    }
    return conditions.length ? and(...conditions) : undefined;
  }
}
