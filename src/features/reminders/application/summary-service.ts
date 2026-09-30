import "server-only";

import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import type { AdminNotificationService } from "@/features/admin/notifications/notification-service";
import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { assertPermission } from "@/features/admin/domain/permissions";
import type { Database } from "@/features/inventory/application/stock-ledger";
import { formatQuantity } from "@/features/inventory/domain/quantity";
import {
  dueSummaryPeriod,
  summaryHeadline,
} from "@/features/reminders/domain/reminder-rules";
import {
  summaryFrequencies,
  type BusinessReportKind,
  type PushDeliveryStatus,
  type SummaryFrequency,
} from "@/features/reminders/domain/schedule-constants";
import type {
  BusinessReport,
  ReportService,
} from "@/features/reports/application/report-service";
import type { ReportPeriod } from "@/features/reports/domain/report-calculation";
import { formatIls } from "@/shared/lib/format-currency";
import { formatBasisPoints } from "@/shared/lib/money-math";
import {
  INSIGHT_PROMPT_VERSION,
  type BusinessInsight,
  type InsightGenerator,
} from "@/server/ai/insight-generator";
import * as schema from "@/server/db/schema";

const FREQUENCY_KEY = "summary_frequency";
const DEFAULT_FREQUENCY: SummaryFrequency = "fortnightly";

export interface ArchivedSummary {
  id: string;
  kind: BusinessReportKind;
  periodFrom: string;
  periodTo: string;
  headline: string;
  createdAt: string;
  pushStatus: PushDeliveryStatus;
}

export interface ArchivedSummaryDetail extends ArchivedSummary {
  report: BusinessReport;
  insight: BusinessInsight | null;
  aiModel: string | null;
}

// Figures are formatted in code before they reach the model, so it can only quote them.
export function insightFacts(report: BusinessReport): Record<string, unknown> {
  const { metrics } = report;
  return {
    period: report.period,
    costComplete: metrics.costComplete,
    netSales: formatIls(metrics.netSalesAgorot),
    grossProfit: formatIls(metrics.grossProfitAgorot),
    grossMargin:
      metrics.grossMarginBasisPoints === null
        ? null
        : formatBasisPoints(metrics.grossMarginBasisPoints),
    salesWithoutRecordedCost: formatIls(metrics.uncostedSalesAgorot),
    cashCollected: formatIls(metrics.cashCollectedAgorot),
    creditSales: formatIls(metrics.creditSalesAgorot),
    outstandingCustomerBalances: formatIls(metrics.outstandingBalancesAgorot),
    purchases: formatIls(metrics.purchasesAgorot),
    inventoryValue: formatIls(metrics.inventoryValueAgorot),
    orderCount: metrics.orderCount,
    topByQuantity: report.byQuantity.map((item) => ({
      name: item.name,
      quantity: formatQuantity(item.quantityMilli),
    })),
    topByProfit: report.byProfit.map((item) => ({
      name: item.name,
      profit: formatIls(item.profitAgorot ?? 0),
    })),
    outOfStock: report.outOfStock.map((item) => item.name),
    lowStock: report.lowStock.map((item) => item.name),
    slowMoving: report.slowMoving.map((item) => item.name),
    overdueCustomerCount: report.overdueCustomers.length,
    costChanges: report.costChanges.map((item) => ({
      name: item.name,
      from: formatIls(item.previousCostAgorot ?? 0),
      to: formatIls(item.newCostAgorot),
    })),
  };
}

export class SummaryService {
  constructor(
    private readonly database: Database,
    private readonly reports: ReportService,
    private readonly notifications: AdminNotificationService,
    private readonly insightGenerator: () => InsightGenerator | null,
  ) {}

  async getFrequency(): Promise<SummaryFrequency> {
    const [row] = await this.database
      .select({ value: schema.storeSettings.value })
      .from(schema.storeSettings)
      .where(eq(schema.storeSettings.key, FREQUENCY_KEY))
      .limit(1);
    const parsed = z.enum(summaryFrequencies).safeParse(row?.value);
    return parsed.success ? parsed.data : DEFAULT_FREQUENCY;
  }

  async setFrequency(
    actor: AdminActor,
    frequency: SummaryFrequency,
  ): Promise<void> {
    assertPermission(actor, "settings.manage");
    if (!summaryFrequencies.includes(frequency)) {
      throw new Error("INVALID_FREQUENCY");
    }
    const now = new Date();
    await this.database
      .insert(schema.storeSettings)
      .values({
        key: FREQUENCY_KEY,
        value: frequency,
        updatedBy: actor.id,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.storeSettings.key,
        set: { value: frequency, updatedBy: actor.id, updatedAt: now },
      });
    await this.database.insert(schema.adminAuditEvents).values({
      adminUserId: actor.id,
      actionType: "settings_update",
      entityType: "store_settings",
      entityId: FREQUENCY_KEY,
      beforeState: null,
      afterState: { value: frequency },
    });
  }

  // Generates at most one summary per period; an existing archive row is never regenerated.
  async runScheduled(
    actor: AdminActor,
    today: string,
  ): Promise<{ generated: boolean; id: string | null }> {
    assertPermission(actor, "reports.view");
    const frequency = await this.getFrequency();
    if (frequency === "disabled") return { generated: false, id: null };
    const [last] = await this.database
      .select({ periodTo: schema.businessReports.periodTo })
      .from(schema.businessReports)
      .where(eq(schema.businessReports.kind, frequency))
      .orderBy(desc(schema.businessReports.periodTo))
      .limit(1);
    const due = dueSummaryPeriod({
      frequency,
      today,
      lastPeriodTo: last?.periodTo ?? null,
    });
    if (!due) return { generated: false, id: null };

    const period = { from: due.from, to: due.to };
    const report = await this.reports.getReport(actor, period);
    const headline = summaryHeadline({
      kind: due.kind,
      netSalesAgorot: report.metrics.netSalesAgorot,
      grossProfitAgorot: report.metrics.grossProfitAgorot,
      reorderCount: report.lowStock.length + report.outOfStock.length,
      costComplete: report.metrics.costComplete,
    });
    const { insight, model } = await this.tryInsight(report);

    // Publishing is deduplicated by key, so its delivery status can be stored with the archive row.
    const published = await this.notifications.publish({
      type: "business_summary",
      title: due.kind === "fortnightly" ? "ملخص 14 يوماً" : "الملخص الشهري",
      body: headline,
      href: "/admin/reports/archive",
      dedupeKey: `summary:${due.kind}:${due.from}:${due.to}`,
    });
    const [created] = await this.database
      .insert(schema.businessReports)
      .values({
        kind: due.kind,
        periodFrom: due.from,
        periodTo: due.to,
        metrics: report as unknown as Record<string, unknown>,
        headline: headline.slice(0, 240),
        insight,
        aiModel: insight ? model : null,
        promptVersion: insight ? INSIGHT_PROMPT_VERSION : null,
        notificationId: published.notificationId,
        pushStatus: published.pushStatus ?? "failed",
      })
      .onConflictDoNothing({
        target: [
          schema.businessReports.kind,
          schema.businessReports.periodFrom,
          schema.businessReports.periodTo,
        ],
      })
      .returning({ id: schema.businessReports.id });
    if (!created) return { generated: false, id: null };
    return { generated: true, id: created.id };
  }

  async generateInsight(
    actor: AdminActor,
    period: ReportPeriod,
  ): Promise<{ insight: BusinessInsight | null; model: string | null }> {
    assertPermission(actor, "reports.view");
    const report = await this.reports.getReport(actor, period);
    return this.tryInsight(report);
  }

  async list(actor: AdminActor): Promise<ArchivedSummary[]> {
    assertPermission(actor, "reports.view");
    const rows = await this.database
      .select({
        id: schema.businessReports.id,
        kind: schema.businessReports.kind,
        periodFrom: schema.businessReports.periodFrom,
        periodTo: schema.businessReports.periodTo,
        headline: schema.businessReports.headline,
        createdAt: schema.businessReports.createdAt,
        pushStatus: schema.businessReports.pushStatus,
      })
      .from(schema.businessReports)
      .orderBy(desc(schema.businessReports.periodTo))
      .limit(60);
    return rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async get(
    actor: AdminActor,
    id: string,
  ): Promise<ArchivedSummaryDetail | null> {
    assertPermission(actor, "reports.view");
    if (!z.uuid().safeParse(id).success) return null;
    const [row] = await this.database
      .select()
      .from(schema.businessReports)
      .where(eq(schema.businessReports.id, id))
      .limit(1);
    if (!row) return null;
    return {
      id: row.id,
      kind: row.kind,
      periodFrom: row.periodFrom,
      periodTo: row.periodTo,
      headline: row.headline,
      createdAt: row.createdAt.toISOString(),
      pushStatus: row.pushStatus,
      report: row.metrics as unknown as BusinessReport,
      insight: (row.insight as BusinessInsight | null) ?? null,
      aiModel: row.aiModel,
    };
  }

  // The AI text is optional decoration: any failure leaves the deterministic report intact.
  private async tryInsight(
    report: BusinessReport,
  ): Promise<{ insight: BusinessInsight | null; model: string | null }> {
    const generator = this.insightGenerator();
    if (!generator) return { insight: null, model: null };
    try {
      return {
        insight: await generator.generate(insightFacts(report)),
        model: generator.model,
      };
    } catch {
      return { insight: null, model: generator.model };
    }
  }
}
