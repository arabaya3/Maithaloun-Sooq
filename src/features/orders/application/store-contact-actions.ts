"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireTrustedAdminMutation } from "@/features/admin/auth/admin-session";
import { AuthorizationError } from "@/features/admin/domain/admin-actor";

import { WHATSAPP_COUNTRY_CODES } from "../domain/phone";
import { storeContactService } from "./order-service-instance";
import { StoreContactError } from "./store-contact-service";

export type StoreWhatsAppResult =
  { ok: true; message: string } | { ok: false; message: string } | null;

export async function saveStoreWhatsAppAction(
  _state: StoreWhatsAppResult,
  formData: FormData,
): Promise<StoreWhatsAppResult> {
  const actor = await requireTrustedAdminMutation();
  const countryCode = z
    .enum(WHATSAPP_COUNTRY_CODES)
    .safeParse(formData.get("countryCode"));
  const nationalNumber = z
    .string()
    .max(24)
    .safeParse(formData.get("nationalNumber") ?? "");
  if (!countryCode.success || !nationalNumber.success) {
    return { ok: false, message: "اكتبي رقم واتساب صالحاً." };
  }
  try {
    const saved = await storeContactService.setWhatsAppNumber(actor, {
      countryCode: countryCode.data,
      nationalNumber: nationalNumber.data,
    });
    revalidatePath("/admin/settings");
    revalidatePath("/checkout");
    return {
      ok: true,
      message: saved
        ? "حُفظ رقم واتساب المتجر. يظهر خيار الطلب عبر واتساب للزبائن."
        : "أُوقف الطلب عبر واتساب.",
    };
  } catch (error) {
    if (error instanceof StoreContactError) {
      return {
        ok: false,
        message: "الرقم غير صالح. اكتبي رقم جوال يبدأ بـ 05.",
      };
    }
    if (error instanceof AuthorizationError) {
      return { ok: false, message: "هذا الإجراء للمالك فقط." };
    }
    return { ok: false, message: "تعذّر الحفظ. حاولي مرة أخرى." };
  }
}
