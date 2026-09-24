import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { adminRoles } from "@/features/admin/domain/admin-actor";
import { MAX_CART_QUANTITY } from "@/features/cart/cart-store";
import {
  placeholderKinds,
  productAvailabilityValues,
  productCategoryIds,
  productDetailsStatusValues,
} from "@/features/catalog/domain/product-constants";
import { orderStatuses } from "@/features/orders/domain/order-status";

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
export const orderStatusEnum = pgEnum("order_status", orderStatuses);
export const paymentMethodEnum = pgEnum("payment_method", ["cash_on_delivery"]);
export const adminRoleEnum = pgEnum("admin_role", adminRoles);

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

export const productVariants = pgTable(
  "product_variants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    domainId: varchar("domain_id", { length: 100 }).notNull().unique(),
    labelAr: varchar("label_ar", { length: 120 }).notNull(),
    attributes: jsonb("attributes")
      .$type<Record<string, string>>()
      .default({})
      .notNull(),
    priceAgorot: integer("price_agorot").notNull(),
    availability: productAvailabilityEnum("availability").notNull(),
    imageKind: productImageKindEnum("image_kind").notNull(),
    imageSrc: varchar("image_src", { length: 500 }),
    imageAlt: varchar("image_alt", { length: 250 }),
    imageWidth: integer("image_width"),
    imageHeight: integer("image_height"),
    placeholderVariant: placeholderVariantEnum("placeholder_variant"),
    sku: varchar("sku", { length: 64 }),
    barcode: varchar("barcode", { length: 64 }),
    sortOrder: integer("sort_order").notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    ...timestamps,
  },
  (table) => [
    index("product_variants_product_id_idx").on(table.productId),
    uniqueIndex("product_variants_product_sort_uidx").on(
      table.productId,
      table.sortOrder,
    ),
    uniqueIndex("product_variants_one_default_uidx")
      .on(table.productId)
      .where(sql`${table.isDefault} = true`),
    check(
      "product_variants_non_negative_price",
      sql`${table.priceAgorot} >= 0`,
    ),
    check("product_variants_non_negative_sort", sql`${table.sortOrder} >= 0`),
    check(
      "product_variants_valid_image",
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
    check(
      "product_variants_attributes_object",
      sql`jsonb_typeof(${table.attributes}) = 'object'`,
    ),
  ],
);

export const productSpecifications = pgTable(
  "product_specifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    labelAr: varchar("label_ar", { length: 80 }).notNull(),
    valueAr: varchar("value_ar", { length: 200 }).notNull(),
    sortOrder: integer("sort_order").notNull(),
    ...timestamps,
  },
  (table) => [
    index("product_specifications_product_id_idx").on(table.productId),
    uniqueIndex("product_specifications_product_sort_uidx").on(
      table.productId,
      table.sortOrder,
    ),
    check(
      "product_specifications_non_negative_sort",
      sql`${table.sortOrder} >= 0`,
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
    customerFullName: varchar("customer_full_name", { length: 100 }),
    normalizedPhone: varchar("normalized_phone", { length: 20 }).notNull(),
    whatsappPhoneE164: varchar("whatsapp_phone_e164", { length: 20 }),
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
    deliveryAddress: varchar("delivery_address", { length: 500 }),
    landmark: varchar("landmark", { length: 150 }),
    customerNote: varchar("customer_note", { length: 500 }),
    itemsSubtotalAgorot: integer("items_subtotal_agorot").notNull(),
    deliveryFeeAgorot: integer("delivery_fee_agorot"),
    finalTotalAgorot: integer("final_total_agorot"),
    paymentMethod: paymentMethodEnum("payment_method")
      .default("cash_on_delivery")
      .notNull(),
    version: integer("version").default(1).notNull(),
    idempotencyKey: uuid("idempotency_key").notNull().unique(),
    requestFingerprint: varchar("request_fingerprint", {
      length: 64,
    }).notNull(),
    ...timestamps,
  },
  (table) => [
    index("orders_status_created_at_idx").on(table.status, table.createdAt),
    index("orders_created_at_idx").on(table.createdAt),
    index("orders_normalized_phone_idx").on(table.normalizedPhone),
    index("orders_whatsapp_phone_e164_idx").on(table.whatsappPhoneE164),
    check("orders_positive_version", sql`${table.version} > 0`),
    check(
      "orders_customer_full_name_length",
      sql`${table.customerFullName} IS NULL OR (
        char_length(btrim(${table.customerFullName})) BETWEEN 2 AND 100
      )`,
    ),
    check(
      "orders_delivery_address_length",
      sql`${table.deliveryAddress} IS NULL OR (
        char_length(btrim(${table.deliveryAddress})) BETWEEN 8 AND 500
      )`,
    ),
    check(
      "orders_whatsapp_phone_e164_format",
      sql`${table.whatsappPhoneE164} IS NULL OR (
        ${table.whatsappPhoneE164} ~ '^\\+(970|972)5[0-9]{8}$'
      )`,
    ),
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
    variantDomainId: varchar("variant_domain_id", { length: 100 }),
    productNameSnapshot: varchar("product_name_snapshot", {
      length: 280,
    }).notNull(),
    variantLabelSnapshot: varchar("variant_label_snapshot", { length: 120 }),
    variantAttributesSnapshot: jsonb(
      "variant_attributes_snapshot",
    ).$type<Record<string, string> | null>(),
    variantSkuSnapshot: varchar("variant_sku_snapshot", { length: 64 }),
    variantBarcodeSnapshot: varchar("variant_barcode_snapshot", {
      length: 64,
    }),
    unitPriceAgorot: integer("unit_price_agorot").notNull(),
    quantity: integer("quantity").notNull(),
    lineSubtotalAgorot: integer("line_subtotal_agorot").notNull(),
  },
  (table) => [
    uniqueIndex("order_items_order_variant_uidx")
      .on(table.orderId, table.variantDomainId)
      .where(sql`${table.variantDomainId} IS NOT NULL`),
    index("order_items_variant_domain_id_idx").on(table.variantDomainId),
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

export const adminUsers = pgTable(
  "admin_users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    username: varchar("username", { length: 32 }).notNull().unique(),
    displayName: varchar("display_name", { length: 80 }).notNull(),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    role: adminRoleEnum("role").notNull(),
    active: boolean("active").default(true).notNull(),
    passwordChangedAt: timestamp("password_changed_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("admin_users_single_owner_idx")
      .on(table.role)
      .where(sql`${table.role} = 'owner'`),
  ],
);

export const adminSessions = pgTable(
  "admin_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    adminUserId: uuid("admin_user_id")
      .notNull()
      .references(() => adminUsers.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    lastUsedAt: timestamp("last_used_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
    revokedAt: timestamp("revoked_at", {
      withTimezone: true,
      mode: "date",
    }),
  },
  (table) => [index("admin_sessions_admin_user_id_idx").on(table.adminUserId)],
);

export const rateLimitBuckets = pgTable(
  "rate_limit_buckets",
  {
    scope: varchar("scope", { length: 40 }).notNull(),
    keyHash: varchar("key_hash", { length: 64 }).notNull(),
    count: integer("count").notNull(),
    windowStartedAt: timestamp("window_started_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    blockedUntil: timestamp("blocked_until", {
      withTimezone: true,
      mode: "date",
    }),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scope, table.keyHash] }),
    check("rate_limit_buckets_non_negative_count", sql`${table.count} >= 0`),
  ],
);

export const orderStatusHistory = pgTable(
  "order_status_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    previousStatus: orderStatusEnum("previous_status").notNull(),
    newStatus: orderStatusEnum("new_status").notNull(),
    adminUserId: uuid("admin_user_id")
      .notNull()
      .references(() => adminUsers.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    reason: varchar("reason", { length: 180 }),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("order_status_history_order_created_idx").on(
      table.orderId,
      table.createdAt,
    ),
  ],
);

export const adminAuditEvents = pgTable(
  "admin_audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    adminUserId: uuid("admin_user_id")
      .notNull()
      .references(() => adminUsers.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    actionType: varchar("action_type", { length: 40 }).notNull(),
    entityType: varchar("entity_type", { length: 40 }).notNull(),
    entityId: varchar("entity_id", { length: 80 }).notNull(),
    beforeState: jsonb("before_state").$type<Record<
      string,
      string | number | boolean | null
    > | null>(),
    afterState: jsonb("after_state").$type<Record<
      string,
      string | number | boolean | null
    > | null>(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("admin_audit_events_created_at_idx").on(table.createdAt),
    index("admin_audit_events_entity_idx").on(table.entityType, table.entityId),
  ],
);
