"use server";

import { revalidatePath } from "next/cache";

import {
  inventoryService,
  purchaseService,
  supplierService,
} from "@/features/admin/application/admin-services";
import { requireTrustedAdminMutation } from "@/features/admin/auth/admin-session";
import {
  mapInventoryError,
  mapPurchaseError,
  mapSupplierError,
} from "@/features/inventory/application/inventory-action-errors";
import { parseQuantityToMilli } from "@/features/inventory/domain/quantity";
import {
  adjustmentReasons,
  stockUnits,
  type AdjustmentReason,
  type StockUnit,
} from "@/features/inventory/domain/stock-constants";
import type {
  PurchaseInput,
  PurchasePostResult,
  PurchasePreview,
} from "@/features/purchasing/application/purchase-service";
import { toLatinDigits } from "@/shared/lib/digits";
import { parseIlsToAgorot } from "@/shared/lib/parse-ils";

export type FormState = { ok: boolean; message: string } | null;
export type ActionResult<T> =
  ({ ok: true } & T) | { ok: false; message: string };

function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

function money(formData: FormData, name: string): number | null {
  const raw = toLatinDigits(text(formData, name));
  return raw ? parseIlsToAgorot(raw) : null;
}

function revalidateInventory() {
  revalidatePath("/admin");
  revalidatePath("/admin/inventory", "layout");
}

export async function adjustStockAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireTrustedAdminMutation();
  const reason = text(formData, "reason");
  const unit = text(formData, "unit");
  const quantityMilli = parseQuantityToMilli(text(formData, "quantity"));
  const costText = text(formData, "unitCost");
  const unitCostAgorot = money(formData, "unitCost");
  if (
    !(adjustmentReasons as readonly string[]).includes(reason) ||
    quantityMilli === null ||
    (costText && unitCostAgorot === null)
  ) {
    return { ok: false, message: "أدخلي كمية وسعراً صالحين." };
  }

  try {
    await inventoryService.adjust(actor, {
      idempotencyKey: text(formData, "idempotencyKey"),
      variantId: text(formData, "variantId"),
      reason: reason as AdjustmentReason,
      quantityMilli,
      unit: (stockUnits as readonly string[]).includes(unit)
        ? (unit as StockUnit)
        : undefined,
      unitCostAgorot: unitCostAgorot ?? undefined,
      note: text(formData, "note") || undefined,
    });
  } catch (error) {
    return { ok: false, message: mapInventoryError(error) };
  }
  revalidateInventory();
  return { ok: true, message: "تم حفظ تعديل المخزون." };
}

export async function setReorderThresholdAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireTrustedAdminMutation();
  const raw = text(formData, "threshold");
  const thresholdMilli = raw ? parseQuantityToMilli(raw) : null;
  if (raw && thresholdMilli === null) {
    return { ok: false, message: "أدخلي حد تنبيه صالحاً أو اتركيه فارغاً." };
  }
  try {
    await inventoryService.setReorderThreshold(actor, {
      variantId: text(formData, "variantId"),
      thresholdMilli,
    });
  } catch (error) {
    return { ok: false, message: mapInventoryError(error) };
  }
  revalidateInventory();
  return { ok: true, message: "تم حفظ حد التنبيه." };
}

export async function previewPurchaseAction(
  input: PurchaseInput,
): Promise<ActionResult<{ preview: PurchasePreview }>> {
  const actor = await requireTrustedAdminMutation();
  try {
    return { ok: true, preview: await purchaseService.preview(actor, input) };
  } catch (error) {
    return { ok: false, message: mapPurchaseError(error) };
  }
}

export async function postPurchaseAction(
  input: PurchaseInput,
): Promise<ActionResult<{ result: PurchasePostResult }>> {
  const actor = await requireTrustedAdminMutation();
  try {
    const result = await purchaseService.post(actor, input);
    revalidateInventory();
    return { ok: true, result };
  } catch (error) {
    return { ok: false, message: mapPurchaseError(error) };
  }
}

export async function createSupplierAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireTrustedAdminMutation();
  try {
    await supplierService.create(actor, {
      nameAr: text(formData, "nameAr"),
      phone: text(formData, "phone") || undefined,
      notes: text(formData, "notes") || undefined,
    });
  } catch (error) {
    return { ok: false, message: mapSupplierError(error) };
  }
  revalidateInventory();
  return { ok: true, message: "تمت إضافة المورد." };
}

export async function recordSupplierPaymentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireTrustedAdminMutation();
  const amountAgorot = money(formData, "amount");
  if (amountAgorot === null || amountAgorot <= 0) {
    return { ok: false, message: "أدخلي مبلغاً صالحاً بالشيكل." };
  }
  try {
    await supplierService.recordPayment(actor, {
      supplierId: text(formData, "supplierId"),
      amountAgorot,
      note: text(formData, "note") || undefined,
      idempotencyKey: text(formData, "idempotencyKey"),
    });
  } catch (error) {
    return { ok: false, message: mapSupplierError(error) };
  }
  revalidateInventory();
  return { ok: true, message: "تم تسجيل الدفعة للمورد." };
}
