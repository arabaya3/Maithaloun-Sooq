import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { adminUsers, productVariants } from "./schema-core";

const at = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const qaSimulationStatuses = [
  "issued",
  "running",
  "passed",
  "failed",
  "expired",
] as const;

// One row per owner stock-path simulation: its single-use token, the lock that
// stops two runs on one variant, and the minimal audit of the outcome. Business
// effects of a run are always rolled back; only this row survives.
export const qaSimulationRuns = pgTable(
  "qa_simulation_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    adminUserId: uuid("admin_user_id")
      .notNull()
      .references(() => adminUsers.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    status: varchar("status", { length: 16 }).default("issued").notNull(),
    supportReference: varchar("support_reference", { length: 16 }).notNull(),
    expiresAt: at("expires_at").notNull(),
    startedAt: at("started_at"),
    finishedAt: at("finished_at"),
    durationMs: integer("duration_ms"),
    createdAt: at("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("qa_simulation_runs_admin_created_idx").on(
      table.adminUserId,
      table.createdAt,
    ),
    index("qa_simulation_runs_variant_idx").on(table.variantId),
    uniqueIndex("qa_simulation_runs_one_running_per_variant")
      .on(table.variantId)
      .where(sql`${table.status} = 'running'`),
    check(
      "qa_simulation_runs_status",
      sql`${table.status} IN ('issued', 'running', 'passed', 'failed', 'expired')`,
    ),
    check(
      "qa_simulation_runs_duration",
      sql`${table.durationMs} IS NULL OR ${table.durationMs} >= 0`,
    ),
  ],
);
