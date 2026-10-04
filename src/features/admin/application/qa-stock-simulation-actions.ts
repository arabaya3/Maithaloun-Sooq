"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireTrustedAdminMutation } from "@/features/admin/auth/admin-session";

import { qaStockSimulation } from "./admin-services";
import {
  QaSimulationError,
  type QaSimulationResult,
} from "./qa-stock-simulation";

export type QaSimulationActionResult =
  { ok: true; result: QaSimulationResult } | { ok: false; message: string };

const messages: Record<QaSimulationError["code"], string> = {
  disabled: "محاكاة المخزون غير مفعّلة على هذا الخادم.",
  forbidden: "محاكاة المخزون للمالك فقط.",
  not_qa_owned: "يمكن تشغيل المحاكاة على صنف فحص QA مخصص فقط.",
  rate_limited: "وصلت للحد المسموح من المحاكاة هذه الساعة.",
  busy: "توجد محاكاة أخرى تعمل على هذا الصنف الآن.",
  invalid_token: "انتهت صلاحية طلب المحاكاة أو استُخدم. ابدئي من جديد.",
};

function failure(error: unknown): { ok: false; message: string } {
  if (error instanceof QaSimulationError) {
    return { ok: false, message: messages[error.code] };
  }
  return { ok: false, message: "تعذّر تشغيل المحاكاة." };
}

const variantId = z.string().regex(/^[a-z0-9-]{1,100}$/);

export async function createQaProbeAction(): Promise<
  { ok: true } | { ok: false; message: string }
> {
  const actor = await requireTrustedAdminMutation();
  try {
    await qaStockSimulation.ensureProbe(actor);
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/admin/orders/qa");
  return { ok: true };
}

// Issues a short-lived single-use token, then spends it immediately on the server.
export async function runQaStockSimulationAction(
  variantDomainId: string,
): Promise<QaSimulationActionResult> {
  const actor = await requireTrustedAdminMutation();
  const parsed = variantId.safeParse(variantDomainId);
  if (!parsed.success) return { ok: false, message: messages.not_qa_owned };
  try {
    const { token } = await qaStockSimulation.issue(actor, parsed.data);
    return { ok: true, result: await qaStockSimulation.run(actor, token) };
  } catch (error) {
    return failure(error);
  }
}
