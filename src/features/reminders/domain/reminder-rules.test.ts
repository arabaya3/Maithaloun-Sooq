import { describe, expect, it } from "vitest";

import {
  dueSummaryPeriod,
  reminderDecision,
  reminderMessage,
  summaryHeadline,
  type ReminderInput,
} from "./reminder-rules";

const base: ReminderInput = {
  balanceAgorot: 3_500,
  oldestUnpaidDate: "2026-09-20",
  lastPaymentDate: null,
  lastRemindedOn: null,
  snoozedUntil: null,
  disputed: false,
  today: "2026-09-30",
};

describe("reminder eligibility", () => {
  it("is due five days after the debt started", () => {
    expect(reminderDecision({ ...base, today: "2026-09-24" })).toMatchObject({
      eligible: false,
      reason: "too_soon",
    });
    expect(reminderDecision({ ...base, today: "2026-09-25" })).toEqual({
      eligible: true,
      reason: "due",
      daysOutstanding: 5,
    });
  });

  it("waits five days after the last reminder or payment", () => {
    expect(
      reminderDecision({ ...base, lastRemindedOn: "2026-09-27" }).reason,
    ).toBe("too_soon");
    expect(
      reminderDecision({ ...base, lastRemindedOn: "2026-09-25" }).reason,
    ).toBe("due");
    expect(
      reminderDecision({
        ...base,
        lastRemindedOn: "2026-09-25",
        lastPaymentDate: "2026-09-28",
      }).reason,
    ).toBe("too_soon");
  });

  it("stops when the balance is settled, snoozed or disputed", () => {
    expect(reminderDecision({ ...base, balanceAgorot: 0 }).reason).toBe(
      "no_balance",
    );
    expect(
      reminderDecision({ ...base, snoozedUntil: "2026-10-05" }).reason,
    ).toBe("snoozed");
    expect(
      reminderDecision({ ...base, snoozedUntil: "2026-09-30" }).reason,
    ).toBe("due");
    expect(reminderDecision({ ...base, disputed: true }).reason).toBe(
      "disputed",
    );
  });

  it("writes the owner-facing message", () => {
    expect(reminderMessage("أحمد", 3_500, 10)).toBe(
      "أحمد ما زال عليه 35 ₪ منذ 10 أيام",
    );
  });
});

describe("scheduled summaries", () => {
  it("covers the last 14 full days and never repeats a period", () => {
    expect(
      dueSummaryPeriod({
        frequency: "fortnightly",
        today: "2026-09-30",
        lastPeriodTo: null,
      }),
    ).toEqual({ kind: "fortnightly", from: "2026-09-16", to: "2026-09-29" });
    expect(
      dueSummaryPeriod({
        frequency: "fortnightly",
        today: "2026-09-30",
        lastPeriodTo: "2026-09-29",
      }),
    ).toBeNull();
    expect(
      dueSummaryPeriod({
        frequency: "fortnightly",
        today: "2026-10-14",
        lastPeriodTo: "2026-09-29",
      }),
    ).toEqual({ kind: "fortnightly", from: "2026-09-30", to: "2026-10-13" });
  });

  it("covers the previous calendar month once", () => {
    expect(
      dueSummaryPeriod({
        frequency: "monthly",
        today: "2026-10-03",
        lastPeriodTo: null,
      }),
    ).toEqual({ kind: "monthly", from: "2026-09-01", to: "2026-09-30" });
    expect(
      dueSummaryPeriod({
        frequency: "monthly",
        today: "2026-10-20",
        lastPeriodTo: "2026-09-30",
      }),
    ).toBeNull();
    expect(
      dueSummaryPeriod({
        frequency: "disabled",
        today: "2026-10-20",
        lastPeriodTo: null,
      }),
    ).toBeNull();
  });

  it("builds the headline from computed figures and flags incomplete profit", () => {
    expect(
      summaryHeadline({
        kind: "fortnightly",
        netSalesAgorot: 142_000,
        grossProfitAgorot: 38_600,
        reorderCount: 3,
        costComplete: true,
      }),
    ).toBe(
      "تقرير آخر 14 يومًا جاهز: المبيعات 1,420 ₪، الربح الإجمالي 386 ₪، و3 منتجات تحتاج إعادة طلب.",
    );
    expect(
      summaryHeadline({
        kind: "monthly",
        netSalesAgorot: 0,
        grossProfitAgorot: 0,
        reorderCount: 0,
        costComplete: false,
      }),
    ).toContain("(غير مكتمل)");
  });
});
