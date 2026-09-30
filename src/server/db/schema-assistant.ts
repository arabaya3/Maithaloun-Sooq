import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import {
  businessReportKinds,
  pushDeliveryStatuses,
  scheduledJobStatuses,
} from "@/features/reminders/domain/schedule-constants";
import {
  voiceCommandStatuses,
  voiceTranscriptSources,
} from "@/features/voice/domain/voice-constants";

import { adminNotifications, adminUsers } from "./schema-core";
import { customers } from "./schema-sales";

const createdAt = timestamp("created_at", { withTimezone: true, mode: "date" })
  .defaultNow()
  .notNull();
const updatedAt = timestamp("updated_at", { withTimezone: true, mode: "date" })
  .defaultNow()
  .notNull();

export const voiceCommandStatusEnum = pgEnum(
  "voice_command_status",
  voiceCommandStatuses,
);
export const voiceTranscriptSourceEnum = pgEnum(
  "voice_transcript_source",
  voiceTranscriptSources,
);
export const pushDeliveryStatusEnum = pgEnum(
  "push_delivery_status",
  pushDeliveryStatuses,
);
export const businessReportKindEnum = pgEnum(
  "business_report_kind",
  businessReportKinds,
);
export const scheduledJobStatusEnum = pgEnum(
  "scheduled_job_status",
  scheduledJobStatuses,
);

export const voiceCommands = pgTable(
  "voice_commands",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    transcript: varchar("transcript", { length: 1000 }).notNull(),
    transcriptSource: voiceTranscriptSourceEnum("transcript_source").notNull(),
    intent: varchar("intent", { length: 40 }),
    interpretation: jsonb("interpretation").$type<Record<string, unknown>>(),
    aiModel: varchar("ai_model", { length: 80 }),
    promptVersion: varchar("prompt_version", { length: 40 }),
    status: voiceCommandStatusEnum("status").notNull(),
    corrections: jsonb("corrections").$type<Record<string, unknown>>(),
    resultEntityType: varchar("result_entity_type", { length: 40 }),
    resultEntityId: varchar("result_entity_id", { length: 80 }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => adminUsers.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("voice_commands_created_by_created_idx").on(
      table.createdBy,
      table.createdAt,
    ),
  ],
);

export const customerReminderState = pgTable(
  "customer_reminder_state",
  {
    customerId: uuid("customer_id")
      .primaryKey()
      .references(() => customers.id, { onDelete: "cascade" }),
    snoozedUntil: date("snoozed_until", { mode: "string" }),
    disputed: boolean("disputed").default(false).notNull(),
    disputeNote: varchar("dispute_note", { length: 240 }),
    lastRemindedOn: date("last_reminded_on", { mode: "string" }),
    updatedBy: uuid("updated_by").references(() => adminUsers.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    updatedAt,
  },
  (table) => [
    index("customer_reminder_state_updated_by_idx").on(table.updatedBy),
  ],
);

export const customerReminders = pgTable(
  "customer_reminders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    reminderDate: date("reminder_date", { mode: "string" }).notNull(),
    balanceAgorot: integer("balance_agorot").notNull(),
    daysOutstanding: integer("days_outstanding").notNull(),
    notificationId: uuid("notification_id").references(
      () => adminNotifications.id,
      { onDelete: "set null" },
    ),
    pushStatus: pushDeliveryStatusEnum("push_status").notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("customer_reminders_customer_date_uidx").on(
      table.customerId,
      table.reminderDate,
    ),
    index("customer_reminders_notification_idx").on(table.notificationId),
    check(
      "customer_reminders_positive_balance",
      sql`${table.balanceAgorot} > 0`,
    ),
  ],
);

export const businessReports = pgTable(
  "business_reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    kind: businessReportKindEnum("kind").notNull(),
    periodFrom: date("period_from", { mode: "string" }).notNull(),
    periodTo: date("period_to", { mode: "string" }).notNull(),
    metrics: jsonb("metrics").$type<Record<string, unknown>>().notNull(),
    headline: varchar("headline", { length: 240 }).notNull(),
    insight: jsonb("insight").$type<Record<string, unknown>>(),
    aiModel: varchar("ai_model", { length: 80 }),
    promptVersion: varchar("prompt_version", { length: 40 }),
    notificationId: uuid("notification_id").references(
      () => adminNotifications.id,
      { onDelete: "set null" },
    ),
    pushStatus: pushDeliveryStatusEnum("push_status").notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("business_reports_kind_period_uidx").on(
      table.kind,
      table.periodFrom,
      table.periodTo,
    ),
    index("business_reports_created_at_idx").on(table.createdAt),
    index("business_reports_notification_idx").on(table.notificationId),
    check(
      "business_reports_period_order",
      sql`${table.periodFrom} <= ${table.periodTo}`,
    ),
  ],
);

export const storeSettings = pgTable(
  "store_settings",
  {
    key: varchar("key", { length: 60 }).primaryKey(),
    value: jsonb("value").$type<unknown>().notNull(),
    updatedBy: uuid("updated_by").references(() => adminUsers.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    updatedAt,
  },
  (table) => [index("store_settings_updated_by_idx").on(table.updatedBy)],
);

export const scheduledJobRuns = pgTable(
  "scheduled_job_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    job: varchar("job", { length: 60 }).notNull(),
    runDate: date("run_date", { mode: "string" }).notNull(),
    status: scheduledJobStatusEnum("status").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    uniqueIndex("scheduled_job_runs_job_date_uidx").on(
      table.job,
      table.runDate,
    ),
  ],
);
