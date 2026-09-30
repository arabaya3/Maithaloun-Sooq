export const pushDeliveryStatuses = [
  "sent",
  "failed",
  "no_subscribers",
  "not_configured",
] as const;
export type PushDeliveryStatus = (typeof pushDeliveryStatuses)[number];

export const businessReportKinds = ["fortnightly", "monthly"] as const;
export type BusinessReportKind = (typeof businessReportKinds)[number];

export const scheduledJobStatuses = ["running", "completed", "failed"] as const;

export const summaryFrequencies = [
  "fortnightly",
  "monthly",
  "disabled",
] as const;
export type SummaryFrequency = (typeof summaryFrequencies)[number];

export const summaryFrequencyLabels: Record<SummaryFrequency, string> = {
  fortnightly: "كل 14 يوماً",
  monthly: "شهرياً",
  disabled: "متوقف",
};

export const REMINDER_INTERVAL_DAYS = 5;
