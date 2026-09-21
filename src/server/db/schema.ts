import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import {
  placeholderKinds,
  productAvailabilityValues,
  productCategoryIds,
  productDetailsStatusValues,
} from "@/features/catalog/domain/product";
import { MAX_CART_QUANTITY } from "@/features/cart/cart-store";

export const productCategoryEnum = pgEnum(
  "product_category",
  productCategoryIds,
);
export const productAvailabilityEnum = pgEnum(
  "product_availability",
  productAvailabilityValues,
);
export const productDetailsStatusEnum = pgEnum(
  "product_details_status",
  productDetailsStatusValues,
);
export const productImageKindEnum = pgEnum("product_image_kind", [
  "placeholder",
  "image",
]);
export const placeholderVariantEnum = pgEnum(
  "placeholder_variant",
  placeholderKinds,
);
export const orderStatusEnum = pgEnum("order_status", ["pending"]);
export const paymentMethodEnum = pgEnum("payment_method", ["cash_on_delivery"]);

const timestamps = {
  createdAt: timestamp("created_at", {
    withTimezone: true,
    mode: "date",
  })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", {
    withTimezone: true,
    mode: "date",
  })
    .defaultNow()
    .notNull(),
};

export const products = pgTable(
  "products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    domainId: varchar("domain_id", { length: 80 }).notNull().unique(),
    slug: varchar("slug", { length: 120 }).notNull().unique(),
    nameAr: varchar("name_ar", { length: 160 }).notNull(),
    latinName: varchar("latin_name", { length: 120 }),
    priceAgorot: integer("price_agorot").notNull(),
    sortOrder: integer("sort_order").notNull(),
    categoryId: productCategoryEnum("category_id").notNull(),
    availability: productAvailabilityEnum("availability").notNull(),
    imageKind: productImageKindEnum("image_kind").notNull(),
    imageSrc: varchar("image_src", { length: 500 }),
    imageAlt: varchar("image_alt", { length: 250 }),
    imageWidth: integer("image_width"),
    imageHeight: integer("image_height"),
    placeholderVariant: placeholderVariantEnum("placeholder_variant"),
    description: text("description"),
    usageNotes: text("usage_notes"),
    unit: varchar("unit", { length: 80 }),
    detailsStatus: productDetailsStatusEnum("details_status").notNull(),
    ...timestamps,
  },
  (table) => [
    check("products_positive_price", sql`${table.priceAgorot} > 0`),
    check("products_non_negative_sort", sql`${table.sortOrder} >= 0`),
    check(
      "products_valid_image",
      sql`(
        (${table.imageKind} = 'placeholder'
          AND ${table.placeholderVariant} IS NOT NULL
          AND ${table.imageSrc} IS NULL
          AND ${table.imageAlt} IS NULL
          AND ${table.imageWidth} IS NULL
          AND ${table.imageHeight} IS NULL)
        OR
        (${table.imageKind} = 'image'
          AND ${table.placeholderVariant} IS NULL
          AND ${table.imageSrc} IS NOT NULL
          AND ${table.imageAlt} IS NOT NULL
          AND ${table.imageWidth} > 0
          AND ${table.imageHeight} > 0)
      )`,
    ),
  ],
);

export const serviceAreas = pgTable(
  "service_areas",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: varchar("code", { length: 80 }).notNull().unique(),
    nameAr: varchar("name_ar", { length: 120 }).notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    sortOrder: integer("sort_order").notNull(),
    deliveryFeeAgorot: integer("delivery_fee_agorot"),
    ...timestamps,
  },
  (table) => [
    check("service_areas_non_negative_sort", sql`${table.sortOrder} >= 0`),
    check(
      "service_areas_non_negative_fee",
      sql`${table.deliveryFeeAgorot} IS NULL OR ${table.deliveryFeeAgorot} >= 0`,
    ),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    publicReference: varchar("public_reference", { length: 40 })
      .notNull()
      .unique(),
    status: orderStatusEnum("status").default("pending").notNull(),
    customerName: varchar("customer_name", { length: 100 }).notNull(),
    normalizedPhone: varchar("normalized_phone", { length: 20 }).notNull(),
    serviceAreaId: uuid("service_area_id")
      .notNull()
      .references(() => serviceAreas.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    serviceAreaCodeSnapshot: varchar("service_area_code_snapshot", {
      length: 80,
    }).notNull(),
    serviceAreaNameSnapshot: varchar("service_area_name_snapshot", {
      length: 120,
    }).notNull(),
    address: varchar("address", { length: 500 }).notNull(),
    landmark: varchar("landmark", { length: 150 }),
    customerNote: varchar("customer_note", { length: 500 }),
    itemsSubtotalAgorot: integer("items_subtotal_agorot").notNull(),
    deliveryFeeAgorot: integer("delivery_fee_agorot"),
    finalTotalAgorot: integer("final_total_agorot"),
    paymentMethod: paymentMethodEnum("payment_method")
      .default("cash_on_delivery")
      .notNull(),
    idempotencyKey: uuid("idempotency_key").notNull().unique(),
    requestFingerprint: varchar("request_fingerprint", {
      length: 64,
    }).notNull(),
    ...timestamps,
  },
  (table) => [
    check(
      "orders_non_negative_items_subtotal",
      sql`${table.itemsSubtotalAgorot} >= 0`,
    ),
    check(
      "orders_non_negative_delivery_fee",
      sql`${table.deliveryFeeAgorot} IS NULL OR ${table.deliveryFeeAgorot} >= 0`,
    ),
    check(
      "orders_valid_final_total",
      sql`(
        (${table.deliveryFeeAgorot} IS NULL AND ${table.finalTotalAgorot} IS NULL)
        OR
        (${table.deliveryFeeAgorot} IS NOT NULL
          AND ${table.finalTotalAgorot} = ${table.itemsSubtotalAgorot} + ${table.deliveryFeeAgorot})
      )`,
    ),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productDomainId: varchar("product_domain_id", { length: 80 })
      .notNull()
      .references(() => products.domainId, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    productNameSnapshot: varchar("product_name_snapshot", {
      length: 280,
    }).notNull(),
    unitPriceAgorot: integer("unit_price_agorot").notNull(),
    quantity: integer("quantity").notNull(),
    lineSubtotalAgorot: integer("line_subtotal_agorot").notNull(),
  },
  (table) => [
    unique("order_items_order_product_unique").on(
      table.orderId,
      table.productDomainId,
    ),
    check(
      "order_items_quantity_bounds",
      sql`${table.quantity} BETWEEN 1 AND ${sql.raw(String(MAX_CART_QUANTITY))}`,
    ),
    check("order_items_non_negative_price", sql`${table.unitPriceAgorot} >= 0`),
    check(
      "order_items_valid_subtotal",
      sql`${table.lineSubtotalAgorot} = ${table.unitPriceAgorot} * ${table.quantity}`,
    ),
  ],
);
