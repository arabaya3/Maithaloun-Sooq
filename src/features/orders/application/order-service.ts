import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { calculateLineSubtotal } from "@/features/cart/cart-store";
import { getProductDisplayName } from "@/features/catalog/domain/product";
import {
  formatVariantAttributes,
  variantAttributesSchema,
} from "@/features/catalog/domain/product-variant";
import {
  ACTIVE_SERVICE_AREA_CODE,
  calculateDeliveryFeeAgorot,
} from "@/features/delivery/delivery-policy";
import type { CheckoutRequest } from "@/features/orders/domain/checkout-request";
import type { OrderConfirmation } from "@/features/orders/domain/order-confirmation";
import { priceSellingUnit } from "@/features/catalog/domain/offer-pricing";
import { liveOffersForVariants } from "@/features/catalog/infrastructure/offer-queries";
import {
  loadVariantCommerce,
  singlePiecePrice,
} from "@/features/catalog/infrastructure/variant-commerce";
import { unitsToMilli } from "@/features/inventory/domain/quantity";
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
  | "database_error";

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
    options: { test?: boolean; allowQaProbe?: boolean } = {},
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

        const requestedVariantIds = request.items.map((item) => item.variantId);
        const variantRows = await transaction
          .select({
            variant: schema.productVariants,
            product: schema.products,
          })
          .from(schema.productVariants)
          .innerJoin(
            schema.products,
            eq(schema.productVariants.productId, schema.products.id),
          )
          .where(inArray(schema.productVariants.domainId, requestedVariantIds));

        const variantsById = new Map(
          variantRows.map((row) => [row.variant.domainId, row]),
        );
        if (variantsById.size !== new Set(requestedVariantIds).size) {
          throw new OrderCreationError("unknown_product");
        }

        // Selling units, free stock and offers are all read again here: the client supplies only
        // identifiers and counts, and the server prices and checks the order at this moment.
        const commerce = await loadVariantCommerce(
          transaction,
          variantRows.map((row) => row.variant.id),
        );
        const offers = await liveOffersForVariants(
          transaction,
          variantRows.map((row) => ({
            variantId: row.variant.id,
            productId: row.product.id,
            categoryCode: row.product.categoryId,
            priceAgorot: singlePiecePrice(row.variant, commerce),
          })),
          new Date(),
        );

        const resolvedItems = request.items.map((item) => {
          const row = variantsById.get(item.variantId);
          if (!row) throw new OrderCreationError("unknown_product");
          if (row.product.domainId !== item.productId) {
            throw new OrderCreationError("unknown_product");
          }
          const qaProbe = allowQaProbe && row.variant.qaOwned;
          if (
            (row.variant.qaOwned && !qaProbe) ||
            row.variant.availability !== "available" ||
            row.variant.archivedAt ||
            row.product.archivedAt ||
            (row.product.publication !== "published" && !qaProbe)
          ) {
            throw new OrderCreationError("unavailable_product");
          }
          const units = (commerce.get(row.variant.id)?.units ?? []).filter(
            (unit) => !unit.archivedAt,
          );
          // A request without a unit comes from a client that bought single pieces only.
          const unit = item.sellingUnitId
            ? units.find((entry) => entry.id === item.sellingUnitId)
            : units.find((entry) => entry.unitsPerSale === 1);
          if (
            !unit ||
            (item.unitsPerSale !== undefined &&
              item.unitsPerSale !== unit.unitsPerSale)
          ) {
            throw new OrderCreationError("selling_unit_changed");
          }
          const attributes = variantAttributesSchema.parse(
            row.variant.attributes ?? {},
          );
          const priced = priceSellingUnit(
            unit,
            offers.get(row.variant.id),
            item.quantity,
          );
          const lineSubtotalAgorot = calculateLineSubtotal(
            priced.unitPriceAgorot,
            item.quantity,
          );
          return {
            ...item,
            product: row.product,
            variant: row.variant,
            unit,
            attributes,
            priced,
            lineSubtotalAgorot,
          };
        });

        // Packs and singles of one variant draw on the same base stock, so they are checked together.
        const requiredMilli = new Map<string, number>();
        for (const item of resolvedItems) {
          requiredMilli.set(
            item.variant.id,
            (requiredMilli.get(item.variant.id) ?? 0) +
              unitsToMilli(item.quantity * item.unit.unitsPerSale),
          );
        }
        for (const [variantId, milli] of requiredMilli) {
          const free = commerce.get(variantId)?.freeBaseMilli ?? null;
          if (free !== null && milli > free) {
            throw new OrderCreationError("insufficient_stock");
          }
        }

        const itemsSubtotalAgorot = resolvedItems.reduce(
          (total, item) => total + item.lineSubtotalAgorot,
          0,
        );
        const deliveryFeeAgorot =
          calculateDeliveryFeeAgorot(itemsSubtotalAgorot);
        const finalTotalAgorot = itemsSubtotalAgorot + deliveryFeeAgorot;

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
            address: request.deliveryAddress,
            deliveryAddress: request.deliveryAddress,
            landmark: null,
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
