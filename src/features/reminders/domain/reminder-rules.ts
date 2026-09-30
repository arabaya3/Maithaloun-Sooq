import { formatIls } from "@/shared/lib/format-currency";
import { addDays, daysBetween } from "@/shared/lib/store-time";

import {
  REMINDER_INTERVAL_DAYS,
  type BusinessReportKind,
  type SummaryFrequency,
} from "./schedule-constants";

export type ReminderReason =
  "due" | "no_balance" | "disputed" | "snoozed" | "too_soon";

export interface ReminderInput {
  balanceAgorot: number;
  oldestUnpaidDate: string | null;
  lastPaymentDate: string | null;
  lastRemindedOn: string | null;
  snoozedUntil: string | null;
  disputed: boolean;
  today: string;
}

// A reminder is due every five days counted from the latest of: the debt's start,
// the last payment, or the last reminder. A zero balance, a snooze or a dispute stops it.
export function reminderDecision(input: ReminderInput): {
  eligible: boolean;
  reason: ReminderReason;
  daysOutstanding: number;
} {
  const daysOutstanding = input.oldestUnpaidDate
    ? Math.max(0, daysBetween(input.oldestUnpaidDate, input.today))
    : 0;
  const result = (reason: ReminderReason) => ({
    eligible: reason === "due",
    reason,
    daysOutstanding,
  });
  if (input.balanceAgorot <= 0 || !input.oldestUnpaidDate) {
    return result("no_balance");
  }
  if (input.disputed) return result("disputed");
  if (input.snoozedUntil && input.snoozedUntil > input.today) {
    return result("snoozed");
  }
  const anchor = [
    input.oldestUnpaidDate,
    input.lastPaymentDate,
    input.lastRemindedOn,
  ]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1)!;
  return result(
    daysBetween(anchor, input.today) >= REMINDER_INTERVAL_DAYS
      ? "due"
      : "too_soon",
  );
}

export function reminderMessage(
  name: string,
  balanceAgorot: number,
  daysOutstanding: number,
): string {
  return `${name} ما زال عليه ${formatIls(balanceAgorot)} منذ ${daysOutstanding} أيام`;
}

export function dueSummaryPeriod(input: {
  frequency: SummaryFrequency;
  today: string;
  lastPeriodTo: string | null;
}): { kind: BusinessReportKind; from: string; to: string } | null {
  const yesterday = addDays(input.today, -1);
  if (input.frequency === "fortnightly") {
    if (input.lastPeriodTo && daysBetween(input.lastPeriodTo, yesterday) < 14) {
      return null;
    }
    return {
      kind: "fortnightly",
      from: addDays(yesterday, -13),
      to: yesterday,
    };
  }
  if (input.frequency === "monthly") {
    const firstOfThisMonth = `${input.today.slice(0, 8)}01`;
    const to = addDays(firstOfThisMonth, -1);
    if (input.lastPeriodTo && input.lastPeriodTo >= to) return null;
    return { kind: "monthly", from: `${to.slice(0, 8)}01`, to };
  }
  return null;
}

export function summaryHeadline(input: {
  kind: BusinessReportKind;
  netSalesAgorot: number;
  grossProfitAgorot: number;
  reorderCount: number;
  costComplete: boolean;
}): string {
  const label =
    input.kind === "fortnightly" ? "تقرير آخر 14 يومًا" : "التقرير الشهري";
  const profit = `${input.costComplete ? "الربح الإجمالي" : "الربح الإجمالي (غير مكتمل)"} ${formatIls(input.grossProfitAgorot)}`;
  return `${label} جاهز: المبيعات ${formatIls(input.netSalesAgorot)}، ${profit}، و${input.reorderCount} منتجات تحتاج إعادة طلب.`;
}
