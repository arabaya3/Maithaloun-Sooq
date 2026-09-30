import "server-only";

import { and, eq } from "drizzle-orm";

import type { AdminActor } from "@/features/admin/domain/admin-actor";
import type { Database } from "@/features/inventory/application/stock-ledger";
import * as schema from "@/server/db/schema";

import type { ReminderService } from "./reminder-service";
import type { SummaryService } from "./summary-service";

const DAILY_JOB = "daily";

export interface DailyJobResult {
  status: "completed" | "skipped" | "failed" | "no_owner";
  reminders?: { checked: number; sent: number };
  summaryGenerated?: boolean;
}

export class ScheduledJobs {
  constructor(
    private readonly database: Database,
    private readonly reminders: ReminderService,
    private readonly summaries: SummaryService,
  ) {}

  async runDaily(today: string): Promise<DailyJobResult> {
    // Scheduled work runs with the owner's permissions; the owner is also who gets notified.
    const [owner] = await this.database
      .select()
      .from(schema.adminUsers)
      .where(
        and(
          eq(schema.adminUsers.role, "owner"),
          eq(schema.adminUsers.active, true),
        ),
      )
      .limit(1);
    if (!owner) return { status: "no_owner" };
    const actor: AdminActor = {
      id: owner.id,
      username: owner.username,
      displayName: owner.displayName,
      role: owner.role,
      active: owner.active,
    };

    const [claimed] = await this.database
      .insert(schema.scheduledJobRuns)
      .values({ job: DAILY_JOB, runDate: today, status: "running" })
      .onConflictDoNothing({
        target: [schema.scheduledJobRuns.job, schema.scheduledJobRuns.runDate],
      })
      .returning({ id: schema.scheduledJobRuns.id });
    const runFilter = and(
      eq(schema.scheduledJobRuns.job, DAILY_JOB),
      eq(schema.scheduledJobRuns.runDate, today),
    );
    if (!claimed) {
      const [existing] = await this.database
        .select({ status: schema.scheduledJobRuns.status })
        .from(schema.scheduledJobRuns)
        .where(runFilter);
      // A completed day is never repeated; a failed one may be retried, and each step is idempotent.
      if (existing?.status !== "failed") return { status: "skipped" };
      await this.database
        .update(schema.scheduledJobRuns)
        .set({ status: "running", startedAt: new Date(), finishedAt: null })
        .where(runFilter);
    }

    try {
      const reminders = await this.reminders.runDaily(actor, today);
      const summary = await this.summaries.runScheduled(actor, today);
      await this.database
        .update(schema.scheduledJobRuns)
        .set({
          status: "completed",
          finishedAt: new Date(),
          details: { ...reminders, summaryGenerated: summary.generated },
        })
        .where(runFilter);
      return {
        status: "completed",
        reminders,
        summaryGenerated: summary.generated,
      };
    } catch (error) {
      await this.database
        .update(schema.scheduledJobRuns)
        .set({
          status: "failed",
          finishedAt: new Date(),
          details: {
            error: error instanceof Error ? error.name : "UnknownError",
          },
        })
        .where(runFilter);
      return { status: "failed" };
    }
  }
}
