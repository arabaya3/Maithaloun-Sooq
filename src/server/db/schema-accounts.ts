import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { orders, products } from "./schema-core";

const at = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const customerAccounts = pgTable(
  "customer_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    phoneE164: varchar("phone_e164", { length: 20 }),
    displayName: varchar("display_name", { length: 100 }),
    whatsappE164: varchar("whatsapp_e164", { length: 20 }),
    personalizationEnabled: boolean("personalization_enabled")
      .default(false)
      .notNull(),
    lastLoginAt: at("last_login_at"),
    deletedAt: at("deleted_at"),
    createdAt: at("created_at").defaultNow().notNull(),
    updatedAt: at("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("customer_accounts_phone_uidx")
      .on(table.phoneE164)
      .where(sql`${table.deletedAt} IS NULL`),
    check(
      "customer_accounts_phone_format",
      sql`${table.phoneE164} IS NULL OR ${table.phoneE164} ~ '^\\+(970|972)5[0-9]{8}$'`,
    ),
    check(
      "customer_accounts_whatsapp_format",
      sql`${table.whatsappE164} IS NULL OR ${table.whatsappE164} ~ '^\\+(970|972)5[0-9]{8}$'`,
    ),
    check(
      "customer_accounts_active_has_phone",
      sql`${table.deletedAt} IS NOT NULL OR ${table.phoneE164} IS NOT NULL`,
    ),
  ],
);

export const customerSessions = pgTable(
  "customer_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => customerAccounts.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    createdAt: at("created_at").defaultNow().notNull(),
    expiresAt: at("expires_at").notNull(),
    lastUsedAt: at("last_used_at").defaultNow().notNull(),
    revokedAt: at("revoked_at"),
  },
  (table) => [index("customer_sessions_account_idx").on(table.accountId)],
);

export const customerAddresses = pgTable(
  "customer_addresses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => customerAccounts.id, { onDelete: "cascade" }),
    label: varchar("label", { length: 40 }).notNull(),
    address: varchar("address", { length: 500 }).notNull(),
    landmark: varchar("landmark", { length: 150 }),
    isDefault: boolean("is_default").default(false).notNull(),
    createdAt: at("created_at").defaultNow().notNull(),
    updatedAt: at("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("customer_addresses_account_idx").on(table.accountId),
    uniqueIndex("customer_addresses_default_uidx")
      .on(table.accountId)
      .where(sql`${table.isDefault}`),
    check(
      "customer_addresses_address_not_blank",
      sql`char_length(btrim(${table.address})) >= 5`,
    ),
  ],
);

export const customerFavorites = pgTable(
  "customer_favorites",
  {
    accountId: uuid("account_id")
      .notNull()
      .references(() => customerAccounts.id, { onDelete: "cascade" }),
    productDomainId: varchar("product_domain_id", { length: 80 })
      .notNull()
      .references(() => products.domainId, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    createdAt: at("created_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.productDomainId] }),
    index("customer_favorites_product_idx").on(table.productDomainId),
  ],
);

export const customerOrderLinkSourceEnum = pgEnum(
  "customer_order_link_source",
  ["checkout", "claim"],
);

// One owner per order: the order id is the primary key, so a claimed order cannot be claimed again.
export const customerOrderLinks = pgTable(
  "customer_order_links",
  {
    orderId: uuid("order_id")
      .primaryKey()
      .references(() => orders.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => customerAccounts.id, { onDelete: "cascade" }),
    source: customerOrderLinkSourceEnum("source").notNull(),
    linkedAt: at("linked_at").defaultNow().notNull(),
  },
  (table) => [index("customer_order_links_account_idx").on(table.accountId)],
);

export const customerAccountEventTypeEnum = pgEnum(
  "customer_account_event_type",
  [
    "account_created",
    "login",
    "logout_all",
    "orders_claimed",
    "favorites_merged",
    "profile_updated",
    "account_deleted",
  ],
);

export const customerAccountEvents = pgTable(
  "customer_account_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => customerAccounts.id, { onDelete: "restrict" }),
    type: customerAccountEventTypeEnum("type").notNull(),
    detail: jsonb("detail").$type<Record<string, number | string | boolean>>(),
    createdAt: at("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("customer_account_events_account_idx").on(
      table.accountId,
      table.createdAt,
    ),
  ],
);
