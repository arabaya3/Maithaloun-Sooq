import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { calculateLineSubtotal } from "@/features/cart/cart-store";
import { getProductDisplayName } from "@/features/catalog/domain/product";
import { mapProductRow } from "@/features/catalog/infrastructure/product-row-mapper";
import type { CheckoutRequest } from "@/features/orders/domain/checkout-request";
import type { OrderConfirmation } from "@/features/orders/domain/order-confirmation";
import * as schema from "@/server/db/schema";

import {
  createOrderRequestFingerprint,
  generatePublicOrderReference,
} from "./order-identifiers";

export type OrderCreationErrorCode =
  | "unknown_product"
  | "unavailable_product"
  | "invalid_service_area"
  | "idempotency_conflict"
  | "database_error";

export class OrderCreationError extends Error {
  constructor(readonly code: OrderCreationErrorCode) {
    super(code);
    this.name = "OrderCreationError";
  }
}

export class OrderService {
  constructor(private readonly database: PostgresJsDatabase<typeof schema>) {}

  async create(request: CheckoutRequest): Promise<OrderConfirmation> {
    const requestFingerprint = createOrderRequestFingerprint(request);

    try {
      return await this.database.transaction(async (transaction) => {
        const existing = await this.findByIdempotencyKey(
          transaction,
          request.idempotencyKey,
        );
        if (existing) {
          return this.resolveExisting(existing, requestFingerprint);
        }

        const requestedIds = request.items.map((item) => item.productId);
        const productRows = await transaction
          .select()
          .from(schema.products)
          .where(inArray(schema.products.domainId, requestedIds));
        const productsById = new Map(
          productRows.map((product) => [product.domainId, product]),
        );
        if (productsById.size !== requestedIds.length) {
          throw new OrderCreationError("unknown_product");
        }

        const resolvedItems = request.items.map((item) => {
          const product = productsById.get(item.productId);
          if (!product) throw new OrderCreationError("unknown_product");
          if (product.availability !== "available") {
            throw new OrderCreationError("unavailable_product");
          }
          const lineSubtotalAgorot = calculateLineSubtotal(
            product.priceAgorot,
            item.quantity,
          );
          return { ...item, product, lineSubtotalAgorot };
        });
        const itemsSubtotalAgorot = resolvedItems.reduce(
          (total, item) => total + item.lineSubtotalAgorot,
          0,
        );

        const [serviceArea] = await transaction
          .select()
          .from(schema.serviceAreas)
          .where(
            and(
              eq(schema.serviceAreas.code, request.serviceAreaCode),
              eq(schema.serviceAreas.enabled, true),
            ),
          )
          .limit(1);
        if (!serviceArea) {
          throw new OrderCreationError("invalid_service_area");
        }

        const finalTotalAgorot =
          serviceArea.deliveryFeeAgorot === null
            ? null
            : itemsSubtotalAgorot + serviceArea.deliveryFeeAgorot;
        const [createdOrder] = await transaction
          .insert(schema.orders)
          .values({
            publicReference: generatePublicOrderReference(),
            customerName: request.customerName,
            customerFullName: request.customerName,
            normalizedPhone: request.whatsappPhoneE164,
            whatsappPhoneE164: request.whatsappPhoneE164,
            serviceAreaId: serviceArea.id,
            serviceAreaCodeSnapshot: serviceArea.code,
            serviceAreaNameSnapshot: serviceArea.nameAr,
            address: request.deliveryAddress,
            deliveryAddress: request.deliveryAddress,
            landmark: null,
            customerNote: request.customerNote,
            itemsSubtotalAgorot,
            deliveryFeeAgorot: serviceArea.deliveryFeeAgorot,
            finalTotalAgorot,
            idempotencyKey: request.idempotencyKey,
            requestFingerprint,
          })
          .onConflictDoNothing({ target: schema.orders.idempotencyKey })
          .returning();

        if (!createdOrder) {
          const concurrent = await this.findByIdempotencyKey(
            transaction,
            request.idempotencyKey,
          );
          if (!concurrent) throw new OrderCreationError("database_error");
          return this.resolveExisting(concurrent, requestFingerprint);
        }

        await transaction.insert(schema.orderItems).values(
          resolvedItems.map((item) => ({
            orderId: createdOrder.id,
            productDomainId: item.product.domainId,
            productNameSnapshot: getProductDisplayName(
              mapProductRow(item.product),
            ),
            unitPriceAgorot: item.product.priceAgorot,
            quantity: item.quantity,
            lineSubtotalAgorot: item.lineSubtotalAgorot,
          })),
        );

        return this.toConfirmation(createdOrder, false);
      });
    } catch (error) {
      if (error instanceof OrderCreationError) throw error;
      throw new OrderCreationError("database_error");
    }
  }

  async getConfirmation(
    publicReference: string,
  ): Promise<OrderConfirmation | null> {
    if (!/^MS-[A-Za-z0-9_-]{24}$/.test(publicReference)) return null;
    const [order] = await this.database
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.publicReference, publicReference))
      .limit(1);
    return order ? this.toConfirmation(order, false) : null;
  }

  private async findByIdempotencyKey(
    database: Pick<PostgresJsDatabase<typeof schema>, "select">,
    idempotencyKey: string,
  ) {
    const [order] = await database
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.idempotencyKey, idempotencyKey))
      .limit(1);
    return order ?? null;
  }

  private resolveExisting(
    order: typeof schema.orders.$inferSelect,
    requestFingerprint: string,
  ): OrderConfirmation {
    if (order.requestFingerprint !== requestFingerprint) {
      throw new OrderCreationError("idempotency_conflict");
    }
    return this.toConfirmation(order, true);
  }

  private toConfirmation(
    order: typeof schema.orders.$inferSelect,
    duplicate: boolean,
  ): OrderConfirmation {
    return {
      publicReference: order.publicReference,
      status: order.status,
      itemsSubtotalAgorot: order.itemsSubtotalAgorot,
      deliveryFeeAgorot: order.deliveryFeeAgorot,
      finalTotalAgorot: order.finalTotalAgorot,
      paymentMethod: order.paymentMethod,
      duplicate,
    };
  }
}
