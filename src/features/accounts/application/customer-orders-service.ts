import "server-only";

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type { Product } from "@/features/catalog/domain/product";
import { priceSellingUnit } from "@/features/catalog/domain/offer-pricing";
import { isVariantAvailable } from "@/features/catalog/domain/product-variant";
import { isSellingUnitPurchasable } from "@/features/catalog/domain/selling-unit";
import type { OrderStatus } from "@/features/orders/domain/order-status";
import * as schema from "@/server/db/schema";

type Database = PostgresJsDatabase<typeof schema>;

const HISTORY_LIMIT = 50;

export interface CustomerOrderSummary {
  publicReference: string;
  createdAt: Date;
  status: OrderStatus;
  finalTotalAgorot: number | null;
  itemsSubtotalAgorot: number;
  paymentMethod: "cash_on_delivery";
  items: {
    name: string;
    sellingLabel: string | null;
    quantity: number;
    lineSubtotalAgorot: number;
  }[];
}

export type ReorderLineStatus = "same" | "price_changed" | "unavailable";

export interface ReorderLine {
  productId: string;
  variantId: string | null;
  // The way it was bought; a line from before selling units is matched to the one-piece unit.
  sellingUnitId: string | null;
  unitsPerSale: number;
  sellingLabel: string | null;
  name: string;
  quantity: number;
  previousUnitPriceAgorot: number;
  currentUnitPriceAgorot: number | null;
  status: ReorderLineStatus;
}

export interface ReorderReview {
  lines: ReorderLine[];
  needsReview: boolean;
}

export class CustomerOrdersService {
  constructor(private readonly database: Database) {}

  async history(accountId: string): Promise<CustomerOrderSummary[]> {
    const rows = await this.database
      .select({
        id: schema.orders.id,
        publicReference: schema.orders.publicReference,
        createdAt: schema.orders.createdAt,
        status: schema.orders.status,
        finalTotalAgorot: schema.orders.finalTotalAgorot,
        itemsSubtotalAgorot: schema.orders.itemsSubtotalAgorot,
      })
      .from(schema.customerOrderLinks)
      .innerJoin(
        schema.orders,
        eq(schema.customerOrderLinks.orderId, schema.orders.id),
      )
      .where(
        and(
          eq(schema.customerOrderLinks.accountId, accountId),
          eq(schema.orders.isTest, false),
        ),
      )
      .orderBy(desc(schema.orders.createdAt))
      .limit(HISTORY_LIMIT);
    if (!rows.length) return [];
    const items = await this.database
      .select({
        orderId: schema.orderItems.orderId,
        name: schema.orderItems.productNameSnapshot,
        sellingLabel: schema.orderItems.sellingUnitLabelSnapshot,
        quantity: schema.orderItems.quantity,
        lineSubtotalAgorot: schema.orderItems.lineSubtotalAgorot,
      })
      .from(schema.orderItems)
      .where(
        inArray(
          schema.orderItems.orderId,
          rows.map((row) => row.id),
        ),
      );
    return rows.map(({ id, ...row }) => ({
      ...row,
      paymentMethod: "cash_on_delivery",
      items: items
        .filter((item) => item.orderId === id)
        .map((item) => ({
          name: item.name,
          sellingLabel: item.sellingLabel,
          quantity: item.quantity,
          lineSubtotalAgorot: item.lineSubtotalAgorot,
        })),
    }));
  }

  private claimableWhere(phoneE164: string) {
    return and(
      eq(schema.orders.normalizedPhone, phoneE164),
      eq(schema.orders.isTest, false),
      isNull(schema.customerOrderLinks.orderId),
    );
  }

  async claimableCount(phoneE164: string): Promise<number> {
    const [row] = await this.database
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.orders)
      .leftJoin(
        schema.customerOrderLinks,
        eq(schema.customerOrderLinks.orderId, schema.orders.id),
      )
      .where(this.claimableWhere(phoneE164));
    return row?.total ?? 0;
  }

  // Only orders placed with the account's own verified phone, and never one already owned.
  async claim(accountId: string, verifiedPhoneE164: string): Promise<number> {
    return this.database.transaction(async (transaction) => {
      const [account] = await transaction
        .select({ phone: schema.customerAccounts.phoneE164 })
        .from(schema.customerAccounts)
        .where(
          and(
            eq(schema.customerAccounts.id, accountId),
            isNull(schema.customerAccounts.deletedAt),
          ),
        )
        .for("update");
      if (!account || account.phone !== verifiedPhoneE164) return 0;
      const claimable = await transaction
        .select({ id: schema.orders.id })
        .from(schema.orders)
        .leftJoin(
          schema.customerOrderLinks,
          eq(schema.customerOrderLinks.orderId, schema.orders.id),
        )
        .where(this.claimableWhere(verifiedPhoneE164));
      if (!claimable.length) return 0;
      const linked = await transaction
        .insert(schema.customerOrderLinks)
        .values(
          claimable.map((order) => ({
            orderId: order.id,
            accountId,
            source: "claim" as const,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: schema.customerOrderLinks.orderId });
      if (linked.length) {
        await transaction.insert(schema.customerAccountEvents).values({
          accountId,
          type: "orders_claimed",
          detail: { orders: linked.length },
        });
      }
      return linked.length;
    });
  }

  async reorderReview(
    accountId: string,
    publicReference: string,
    catalog: readonly Product[],
  ): Promise<ReorderReview | null> {
    const [order] = await this.database
      .select({ id: schema.orders.id })
      .from(schema.customerOrderLinks)
      .innerJoin(
        schema.orders,
        eq(schema.customerOrderLinks.orderId, schema.orders.id),
      )
      .where(
        and(
          eq(schema.customerOrderLinks.accountId, accountId),
          eq(schema.orders.publicReference, publicReference),
          eq(schema.orders.isTest, false),
        ),
      );
    if (!order) return null;
    const items = await this.database
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, order.id));
    const products = new Map(catalog.map((product) => [product.id, product]));
    const lines = items.map((item): ReorderLine => {
      const variant = products
        .get(item.productDomainId)
        ?.variants.find((entry) => entry.id === item.variantDomainId);
      const unit = variant?.sellingUnits.find((entry) =>
        item.sellingUnitId
          ? entry.id === item.sellingUnitId &&
            entry.unitsPerSale === item.unitsPerSale
          : entry.unitsPerSale === 1,
      );
      const base = {
        productId: item.productDomainId,
        variantId: item.variantDomainId,
        sellingUnitId: unit?.id ?? item.sellingUnitId,
        unitsPerSale: item.unitsPerSale,
        sellingLabel: item.sellingUnitLabelSnapshot,
        name: item.productNameSnapshot,
        quantity: item.quantity,
        previousUnitPriceAgorot: item.unitPriceAgorot,
      };
      if (
        !variant ||
        !unit ||
        !isVariantAvailable(variant) ||
        !isSellingUnitPurchasable(unit) ||
        unit.maxQuantity < item.quantity
      ) {
        return { ...base, currentUnitPriceAgorot: null, status: "unavailable" };
      }
      const current = priceSellingUnit(
        unit,
        variant.offer,
        item.quantity,
      ).unitPriceAgorot;
      return {
        ...base,
        currentUnitPriceAgorot: current,
        status: current === item.unitPriceAgorot ? "same" : "price_changed",
      };
    });
    return { lines, needsReview: lines.some((line) => line.status !== "same") };
  }
}
