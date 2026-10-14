import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { orders } from "./schema-core";

const createdAt = timestamp("created_at", { withTimezone: true, mode: "date" })
  .notNull()
  .defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true, mode: "date" })
  .notNull()
  .defaultNow();

/** One customer conversation per WhatsApp number, with the assistant's cart and the owner's pause switch. */
export const shopConversations = pgTable(
  "shop_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerE164: varchar("customer_e164", { length: 20 }).notNull(),
    customerName: varchar("customer_name", { length: 120 }),
    deliveryNote: varchar("delivery_note", { length: 300 }),
    // [{ productId, variantId, sellingUnitId, unitsPerSale, quantity }]; prices are never stored here.
    cart: jsonb("cart")
      .notNull()
      .default(sql`'[]'::jsonb`),
    cartVersion: integer("cart_version").notNull().default(0),
    // Set when the assistant has shown the final summary and is waiting for a yes.
    awaitingConfirmationVersion: integer("awaiting_confirmation_version"),
    botPaused: boolean("bot_paused").notNull().default(false),
    humanRequestedAt: timestamp("human_requested_at", {
      withTimezone: true,
      mode: "date",
    }),
    lastOrderId: uuid("last_order_id").references(() => orders.id, {
      onDelete: "set null",
    }),
    lastInboundAt: timestamp("last_inbound_at", {
      withTimezone: true,
      mode: "date",
    }),
    isTest: boolean("is_test").notNull().default(false),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("shop_conversations_customer_e164_idx").on(table.customerE164),
    index("shop_conversations_last_order_idx").on(table.lastOrderId),
    check(
      "shop_conversations_e164_format",
      sql`${table.customerE164} ~ '^\\+[1-9][0-9]{7,14}$' OR ${table.isTest}`,
    ),
  ],
);

/** Every message in and out. Inbound provider ids are unique, so a redelivered webhook is handled once. */
export const shopMessages = pgTable(
  "shop_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => shopConversations.id, { onDelete: "cascade" }),
    direction: varchar("direction", { length: 8 }).notNull(),
    author: varchar("author", { length: 12 }).notNull(),
    body: text("body").notNull(),
    provider: varchar("provider", { length: 24 }).notNull(),
    providerMessageId: varchar("provider_message_id", { length: 128 }),
    deliveryStatus: varchar("delivery_status", { length: 16 }),
    createdAt,
  },
  (table) => [
    index("shop_messages_conversation_idx").on(
      table.conversationId,
      table.createdAt,
    ),
    uniqueIndex("shop_messages_provider_message_idx")
      .on(table.provider, table.providerMessageId)
      .where(sql`${table.providerMessageId} IS NOT NULL`),
    check("shop_messages_direction", sql`${table.direction} IN ('in', 'out')`),
    check(
      "shop_messages_author",
      sql`${table.author} IN ('customer', 'assistant', 'owner', 'system')`,
    ),
  ],
);
