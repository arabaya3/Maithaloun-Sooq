import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  AuthorizationError,
  type AdminActor,
} from "@/features/admin/domain/admin-actor";
import { AdminNotificationService } from "@/features/admin/notifications/notification-service";
import { InventoryService } from "@/features/inventory/application/inventory-service";
import { ReminderService } from "@/features/reminders/application/reminder-service";
import { ScheduledJobs } from "@/features/reminders/application/scheduled-jobs";
import { SummaryService } from "@/features/reminders/application/summary-service";
import { ReportService } from "@/features/reports/application/report-service";
import { CustomerService } from "@/features/sales/application/customer-service";
import { SalesService } from "@/features/sales/application/sales-service";
import { addDays, todayInStoreZone } from "@/shared/lib/store-time";
import type { InsightGenerator } from "@/server/ai/insight-generator";
import {
  adminNotifications,
  businessReports,
  customerReminders,
  scheduledJobRuns,
} from "@/server/db/schema";
import {
  resetTestDatabase,
  testDatabaseConnection,
} from "@/test/test-database";

import {
  OPERATIONS_TABLES,
  createOperatorActor,
  createOwnerActor,
} from "./support";

const { db, client } = testDatabaseConnection;
const salesService = new SalesService(db);
const customerService = new CustomerService(db);
const notifications = new AdminNotificationService(db);
const reminderService = new ReminderService(db, customerService, notifications);
const reportService = new ReportService(
  db,
  customerService,
  new InventoryService(db),
);
let insightCalls = 0;
const insight: InsightGenerator = {
  model: "test-insight",
  async generate(facts) {
    insightCalls += 1;
    // Customer names must never reach the model.
    expect(JSON.stringify(facts)).not.toContain("زبون مدين");
    return {
      whatHappened: "ملخص",
      whyItMatters: "سبب",
      needsAttention: [],
      suggestions: ["اقتراح"],
    };
  },
};
const summaryService = new SummaryService(
  db,
  reportService,
  notifications,
  () => insight,
);
const jobs = new ScheduledJobs(db, reminderService, summaryService);

let owner: AdminActor;
let operator: AdminActor;
const today = todayInStoreZone();

async function debtor(name = "زبون مدين") {
  const sale = await salesService.post(owner, {
    idempotencyKey: crypto.randomUUID(),
    customerName: name,
    source: "manual",
    lines: [
      {
        variantId: "dolphin-bleach--default",
        quantityMilli: 1_000,
        unitPriceAgorot: 3_500,
      },
    ],
    discountAgorot: 0,
    paidAgorot: 0,
  });
  return sale.customerId!;
}

beforeAll(async () => {
  await resetTestDatabase();
  owner = await createOwnerActor();
  operator = await createOperatorActor();
});

beforeEach(async () => {
  await client.unsafe(`TRUNCATE TABLE ${OPERATIONS_TABLES.join(", ")} CASCADE`);
  insightCalls = 0;
});

describe("unpaid-balance reminders", () => {
  it("notifies the staff after five days and links to the customer ledger", async () => {
    const customerId = await debtor();
    expect(await reminderService.runDaily(owner, addDays(today, 4))).toEqual({
      checked: 1,
      sent: 0,
    });

    const dueDay = addDays(today, 5);
    expect(await reminderService.runDaily(owner, dueDay)).toEqual({
      checked: 1,
      sent: 1,
    });
    const [notification] = await db.select().from(adminNotifications);
    expect(notification).toMatchObject({
      type: "debt_reminder",
      body: "زبون مدين ما زال عليه 35 ₪ منذ 5 أيام",
      href: `/admin/customers/${customerId}`,
    });
    const [reminder] = await db.select().from(customerReminders);
    expect(reminder).toMatchObject({
      reminderDate: dueDay,
      balanceAgorot: 3_500,
      daysOutstanding: 5,
      pushStatus: "not_configured",
      notificationId: notification!.id,
    });
  });

  it("does not duplicate a reminder on a retried run and waits five more days", async () => {
    await debtor();
    const dueDay = addDays(today, 5);
    await reminderService.runDaily(owner, dueDay);
    expect((await reminderService.runDaily(owner, dueDay)).sent).toBe(0);
    expect(
      (await reminderService.runDaily(owner, addDays(dueDay, 4))).sent,
    ).toBe(0);
    expect(
      (await reminderService.runDaily(owner, addDays(dueDay, 5))).sent,
    ).toBe(1);
    expect(await db.select().from(customerReminders)).toHaveLength(2);
    expect(await db.select().from(adminNotifications)).toHaveLength(2);
  });

  it("stops when the balance reaches zero", async () => {
    const customerId = await debtor();
    await salesService.recordPayment(owner, {
      customerId,
      amountAgorot: 3_500,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(await reminderService.runDaily(owner, addDays(today, 30))).toEqual({
      checked: 0,
      sent: 0,
    });
  });

  it("respects snooze and dispute, which the operator may set", async () => {
    const customerId = await debtor();
    await reminderService.snooze(operator, { customerId, days: 7, today });
    expect(
      (await reminderService.runDaily(owner, addDays(today, 6))).sent,
    ).toBe(0);
    await reminderService.setDisputed(operator, {
      customerId,
      disputed: true,
      note: "يقول إنه دفع",
    });
    expect(
      (await reminderService.runDaily(owner, addDays(today, 20))).sent,
    ).toBe(0);
    const view = await reminderService.getView(operator, customerId);
    expect(view).toMatchObject({ disputed: true, disputeNote: "يقول إنه دفع" });

    await reminderService.setDisputed(operator, {
      customerId,
      disputed: false,
    });
    await reminderService.snooze(operator, { customerId, days: 0, today });
    expect(
      (await reminderService.runDaily(owner, addDays(today, 20))).sent,
    ).toBe(1);
    await expect(
      reminderService.snooze(
        { ...operator, active: false },
        { customerId, days: 7, today },
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("scheduled daily job", () => {
  it("runs once per day and archives one summary per period", async () => {
    await debtor();
    const runDay = addDays(today, 5);
    const first = await jobs.runDaily(runDay);
    expect(first).toMatchObject({
      status: "completed",
      reminders: { checked: 1, sent: 1 },
      summaryGenerated: true,
    });
    expect(await jobs.runDaily(runDay)).toEqual({ status: "skipped" });

    const reports = await db.select().from(businessReports);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      kind: "fortnightly",
      periodFrom: addDays(runDay, -14),
      periodTo: addDays(runDay, -1),
      aiModel: "test-insight",
    });
    expect(reports[0]?.headline).toContain("تقرير آخر 14 يومًا جاهز");
    expect(insightCalls).toBe(1);

    // The next day is a new run, but the same fortnight is not regenerated.
    const next = await jobs.runDaily(addDays(runDay, 1));
    expect(next).toMatchObject({
      status: "completed",
      summaryGenerated: false,
    });
    expect(await db.select().from(businessReports)).toHaveLength(1);
    expect(insightCalls).toBe(1);

    const [run] = await db
      .select()
      .from(scheduledJobRuns)
      .where(eq(scheduledJobRuns.runDate, runDay));
    expect(run?.status).toBe("completed");

    const archive = await summaryService.list(owner);
    expect(archive).toHaveLength(1);
    const detail = await summaryService.get(owner, archive[0]!.id);
    expect(detail?.insight?.suggestions).toEqual(["اقتراح"]);
    expect(detail?.report.metrics.netSalesAgorot).toBe(3_500);
    await expect(summaryService.list(operator)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it("honours the disabled and monthly preferences", async () => {
    await summaryService.setFrequency(owner, "disabled");
    expect(await summaryService.runScheduled(owner, today)).toEqual({
      generated: false,
      id: null,
    });
    await summaryService.setFrequency(owner, "monthly");
    const result = await summaryService.runScheduled(owner, today);
    expect(result.generated).toBe(true);
    const [report] = await db.select().from(businessReports);
    expect(report?.kind).toBe("monthly");
    expect(report?.periodTo).toBe(addDays(`${today.slice(0, 8)}01`, -1));
    await expect(
      summaryService.setFrequency(operator, "disabled"),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
