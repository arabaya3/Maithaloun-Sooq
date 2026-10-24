import { and, eq, gte } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "@/server/db/schema";
import { addDays, todayInStoreZone } from "@/shared/lib/store-time";

import type { SocialService } from "./social-service";

type Database = PostgresJsDatabase<typeof schema>;
type Summary = Record<string, string | number | boolean | null>;

export const socialJobNames = [
  "discover",
  "draft",
  "render",
  "publish",
  "reconcile",
  "engagement",
  "comments",
  "connection",
  "report",
] as const;
export type SocialJobName = (typeof socialJobNames)[number];

/** How far ahead drafts are prepared, so the owner always has two weeks to review. */
export const DRAFT_HORIZON_DAYS = 14;

function errorCodeOf(error: unknown): string {
  if (
    error instanceof Error &&
    /^[A-Za-z][A-Za-z0-9_]{0,59}$/.test(error.message)
  )
    return error.message;
  return "UNKNOWN";
}

/**
 * Every scheduled job runs through here: one row per run with its outcome, so failures are visible
 * on the dashboard and a weekly report is never produced twice for the same week.
 */
export class SocialJobs {
  constructor(
    private readonly database: Database,
    private readonly service: SocialService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async run(job: SocialJobName): Promise<{
    job: SocialJobName;
    status: "ok" | "failed" | "skipped";
    summary: Summary;
    errorCode?: string;
  }> {
    const [run] = await this.database
      .insert(schema.socialJobRuns)
      .values({ job, status: "running", startedAt: this.now() })
      .returning({ id: schema.socialJobRuns.id });
    let status: "ok" | "failed" | "skipped" = "ok";
    let summary: Summary = {};
    let errorCode: string | undefined;
    try {
      summary = await this.execute(job);
      if (typeof summary.skipped === "string") status = "skipped";
    } catch (error) {
      status = "failed";
      errorCode = errorCodeOf(error);
    }
    await this.database
      .update(schema.socialJobRuns)
      .set({
        status,
        summary,
        errorCode: errorCode ?? null,
        finishedAt: this.now(),
      })
      .where(eq(schema.socialJobRuns.id, run!.id));
    return { job, status, summary, errorCode };
  }

  private async execute(job: SocialJobName): Promise<Summary> {
    const today = todayInStoreZone(this.now());
    switch (job) {
      case "discover":
        return this.service.discoverProducts();
      case "draft":
        return this.service.draftPlan(null, {
          startDate: addDays(today, 1),
          days: DRAFT_HORIZON_DAYS,
        });
      case "render":
        return this.service.renderPending();
      case "publish":
        return this.service.publishDue();
      case "reconcile":
        return this.service.reconcileStale();
      case "engagement":
        return this.service.refreshEngagement();
      case "comments":
        return this.service.syncComments();
      case "connection":
        return { state: await this.service.checkConnection() };
      case "report": {
        const already = await this.database
          .select({ id: schema.socialJobRuns.id })
          .from(schema.socialJobRuns)
          .where(
            and(
              eq(schema.socialJobRuns.job, "report"),
              eq(schema.socialJobRuns.status, "ok"),
              gte(
                schema.socialJobRuns.startedAt,
                new Date(this.now().getTime() - 6 * 86_400_000),
              ),
            ),
          )
          .limit(1);
        if (already.length) return { skipped: "already_reported" };
        return this.service.weeklyReport(today);
      }
    }
  }

  /** The frequent tick: publish what is due, recover stalled claims. */
  async tick() {
    return [await this.run("reconcile"), await this.run("publish")];
  }

  /** Once a day: catalog, drafts for the next two weeks, metrics, comments, token health; the report on Sundays. */
  async daily() {
    const results = [];
    for (const job of [
      "connection",
      "discover",
      "draft",
      "render",
      "engagement",
      "comments",
    ] as const) {
      results.push(await this.run(job));
    }
    const weekday = new Date(
      `${todayInStoreZone(this.now())}T12:00:00Z`,
    ).getUTCDay();
    if (weekday === 0) results.push(await this.run("report"));
    return results;
  }
}
