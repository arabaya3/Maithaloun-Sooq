"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  supplierMaintenanceService,
  supplierService,
} from "@/features/admin/application/admin-services";
import { requireTrustedAdminMutation } from "@/features/admin/auth/admin-session";
import { AuthorizationError } from "@/features/admin/domain/admin-actor";
import { mapSupplierError } from "@/features/inventory/application/inventory-action-errors";
import { toLatinDigits } from "@/shared/lib/digits";
import { parseIlsToAgorot } from "@/shared/lib/parse-ils";

import { SupplierMaintenanceError } from "./supplier-maintenance-service";

export type SupplierFormState = { ok: boolean; message: string } | null;

const maintenanceMessages: Record<SupplierMaintenanceError["code"], string> = {
  not_found: "المورد غير موجود.",
  invalid_input: "تحقّقي من الحقول: المبلغ ورقم الإشعار والسبب.",
  same_supplier: "اختاري مورداً آخر.",
  in_use: "المورد مستخدم في سجلات سابقة.",
  merged: "هذا المورد مدموج في مورد آخر.",
  duplicate: "يوجد مورد بهذا الاسم.",
  exceeds_balance:
    "قيمة الإشعار أكبر من المستحق للمورد. سجّلي الفرق كتصحيح إذا كان المورد مديناً لك.",
};

function failure(error: unknown): { ok: false; message: string } {
  if (error instanceof SupplierMaintenanceError) {
    return { ok: false, message: maintenanceMessages[error.code] };
  }
  if (error instanceof AuthorizationError) {
    return { ok: false, message: "لا تملكين صلاحية هذا الإجراء." };
  }
  return { ok: false, message: mapSupplierError(error) };
}

function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

const supplierId = z.uuid();

function revalidateSupplier(id: string) {
  revalidatePath("/admin/inventory/suppliers");
  revalidatePath(`/admin/inventory/suppliers/${id}`);
}

export async function updateSupplierAction(
  _previous: SupplierFormState,
  formData: FormData,
): Promise<SupplierFormState> {
  const actor = await requireTrustedAdminMutation();
  const id = supplierId.safeParse(formData.get("supplierId"));
  if (!id.success) return { ok: false, message: maintenanceMessages.not_found };
  try {
    await supplierService.update(actor, {
      id: id.data,
      nameAr: text(formData, "nameAr"),
      phone: text(formData, "phone") || undefined,
      notes: text(formData, "notes") || undefined,
      active: formData.get("active") === "true",
    });
  } catch (error) {
    return failure(error);
  }
  revalidateSupplier(id.data);
  return { ok: true, message: "تم حفظ بيانات المورد." };
}

export async function setSupplierActiveAction(
  _previous: SupplierFormState,
  formData: FormData,
): Promise<SupplierFormState> {
  const actor = await requireTrustedAdminMutation();
  const id = supplierId.safeParse(formData.get("supplierId"));
  if (!id.success) return { ok: false, message: maintenanceMessages.not_found };
  const active = formData.get("active") === "true";
  try {
    await supplierMaintenanceService.setActive(actor, id.data, active);
  } catch (error) {
    return failure(error);
  }
  revalidateSupplier(id.data);
  return {
    ok: true,
    message: active ? "تمت استعادة المورد." : "تمت أرشفة المورد.",
  };
}

export async function recordSupplierCreditNoteAction(
  _previous: SupplierFormState,
  formData: FormData,
): Promise<SupplierFormState> {
  const actor = await requireTrustedAdminMutation();
  const id = supplierId.safeParse(formData.get("supplierId"));
  if (!id.success) return { ok: false, message: maintenanceMessages.not_found };
  const raw = toLatinDigits(text(formData, "amount"));
  const amountAgorot = raw ? parseIlsToAgorot(raw) : null;
  if (amountAgorot === null || amountAgorot <= 0) {
    return { ok: false, message: "أدخلي مبلغاً صالحاً بالشيكل." };
  }
  try {
    const result = await supplierMaintenanceService.creditNote(actor, {
      supplierId: id.data,
      amountAgorot,
      reference: text(formData, "reference"),
      reason: text(formData, "reason"),
      idempotencyKey: text(formData, "idempotencyKey"),
    });
    revalidateSupplier(id.data);
    return {
      ok: true,
      message: result.replayed
        ? "هذا الإشعار مسجّل مسبقاً."
        : "تم تسجيل الإشعار الدائن وخُصم من المستحق للمورد.",
    };
  } catch (error) {
    return failure(error);
  }
}
