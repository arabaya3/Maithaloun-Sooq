"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  readAdminSessionToken,
  requireTrustedAdminMutation,
} from "@/features/admin/auth/admin-session";
import { AuthorizationError } from "@/features/admin/domain/admin-actor";

import { adminNotificationService, adminStaffService } from "./admin-services";
import { StaffError } from "./admin-staff-service";

export type StaffActionResult = { ok: boolean; message: string } | null;

const staffMessages: Record<StaffError["code"], string> = {
  not_found: "الجلسة أو الحساب غير موجود. حدّثي الصفحة.",
  owner_protected: "حساب المالك لا يُوقف من هنا.",
  own_session: "هذا هو جهازك الحالي؛ استخدمي «تسجيل الخروج» بدلاً من ذلك.",
};

function failure(error: unknown): { ok: false; message: string } {
  if (error instanceof StaffError)
    return { ok: false, message: staffMessages[error.code] };
  if (error instanceof AuthorizationError)
    return { ok: false, message: "إدارة الحسابات للمالك فقط." };
  return { ok: false, message: "تعذّر التنفيذ. حاولي مرة أخرى." };
}

// The revoked row disappears on refresh, so the confirmation is shown at the top of the page.
function usersSaved(saved: string): never {
  revalidatePath("/admin/settings/users");
  redirect(`/admin/settings/users?saved=${saved}`);
}

export async function revokeSessionAction(
  _state: StaffActionResult,
  formData: FormData,
): Promise<StaffActionResult> {
  const actor = await requireTrustedAdminMutation();
  try {
    await adminStaffService.revokeSession(
      actor,
      String(formData.get("sessionId") ?? ""),
      await readAdminSessionToken(),
    );
  } catch (error) {
    return failure(error);
  }
  usersSaved("revoked");
}

export async function setOperatorActiveAction(
  _state: StaffActionResult,
  formData: FormData,
): Promise<StaffActionResult> {
  const actor = await requireTrustedAdminMutation();
  const active = formData.get("active") === "1";
  try {
    await adminStaffService.setOperatorActive(
      actor,
      String(formData.get("userId") ?? ""),
      active,
    );
  } catch (error) {
    return failure(error);
  }
  usersSaved(active ? "enabled" : "disabled");
}

export async function markAllNotificationsReadAction(): Promise<void> {
  const actor = await requireTrustedAdminMutation();
  await adminNotificationService.markAllRead(actor);
  revalidatePath("/admin", "layout");
}
