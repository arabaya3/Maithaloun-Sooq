import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { adminUsers } from "./schema-core";

const createdAt = timestamp("created_at", { withTimezone: true, mode: "date" })
  .defaultNow()
  .notNull();
const updatedAt = timestamp("updated_at", { withTimezone: true, mode: "date" })
  .defaultNow()
  .notNull();
// Audit rows keep their author; conversation content goes with the account.
const owner = (onDelete: "cascade" | "restrict" = "cascade") =>
  uuid("admin_user_id")
    .notNull()
    .references(() => adminUsers.id, { onDelete, onUpdate: "cascade" });

export const adminAssistantConversations = pgTable(
  "admin_assistant_conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    adminUserId: owner(),
    title: varchar("title", { length: 120 }),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("admin_assistant_conversations_owner_idx").on(
      table.adminUserId,
      table.updatedAt,
    ),
  ],
);

export const adminAssistantMessages = pgTable(
  "admin_assistant_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => adminAssistantConversations.id, {
        onDelete: "cascade",
      }),
    messageId: varchar("message_id", { length: 80 }).notNull(),
    role: varchar("role", { length: 16 }).notNull(),
    parts: jsonb("parts").$type<unknown[]>().notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt,
  },
  (table) => [
    uniqueIndex("admin_assistant_messages_conversation_message_uidx").on(
      table.conversationId,
      table.messageId,
    ),
    index("admin_assistant_messages_conversation_created_idx").on(
      table.conversationId,
      table.createdAt,
    ),
    check(
      "admin_assistant_messages_role",
      sql`${table.role} IN ('user', 'assistant')`,
    ),
  ],
);

export const adminAssistantAttachments = pgTable(
  "admin_assistant_attachments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    adminUserId: owner(),
    mimeType: varchar("mime_type", { length: 60 }).notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    width: integer("width"),
    height: integer("height"),
    storageProvider: varchar("storage_provider", { length: 20 }).notNull(),
    storageBucket: varchar("storage_bucket", { length: 80 }).notNull(),
    storagePath: varchar("storage_path", { length: 220 }).notNull(),
    status: varchar("status", { length: 16 }).default("temporary").notNull(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    createdAt,
  },
  (table) => [
    index("admin_assistant_attachments_owner_idx").on(
      table.adminUserId,
      table.createdAt,
    ),
    index("admin_assistant_attachments_expiry_idx").on(
      table.status,
      table.expiresAt,
    ),
    check(
      "admin_assistant_attachments_status",
      sql`${table.status} IN ('temporary', 'used', 'deleted')`,
    ),
    check(
      "admin_assistant_attachments_positive_size",
      sql`${table.byteSize} > 0`,
    ),
  ],
);

export const adminAssistantToolRuns = pgTable(
  "admin_assistant_tool_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id").references(
      () => adminAssistantConversations.id,
      { onDelete: "set null" },
    ),
    adminUserId: owner("restrict"),
    toolName: varchar("tool_name", { length: 60 }).notNull(),
    riskLevel: smallint("risk_level").notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    inputSummary: jsonb("input_summary").$type<Record<string, unknown>>(),
    resultRef: varchar("result_ref", { length: 160 }),
    errorCode: varchar("error_code", { length: 60 }),
    durationMs: integer("duration_ms").notNull(),
    createdAt,
  },
  (table) => [
    index("admin_assistant_tool_runs_conversation_idx").on(
      table.conversationId,
    ),
    index("admin_assistant_tool_runs_owner_created_idx").on(
      table.adminUserId,
      table.createdAt,
    ),
    check(
      "admin_assistant_tool_runs_status",
      sql`${table.status} IN ('succeeded', 'failed', 'rejected')`,
    ),
    check(
      "admin_assistant_tool_runs_risk",
      sql`${table.riskLevel} BETWEEN 1 AND 4`,
    ),
  ],
);

export const adminAssistantConfirmations = pgTable(
  "admin_assistant_confirmations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id").references(
      () => adminAssistantConversations.id,
      { onDelete: "set null" },
    ),
    adminUserId: owner("restrict"),
    operation: varchar("operation", { length: 60 }).notNull(),
    riskLevel: smallint("risk_level").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
    recordVersion: varchar("record_version", { length: 120 }).notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    tokenIssuedAt: timestamp("token_issued_at", {
      withTimezone: true,
      mode: "date",
    }),
    status: varchar("status", { length: 16 }).default("pending").notNull(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true, mode: "date" }),
    result: jsonb("result").$type<Record<string, unknown>>(),
    errorCode: varchar("error_code", { length: 60 }),
    createdAt,
  },
  (table) => [
    index("admin_assistant_confirmations_owner_status_idx").on(
      table.adminUserId,
      table.status,
    ),
    index("admin_assistant_confirmations_conversation_idx").on(
      table.conversationId,
    ),
    check(
      "admin_assistant_confirmations_status",
      sql`${table.status} IN ('pending', 'executing', 'completed', 'failed', 'expired', 'cancelled')`,
    ),
    check(
      "admin_assistant_confirmations_risk",
      sql`${table.riskLevel} BETWEEN 2 AND 4`,
    ),
  ],
);

// One open product draft per conversation; the confirmation card is built from this row, not from chat memory.
export const adminAssistantProductDrafts = pgTable(
  "admin_assistant_product_drafts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    adminUserId: owner(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => adminAssistantConversations.id, {
        onDelete: "cascade",
      }),
    status: varchar("status", { length: 16 }).default("open").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    version: integer("version").default(1).notNull(),
    confirmationId: uuid("confirmation_id"),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("admin_assistant_product_drafts_owner_idx").on(table.adminUserId),
    uniqueIndex("admin_assistant_product_drafts_open_uidx")
      .on(table.conversationId)
      .where(sql`${table.status} = 'open'`),
    check(
      "admin_assistant_product_drafts_status",
      sql`${table.status} IN ('open', 'submitted', 'cancelled', 'expired')`,
    ),
  ],
);
