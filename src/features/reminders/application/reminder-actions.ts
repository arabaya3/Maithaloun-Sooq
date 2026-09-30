"use server";

import { revalidatePath } from "next/cache";

import {
  reminderService,
  summaryService,
} from "@/features/admin/application/admin-services";
import { allowAdminRequest } from "@/features/admin/auth/admin-rate-limit";
import { requireTrustedAdminMutation } from "@/features/admin/auth/admin-session";
import { AuthorizationError } from "@/features/admin/domain/admin-actor";
import {
  summaryFrequencies,
  type SummaryFrequency,
} from "@/features/reminders/domain/schedule-constants";
import type { ReportPeriod } from "@/features/reports/domain/report-calculation";
import type { BusinessInsight } from "@/server/ai/insight-generator";
import { todayInStoreZone } from "@/shared/lib/store-time";

export type ReminderFormState = { ok: boolean; message: string } | null;

const text = (formData: FormData, name: string) =>
  String(formData.get(name) ?? "").trim();

function failure(error: unknown): ReminderFormState {
  return {
    ok: false,
    message:
      error instanceof AuthorizationError
        ? "ليست لديك صلاحية لهذا الإجراء."
        : "تعذّر حفظ التغيير. حاولي مجدداً.",
  };
}

export async function snoozeReminderAction(
  _previous: ReminderFormState,
  formData: FormData,
): Promise<ReminderFormState> {
  const actor = await requireTrustedAdminMutation();
  const customerId = text(formData, "customerId");
  const days = Number(text(formData, "days"));
  try {
    await reminderService.snooze(actor, {
      customerId,
      days,
      today: todayInStoreZone(),
    });
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`/admin/customers/${customerId}`);
  return {
    ok: true,
    message:
      days === 0 ? "أُعيد تفعيل التذكير." : `أُجّل التذكير ${days} أيام.`,
  };
}

export async function setDisputedAction(
  _previous: ReminderFormState,
  formData: FormData,
): Promise<ReminderFormState> {
  const actor = await requireTrustedAdminMutation();
  const customerId = text(formData, "customerId");
  const disputed = text(formData, "disputed") === "true";
  try {
    await reminderService.setDisputed(actor, {
      customerId,
      disputed,
      note: text(formData, "note"),
    });
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`/admin/customers/${customerId}`);
  return {
    ok: true,
    message: disputed
      ? "عُلّم الرصيد كمتنازع عليه وتوقفت التذكيرات."
      : "أُزيلت علامة النزاع.",
  };
}

export async function setSummaryFrequencyAction(
  _previous: ReminderFormState,
  formData: FormData,
): Promise<ReminderFormState> {
  const actor = await requireTrustedAdminMutation();
  const frequency = text(formData, "frequency");
  if (!(summaryFrequencies as readonly string[]).includes(frequency)) {
    return { ok: false, message: "اختاري موعداً صالحاً." };
  }
  try {
    await summaryService.setFrequency(actor, frequency as SummaryFrequency);
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/admin/settings");
  return { ok: true, message: "تم حفظ موعد الملخصات." };
}

export async function generateInsightAction(
  period: ReportPeriod,
): Promise<
  { ok: true; insight: BusinessInsight } | { ok: false; message: string }
> {
  const actor = await requireTrustedAdminMutation();
  if (!(await allowAdminRequest(actor, "admin_insight_ai", 20))) {
    return { ok: false, message: "طُلب الملخص مرات كثيرة. حاولي بعد قليل." };
  }
  try {
    const { insight } = await summaryService.generateInsight(actor, period);
    return insight
      ? { ok: true, insight }
      : {
          ok: false,
          message: "الملخص الذكي غير متاح الآن. الأرقام أعلاه كاملة.",
        };
  } catch (error) {
    return { ok: false, message: failure(error)!.message };
  }
}
