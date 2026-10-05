import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { productVariants, products } from "./schema-core";

const at = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });
const timestamps = {
  createdAt: at("created_at").defaultNow().notNull(),
  updatedAt: at("updated_at").defaultNow().notNull(),
};

export const productOptionKinds = [
  "color",
  "fragrance",
  "size",
  "pack",
  "other",
] as const;
export const productOptionKindEnum = pgEnum(
  "product_option_kind",
  productOptionKinds,
);

export const productOptions = pgTable(
  "product_options",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    nameAr: varchar("name_ar", { length: 40 }).notNull(),
    normalizedName: varchar("normalized_name", { length: 40 }).notNull(),
    kind: productOptionKindEnum("kind").default("other").notNull(),
    sortOrder: integer("sort_order").notNull(),
    archivedAt: at("archived_at"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("product_options_name_uidx").on(
      table.productId,
      table.normalizedName,
    ),
    uniqueIndex("product_options_id_product_uidx").on(
      table.id,
      table.productId,
    ),
    check("product_options_sort", sql`${table.sortOrder} >= 0`),
    check(
      "product_options_name_not_blank",
      sql`char_length(btrim(${table.nameAr})) >= 1`,
    ),
  ],
);

export const productOptionValues = pgTable(
  "product_option_values",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    optionId: uuid("option_id").notNull(),
    productId: uuid("product_id").notNull(),
    valueAr: varchar("value_ar", { length: 60 }).notNull(),
    normalizedValue: varchar("normalized_value", { length: 60 }).notNull(),
    sortOrder: integer("sort_order").notNull(),
    // The owner chose to show the shared product image for this value instead of a picture of its own.
    usesSharedImage: boolean("uses_shared_image").default(false).notNull(),
    archivedAt: at("archived_at"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("product_option_values_value_uidx").on(
      table.optionId,
      table.normalizedValue,
    ),
    uniqueIndex("product_option_values_id_option_uidx").on(
      table.id,
      table.optionId,
    ),
    index("product_option_values_option_product_idx").on(
      table.optionId,
      table.productId,
    ),
    foreignKey({
      name: "product_option_values_option_same_product_fk",
      columns: [table.optionId, table.productId],
      foreignColumns: [productOptions.id, productOptions.productId],
    }).onDelete("cascade"),
    check("product_option_values_sort", sql`${table.sortOrder} >= 0`),
    check(
      "product_option_values_not_blank",
      sql`char_length(btrim(${table.valueAr})) >= 1`,
    ),
  ],
);

export const productImageScopes = [
  "unassigned",
  "product",
  "option_value",
  "variant",
] as const;
export type ProductImageScope = (typeof productImageScopes)[number];
export const productImageScopeEnum = pgEnum(
  "product_image_scope",
  productImageScopes,
);

// Every image states what it shows: the whole product, one option value (such as a colour), one exact variant, or nothing yet.
// Gallery images; the legacy products.image_* and product_variants.image_* columns mirror the primary and assigned images.
export const productImages = pgTable(
  "product_images",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id"),
    scope: productImageScopeEnum("scope").default("product").notNull(),
    optionId: uuid("option_id"),
    optionValueId: uuid("option_value_id"),
    src: varchar("src", { length: 500 }).notNull(),
    altAr: varchar("alt_ar", { length: 250 }).notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    sortOrder: integer("sort_order").notNull(),
    isPrimary: boolean("is_primary").default(false).notNull(),
    archivedAt: at("archived_at"),
    ...timestamps,
  },
  (table) => [
    index("product_images_product_sort_idx").on(
      table.productId,
      table.sortOrder,
    ),
    index("product_images_variant_idx").on(table.variantId, table.productId),
    index("product_images_option_idx").on(table.optionId, table.productId),
    index("product_images_option_value_idx").on(
      table.optionValueId,
      table.optionId,
    ),
    uniqueIndex("product_images_one_primary_uidx")
      .on(table.productId)
      .where(sql`${table.isPrimary} AND ${table.archivedAt} IS NULL`),
    foreignKey({
      name: "product_images_variant_same_product_fk",
      columns: [table.variantId, table.productId],
      foreignColumns: [productVariants.id, productVariants.productId],
    }),
    foreignKey({
      name: "product_images_option_same_product_fk",
      columns: [table.optionId, table.productId],
      foreignColumns: [productOptions.id, productOptions.productId],
    }),
    foreignKey({
      name: "product_images_value_same_option_fk",
      columns: [table.optionValueId, table.optionId],
      foreignColumns: [productOptionValues.id, productOptionValues.optionId],
    }),
    check(
      "product_images_scope_target",
      sql`(${table.scope} = 'variant' AND ${table.variantId} IS NOT NULL AND ${table.optionId} IS NULL AND ${table.optionValueId} IS NULL) OR (${table.scope} = 'option_value' AND ${table.variantId} IS NULL AND ${table.optionId} IS NOT NULL AND ${table.optionValueId} IS NOT NULL) OR (${table.scope} IN ('product', 'unassigned') AND ${table.variantId} IS NULL AND ${table.optionId} IS NULL AND ${table.optionValueId} IS NULL)`,
    ),
    check(
      "product_images_unassigned_not_primary",
      sql`NOT (${table.isPrimary} AND ${table.scope} = 'unassigned')`,
    ),
    check(
      "product_images_dimensions",
      sql`${table.width} > 0 AND ${table.height} > 0`,
    ),
    check("product_images_sort", sql`${table.sortOrder} >= 0`),
    check(
      "product_images_primary_active",
      sql`NOT (${table.isPrimary} AND ${table.archivedAt} IS NOT NULL)`,
    ),
  ],
);

// One row per (variant, option): a variant can never hold two values of the same option.
export const productVariantOptionValues = pgTable(
  "product_variant_option_values",
  {
    variantId: uuid("variant_id").notNull(),
    productId: uuid("product_id").notNull(),
    optionId: uuid("option_id").notNull(),
    valueId: uuid("value_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.variantId, table.optionId] }),
    index("product_variant_option_values_variant_idx").on(
      table.variantId,
      table.productId,
    ),
    index("product_variant_option_values_option_idx").on(
      table.optionId,
      table.productId,
    ),
    index("product_variant_option_values_value_idx").on(
      table.valueId,
      table.optionId,
    ),
    foreignKey({
      name: "product_variant_option_values_variant_fk",
      columns: [table.variantId, table.productId],
      foreignColumns: [productVariants.id, productVariants.productId],
    }).onDelete("cascade"),
    foreignKey({
      name: "product_variant_option_values_option_fk",
      columns: [table.optionId, table.productId],
      foreignColumns: [productOptions.id, productOptions.productId],
    }).onDelete("cascade"),
    foreignKey({
      name: "product_variant_option_values_value_fk",
      columns: [table.valueId, table.optionId],
      foreignColumns: [productOptionValues.id, productOptionValues.optionId],
    }),
  ],
);
