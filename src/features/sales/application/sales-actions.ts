"use server";

import { revalidatePath } from "next/cache";

import {
  customerService,
  salesService,
} from "@/features/admin/application/admin-services";
import { requireTrustedAdminMutation } from "@/features/admin/auth/admin-session";
import {
  mapCustomerError,
  mapSalesError,
} from "@/features/sales/application/sales-action-errors";
import type {
  SaleInput,
  SalePostResult,
  SalePreview,
} from "@/features/sales/application/sales-service";
import { toLatinDigits } from "@/shared/lib/digits";
import { parseIlsToAgorot } from "@/shared/lib/parse-ils";

export type SalesFormState = { ok: boolean; message: string } | null;
type Result<T> = ({ ok: true } & T) | { ok: false; message: string };

function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

function revalidateSales(customerId?: string | null) {
  revalidatePath("/admin");
  revalidatePath("/admin/sales", "layout");
  revalidatePath("/admin/customers", "layout");
  revalidatePath("/admin/inventory", "layout");
  if (customerId) revalidatePath(`/admin/customers/${customerId}`);
}

export async function previewSaleAction(
  input: SaleInput,
): Promise<Result<{ preview: SalePreview }>> {
  const actor = await requireTrustedAdminMutation();
  try {
    return { ok: true, preview: await salesService.preview(actor, input) };
  } catch (error) {
    return { ok: false, message: mapSalesError(error) };
  }
}

export async function postSaleAction(
  input: SaleInput,
): Promise<Result<{ result: SalePostResult }>> {
  const actor = await requireTrustedAdminMutation();
  try {
    const result = await salesService.post(actor, input);
    revalidateSales(result.customerId);
    return { ok: true, result };
  } catch (error) {
    return { ok: false, message: mapSalesError(error) };
  }
}

export async function recordCustomerPaymentAction(
  _previous: SalesFormState,
  formData: FormData,
): Promise<SalesFormState> {
  const actor = await requireTrustedAdminMutation();
  const amountAgorot = parseIlsToAgorot(
    toLatinDigits(text(formData, "amount")),
  );
  if (amountAgorot === null || amountAgorot <= 0) {
    return { ok: false, message: "أدخلي مبلغاً صالحاً بالشيكل." };
  }
  const customerId = text(formData, "customerId");
  try {
    await salesService.recordPayment(actor, {
      customerId,
      amountAgorot,
      note: text(formData, "note") || undefined,
      idempotencyKey: text(formData, "idempotencyKey"),
    });
  } catch (error) {
    return { ok: false, message: mapSalesError(error) };
  }
  revalidateSales(customerId);
  return { ok: true, message: "تم تسجيل الدفعة." };
}

export async function reversePaymentAction(
  _previous: SalesFormState,
  formData: FormData,
): Promise<SalesFormState> {
  const actor = await requireTrustedAdminMutation();
  try {
    await salesService.reversePayment(actor, {
      paymentId: text(formData, "paymentId"),
      reason: text(formData, "reason"),
    });
  } catch (error) {
    return { ok: false, message: mapSalesError(error) };
  }
  revalidateSales(text(formData, "customerId"));
  return { ok: true, message: "تم عكس الدفعة بقيد تصحيحي." };
}

export async function cancelInvoiceAction(
  _previous: SalesFormState,
  formData: FormData,
): Promise<SalesFormState> {
  const actor = await requireTrustedAdminMutation();
  try {
    await salesService.cancelInvoice(actor, {
      invoiceId: text(formData, "invoiceId"),
      reason: text(formData, "reason"),
    });
  } catch (error) {
    return { ok: false, message: mapSalesError(error) };
  }
  revalidateSales(text(formData, "customerId") || null);
  return { ok: true, message: "أُلغيت الفاتورة وأُعيدت البضاعة إلى المخزون." };
}

export async function saveCustomerAction(
  _previous: SalesFormState,
  formData: FormData,
): Promise<SalesFormState> {
  const actor = await requireTrustedAdminMutation();
  const id = text(formData, "id");
  const input = {
    name: text(formData, "name"),
    phone: text(formData, "phone") || undefined,
    notes: text(formData, "notes") || undefined,
  };
  try {
    if (id) {
      await customerService.update(actor, {
        ...input,
        id,
        alias: text(formData, "alias") || undefined,
      });
    } else {
      await customerService.create(actor, input);
    }
  } catch (error) {
    return { ok: false, message: mapCustomerError(error) };
  }
  revalidateSales(id || null);
  return { ok: true, message: "تم حفظ بيانات الزبون." };
}
