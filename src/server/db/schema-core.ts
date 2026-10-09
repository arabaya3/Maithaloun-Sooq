import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  foreignKey,
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
  productPublicationValues,
} from "@/features/catalog/domain/product-constants";
import { orderStatuses } from "@/features/orders/domain/order-status";

export const productAvailabilityEnum = pgEnum(
  "product_availability",
  productAvailabilityValues,
);
// No column uses this type since categories became a table; it stays so a rollback can restore the column.
export const productCategoryEnum = pgEnum(
  "product_category",
  productCategoryIds,
);
export const productPublicationEnum = pgEnum(
  "product_publication",
  productPublicationValues,
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

// Categories are data: the storefront shows visible, unarchived rows; products keep a restricting reference.
export const productCategories = pgTable(
  "product_categories",
  {
    code: varchar("code", { length: 40 }).primaryKey(),
    nameAr: varchar("name_ar", { length: 80 }).notNull(),
    description: text("description"),
    icon: varchar("icon", { length: 30 }).notNull(),
    sortOrder: integer("sort_order").notNull(),
    visible: boolean("visible").default(true).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
    mergedIntoCode: varchar("merged_into_code", { length: 40 }).references(
      (): AnyPgColumn => productCategories.code,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),
    ...timestamps,
  },
  (table) => [
    index("product_categories_merged_into_idx").on(table.mergedIntoCode),
    uniqueIndex("product_categories_active_name_uidx")
      .on(sql`lower(${table.nameAr})`)
      .where(sql`${table.archivedAt} IS NULL`),
    check(
      "product_categories_code_format",
      sql`${table.code} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND ${table.code} <> 'all'`,
    ),
    check("product_categories_non_negative_sort", sql`${table.sortOrder} >= 0`),
  ],
);

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
    categoryId: varchar("category_id", { length: 40 })
      .notNull()
      .references(() => productCategories.code, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    availability: productAvailabilityEnum("availability").notNull(),
    publication: productPublicationEnum("publication")
      .default("published")
      .notNull(),
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
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
    mergedIntoProductId: uuid("merged_into_product_id").references(
      (): AnyPgColumn => products.id,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),
    ...timestamps,
  },
  (table) => [
    index("products_merged_into_idx").on(table.mergedIntoProductId),
    index("products_category_idx").on(table.categoryId),
    index("products_storefront_idx")
      .on(table.sortOrder)
      .where(
        sql`${table.publication} = 'published' AND ${table.archivedAt} IS NULL`,
      ),
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
    // Set only on the dedicated QA probe; the stock-path simulation refuses any other variant.
    qaOwned: boolean("qa_owned").default(false).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
    packCount: integer("pack_count"),
    combinationKey: varchar("combination_key", { length: 400 }),
    ...timestamps,
  },
  (table) => [
    index("product_variants_product_id_idx").on(table.productId),
    uniqueIndex("product_variants_id_product_uidx").on(
      table.id,
      table.productId,
    ),
    uniqueIndex("product_variants_active_combination_uidx")
      .on(table.productId, table.combinationKey)
      .where(
        sql`${table.archivedAt} IS NULL AND ${table.combinationKey} IS NOT NULL`,
      ),
    check(
      "product_variants_pack_count",
      sql`${table.packCount} IS NULL OR ${table.packCount} BETWEEN 1 AND 1000`,
    ),
    uniqueIndex("product_variants_product_sort_uidx").on(
      table.productId,
      table.sortOrder,
    ),
    uniqueIndex("product_variants_one_default_uidx")
      .on(table.productId)
      .where(sql`${table.isDefault} = true`),
    index("product_variants_sku_idx")
      .on(sql`lower(${table.sku})`)
      .where(sql`${table.sku} IS NOT NULL`),
    index("product_variants_barcode_idx")
      .on(table.barcode)
      .where(sql`${table.barcode} IS NOT NULL`),
    check(
      "product_variants_default_not_archived",
      sql`NOT (${table.isDefault} AND ${table.archivedAt} IS NOT NULL)`,
    ),
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

// The ways to buy one exact variant (a piece, a 3-pack, a carton). Stock stays in base units on the
// variant; selling one of these consumes units_per_sale base units. mirrors_variant marks the base
// unit created for every variant, whose price follows product_variants.price_agorot.
export const productSellingUnits = pgTable(
  "product_selling_units",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id").notNull(),
    variantId: uuid("variant_id").notNull(),
    labelAr: varchar("label_ar", { length: 60 }).notNull(),
    unitsPerSale: integer("units_per_sale").notNull(),
    priceAgorot: integer("price_agorot").notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    mirrorsVariant: boolean("mirrors_variant").default(false).notNull(),
    sku: varchar("sku", { length: 64 }),
    barcode: varchar("barcode", { length: 64 }),
    sortOrder: integer("sort_order").default(0).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
    version: integer("version").default(1).notNull(),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      name: "product_selling_units_variant_fk",
      columns: [table.variantId, table.productId],
      foreignColumns: [productVariants.id, productVariants.productId],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    index("product_selling_units_variant_idx").on(
      table.variantId,
      table.productId,
    ),
    index("product_selling_units_product_idx").on(table.productId),
    uniqueIndex("product_selling_units_one_default_uidx")
      .on(table.variantId)
      .where(sql`${table.isDefault}`),
    uniqueIndex("product_selling_units_one_mirror_uidx")
      .on(table.variantId)
      .where(sql`${table.mirrorsVariant}`),
    uniqueIndex("product_selling_units_active_units_uidx")
      .on(table.variantId, table.unitsPerSale)
      .where(sql`${table.archivedAt} IS NULL`),
    uniqueIndex("product_selling_units_active_label_uidx")
      .on(table.variantId, sql`lower(btrim(${table.labelAr}))`)
      .where(sql`${table.archivedAt} IS NULL`),
    uniqueIndex("product_selling_units_active_sku_uidx")
      .on(sql`lower(${table.sku})`)
      .where(sql`${table.sku} IS NOT NULL AND ${table.archivedAt} IS NULL`),
    uniqueIndex("product_selling_units_active_barcode_uidx")
      .on(table.barcode)
      .where(sql`${table.barcode} IS NOT NULL AND ${table.archivedAt} IS NULL`),
    check(
      "product_selling_units_units_per_sale",
      sql`${table.unitsPerSale} BETWEEN 1 AND 1000`,
    ),
    check(
      "product_selling_units_positive_price",
      sql`${table.priceAgorot} BETWEEN 1 AND 10000000`,
    ),
    check(
      "product_selling_units_label",
      sql`char_length(btrim(${table.labelAr})) BETWEEN 1 AND 60`,
    ),
    check(
      "product_selling_units_default_active",
      sql`NOT (${table.isDefault} AND ${table.archivedAt} IS NOT NULL)`,
    ),
    check(
      "product_selling_units_mirror_single",
      sql`NOT ${table.mirrorsVariant} OR ${table.unitsPerSale} = 1`,
    ),
    check(
      "product_selling_units_non_negative_sort",
      sql`${table.sortOrder} >= 0`,
    ),
    check("product_selling_units_positive_version", sql`${table.version} > 0`),
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
    // How the customer sent the order; WhatsApp orders wait for confirmation in the chat.
    checkoutChannel: varchar("checkout_channel", { length: 16 })
      .default("web")
      .notNull(),
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
    // Owner-made QA orders: never notified, queued, delivered or reported.
    isTest: boolean("is_test").default(false).notNull(),
    ...timestamps,
  },
  (table) => [
    index("orders_status_created_at_idx").on(table.status, table.createdAt),
    index("orders_test_created_at_idx")
      .on(table.createdAt)
      .where(sql`${table.isTest}`),
    check(
      "orders_test_contact",
      sql`(${table.isTest} AND ${table.normalizedPhone} = 'qa-test' AND ${table.whatsappPhoneE164} IS NULL)
        OR (NOT ${table.isTest} AND ${table.normalizedPhone} <> 'qa-test')`,
    ),
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

export const offerKindEnum = pgEnum("offer_kind", [
  "percentage",
  "amount_off",
  "fixed_price",
]);

// Offers price variants; the list price on the variant is never changed by an offer.
export const offers = pgTable(
  "offers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    nameAr: varchar("name_ar", { length: 80 }).notNull(),
    displayText: varchar("display_text", { length: 120 }),
    kind: offerKindEnum("kind").notNull(),
    value: integer("value").notNull(),
    minQuantity: integer("min_quantity").default(1).notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true, mode: "date" }),
    endsAt: timestamp("ends_at", { withTimezone: true, mode: "date" }),
    enabled: boolean("enabled").default(false).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
    ...timestamps,
  },
  (table) => [
    index("offers_live_idx")
      .on(table.startsAt, table.endsAt)
      .where(sql`${table.enabled} AND ${table.archivedAt} IS NULL`),
    check(
      "offers_value_range",
      sql`(${table.kind} = 'percentage' AND ${table.value} BETWEEN 1 AND 90)
        OR (${table.kind} <> 'percentage' AND ${table.value} BETWEEN 1 AND 10000000)`,
    ),
    check("offers_min_quantity", sql`${table.minQuantity} BETWEEN 1 AND 100`),
    check(
      "offers_window",
      sql`${table.startsAt} IS NULL OR ${table.endsAt} IS NULL OR ${table.endsAt} > ${table.startsAt}`,
    ),
  ],
);

export const offerTargets = pgTable(
  "offer_targets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    offerId: uuid("offer_id")
      .notNull()
      .references(() => offers.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "restrict",
    }),
    variantId: uuid("variant_id").references(() => productVariants.id, {
      onDelete: "restrict",
    }),
    categoryCode: varchar("category_code", { length: 40 }).references(
      () => productCategories.code,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("offer_targets_offer_idx").on(table.offerId),
    index("offer_targets_product_idx").on(table.productId),
    index("offer_targets_variant_idx").on(table.variantId),
    index("offer_targets_category_idx").on(table.categoryCode),
    check(
      "offer_targets_exactly_one",
      sql`num_nonnulls(${table.productId}, ${table.variantId}, ${table.categoryCode}) = 1`,
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
    // What the customer saw when ordering; null on lines from before these snapshots existed.
    imageSnapshot: jsonb("image_snapshot").$type<{
      src: string;
      alt: string;
    } | null>(),
    optionValuesSnapshot: jsonb("option_values_snapshot").$type<Array<{
      option: string;
      value: string;
    }> | null>(),
    variantSkuSnapshot: varchar("variant_sku_snapshot", { length: 64 }),
    variantBarcodeSnapshot: varchar("variant_barcode_snapshot", {
      length: 64,
    }),
    unitPriceAgorot: integer("unit_price_agorot").notNull(),
    listUnitPriceAgorot: integer("list_unit_price_agorot"),
    offerId: uuid("offer_id").references(() => offers.id, {
      onDelete: "restrict",
    }),
    quantity: integer("quantity").notNull(),
    lineSubtotalAgorot: integer("line_subtotal_agorot").notNull(),
    // How the customer bought it; lines from before selling units have no unit and count 1 piece each.
    sellingUnitId: uuid("selling_unit_id").references(
      () => productSellingUnits.id,
      { onDelete: "restrict" },
    ),
    sellingUnitLabelSnapshot: varchar("selling_unit_label_snapshot", {
      length: 60,
    }),
    sellingUnitSkuSnapshot: varchar("selling_unit_sku_snapshot", {
      length: 64,
    }),
    sellingUnitBarcodeSnapshot: varchar("selling_unit_barcode_snapshot", {
      length: 64,
    }),
    unitsPerSale: integer("units_per_sale").default(1).notNull(),
    // Pieces reserved and delivered for this line; never stored separately from its inputs.
    baseUnits: integer("base_units").generatedAlwaysAs(
      sql`quantity * units_per_sale`,
    ),
  },
  (table) => [
    index("order_items_offer_idx").on(table.offerId),
    uniqueIndex("order_items_order_variant_uidx")
      .on(table.orderId, table.variantDomainId)
      .where(
        sql`${table.variantDomainId} IS NOT NULL AND ${table.sellingUnitId} IS NULL`,
      ),
    uniqueIndex("order_items_order_selling_unit_uidx")
      .on(table.orderId, table.sellingUnitId)
      .where(sql`${table.sellingUnitId} IS NOT NULL`),
    index("order_items_selling_unit_idx").on(table.sellingUnitId),
    check(
      "order_items_units_per_sale",
      sql`${table.unitsPerSale} BETWEEN 1 AND 1000`,
    ),
    check(
      "order_items_selling_unit_snapshot",
      sql`${table.sellingUnitId} IS NULL OR ${table.sellingUnitLabelSnapshot} IS NOT NULL`,
    ),
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

export const adminNotifications = pgTable(
  "admin_notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    type: varchar("type", { length: 40 }).notNull(),
    orderId: uuid("order_id").references(() => orders.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    title: varchar("title", { length: 120 }).notNull(),
    body: varchar("body", { length: 240 }).notNull(),
    href: varchar("href", { length: 300 }).notNull(),
    dedupeKey: varchar("dedupe_key", { length: 120 }).unique(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("admin_notifications_created_at_idx").on(table.createdAt),
    uniqueIndex("admin_notifications_order_type_uidx")
      .on(table.orderId, table.type)
      .where(sql`${table.orderId} IS NOT NULL`),
  ],
);

export const adminNotificationReads = pgTable(
  "admin_notification_reads",
  {
    notificationId: uuid("notification_id")
      .notNull()
      .references(() => adminNotifications.id, { onDelete: "cascade" }),
    adminUserId: uuid("admin_user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.notificationId, table.adminUserId] }),
    index("admin_notification_reads_user_idx").on(table.adminUserId),
  ],
);

export const adminPushSubscriptions = pgTable(
  "admin_push_subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    adminUserId: uuid("admin_user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: varchar("p256dh", { length: 180 }).notNull(),
    auth: varchar("auth", { length: 80 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    ...timestamps,
  },
  (table) => [index("admin_push_subscriptions_user_idx").on(table.adminUserId)],
);
