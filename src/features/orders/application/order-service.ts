import "server-only";

import { and, asc, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { getProductDisplayName } from "@/features/catalog/domain/product";
import { formatVariantAttributes } from "@/features/catalog/domain/product-variant";
import { ACTIVE_SERVICE_AREA_CODE } from "@/features/delivery/delivery-policy";
import type { CheckoutRequest } from "@/features/orders/domain/checkout-request";
import type { OrderConfirmation } from "@/features/orders/domain/order-confirmation";
import {
  CartPricingError,
  priceCart,
} from "@/features/orders/application/cart-pricing";
import { StoreContactService } from "@/features/orders/application/store-contact-service";
import { orderLineSnapshots } from "@/features/orders/infrastructure/order-line-snapshots";
import * as schema from "@/server/db/schema";

import {
  createOrderRequestFingerprint,
  generatePublicOrderReference,
} from "./order-identifiers";

export type OrderCreationErrorCode =
  | "unknown_product"
  | "unavailable_product"
  | "selling_unit_changed"
  | "insufficient_stock"
  | "invalid_service_area"
  | "idempotency_conflict"
  | "whatsapp_unavailable"
  | "database_error";

export interface ConfirmationLine {
  name: string;
  options: string | null;
  unit: string | null;
  quantity: number;
  unitPriceAgorot: number;
  lineSubtotalAgorot: number;
  image: { src: string; alt: string } | null;
}

export interface ConfirmationDetails {
  channel: "web" | "whatsapp";
  lines: ConfirmationLine[];
}

export class OrderCreationError extends Error {
  constructor(readonly code: OrderCreationErrorCode) {
    super(code);
    this.name = "OrderCreationError";
  }
}

// Stored instead of a phone on owner QA orders; the database allows it only when is_test is set.
export const QA_ORDER_PHONE = "qa-test";

export class OrderService {
  constructor(private readonly database: PostgresJsDatabase<typeof schema>) {}

  async create(
    request: CheckoutRequest,
    owner: { customerAccountId: string | null } = { customerAccountId: null },
    // Internal only: the public checkout route never passes these.
    // confirmedInChat: the customer already confirmed in the WhatsApp assistant, so the order skips
    // the "awaiting WhatsApp" step and arrives pending like a website order.
    options: {
      test?: boolean;
      allowQaProbe?: boolean;
      confirmedInChat?: boolean;
    } = {},
  ): Promise<OrderConfirmation> {
    const test = options.test === true;
    // The QA probe variant is orderable only by the owner stock simulation, never by checkout.
    const allowQaProbe = test && options.allowQaProbe === true;
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

        if (request.serviceAreaCode !== ACTIVE_SERVICE_AREA_CODE) {
          throw new OrderCreationError("invalid_service_area");
        }
        if (
          request.checkoutChannel === "whatsapp" &&
          !(await new StoreContactService(transaction).whatsAppNumber())
        ) {
          throw new OrderCreationError("whatsapp_unavailable");
        }

        // Prices, offers and stock come from the shared cart pricing, the same check every quote uses.
        let priced: Awaited<ReturnType<typeof priceCart>>;
        try {
          priced = await priceCart(transaction, request.items, {
            allowQaProbe,
          });
        } catch (error) {
          if (error instanceof CartPricingError) {
            throw new OrderCreationError(error.code);
          }
          throw error;
        }
        const resolvedItems = priced.lines;
        const { itemsSubtotalAgorot, deliveryFeeAgorot, finalTotalAgorot } =
          priced;

        const snapshots = await orderLineSnapshots(
          transaction,
          resolvedItems.map((item) => item.variant),
        );

        const [serviceArea] = await transaction
          .select()
          .from(schema.serviceAreas)
          .where(
            and(
              eq(schema.serviceAreas.code, ACTIVE_SERVICE_AREA_CODE),
              eq(schema.serviceAreas.enabled, true),
            ),
          )
          .limit(1);
        if (!serviceArea) {
          throw new OrderCreationError("invalid_service_area");
        }

        const [createdOrder] = await transaction
          .insert(schema.orders)
          .values({
            publicReference: generatePublicOrderReference(),
            customerName: request.customerName,
            customerFullName: request.customerName,
            normalizedPhone: test ? QA_ORDER_PHONE : request.whatsappPhoneE164,
            whatsappPhoneE164: test ? null : request.whatsappPhoneE164,
            isTest: test,
            serviceAreaId: serviceArea.id,
            serviceAreaCodeSnapshot: serviceArea.code,
            serviceAreaNameSnapshot: serviceArea.nameAr,
            address: request.deliveryAddress ?? null,
            deliveryAddress: request.deliveryAddress ?? null,
            landmark: request.landmark ?? null,
            checkoutChannel: request.checkoutChannel,
            status:
              request.checkoutChannel === "whatsapp" && !options.confirmedInChat
                ? "awaiting_whatsapp"
                : "pending",
            customerNote: request.customerNote,
            itemsSubtotalAgorot,
            deliveryFeeAgorot,
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
          resolvedItems.map((item) => {
            const attributeText = formatVariantAttributes(item.attributes);
            // Only the name is needed; a single non-default variant is not a whole product view.
            const displayName = getProductDisplayName({
              nameAr: item.product.nameAr,
              latinName: item.product.latinName ?? undefined,
            });
            const productNameSnapshot = attributeText
              ? `${displayName} — ${item.variant.labelAr}`
              : `${displayName} — ${item.variant.labelAr}`;

            return {
              orderId: createdOrder.id,
              productDomainId: item.product.domainId,
              variantDomainId: item.variant.domainId,
              productNameSnapshot,
              variantLabelSnapshot: item.variant.labelAr,
              variantAttributesSnapshot: item.attributes,
              imageSnapshot: snapshots.get(item.variant.id)?.image ?? null,
              optionValuesSnapshot:
                snapshots.get(item.variant.id)?.optionValues ?? null,
              variantSkuSnapshot: item.variant.sku,
              variantBarcodeSnapshot: item.variant.barcode,
              unitPriceAgorot: item.priced.unitPriceAgorot,
              listUnitPriceAgorot: item.priced.listUnitPriceAgorot,
              offerId: item.priced.offerId,
              quantity: item.quantity,
              lineSubtotalAgorot: item.lineSubtotalAgorot,
              sellingUnitId: item.unit.id,
              sellingUnitLabelSnapshot: item.unit.labelAr,
              sellingUnitSkuSnapshot: item.unit.sku,
              sellingUnitBarcodeSnapshot: item.unit.barcode,
              unitsPerSale: item.unit.unitsPerSale,
            };
          }),
        );

        if (owner.customerAccountId && !test) {
          await transaction.insert(schema.customerOrderLinks).values({
            orderId: createdOrder.id,
            accountId: owner.customerAccountId,
            source: "checkout",
          });
        }

        // QA orders must never reach the owner or staff as a real order.
        if (!test)
          await transaction.insert(schema.adminNotifications).values({
            type: "order_created",
            orderId: createdOrder.id,
            title: "طلب جديد",
            body: `وصل طلب جديد بقيمة ${(finalTotalAgorot / 100).toFixed(2)} ₪`,
            href: `/admin/orders/${createdOrder.publicReference}`,
          });

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

  /** The order lines as the customer bought them, from the snapshots; never names, phones or addresses. */
  async getConfirmationLines(
    publicReference: string,
  ): Promise<ConfirmationDetails | null> {
    if (!/^MS-[A-Za-z0-9_-]{24}$/.test(publicReference)) return null;
    const [order] = await this.database
      .select({
        id: schema.orders.id,
        checkoutChannel: schema.orders.checkoutChannel,
      })
      .from(schema.orders)
      .where(eq(schema.orders.publicReference, publicReference))
      .limit(1);
    if (!order) return null;
    const rows = await this.database
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, order.id))
      .orderBy(asc(schema.orderItems.productNameSnapshot));
    return {
      channel: order.checkoutChannel === "whatsapp" ? "whatsapp" : "web",
      lines: rows.map((row) => ({
        name: row.productNameSnapshot,
        options: row.optionValuesSnapshot?.length
          ? row.optionValuesSnapshot
              .map((entry) => `${entry.option}: ${entry.value}`)
              .join(" · ")
          : row.variantLabelSnapshot,
        unit: row.unitsPerSale > 1 ? row.sellingUnitLabelSnapshot : null,
        quantity: row.quantity,
        unitPriceAgorot: row.unitPriceAgorot,
        lineSubtotalAgorot: row.lineSubtotalAgorot,
        image: row.imageSnapshot ?? null,
      })),
    };
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
