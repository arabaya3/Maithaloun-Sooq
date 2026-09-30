import {
  formatQuantity,
  parseQuantityToMilli,
} from "@/features/inventory/domain/quantity";
import { toLatinDigits } from "@/shared/lib/digits";
import {
  formatAgorotAsIlsInput,
  parseIlsToAgorot,
} from "@/shared/lib/parse-ils";

import type { SaleSource } from "./customer-balance";
import { SaleCalculationError, calculateSale } from "./sale-calculation";

export type SaleCustomerMode = "cash" | "existing" | "new";
export type SalePaymentChoice = "paid" | "unpaid" | "partial";

export interface SaleLineDraft {
  key: string;
  variantId: string;
  quantity: string;
  unitPrice: string;
  spokenText?: string;
}

export interface SaleDraft {
  customerMode: SaleCustomerMode;
  customerId: string;
  newCustomerName: string;
  lines: SaleLineDraft[];
  discount: string;
  payment: SalePaymentChoice;
  paid: string;
  note: string;
}

export interface SalePayload {
  idempotencyKey: string;
  customerId?: string;
  customerName?: string;
  source: SaleSource;
  lines: Array<{
    variantId: string;
    quantityMilli: number;
    unitPriceAgorot: number;
  }>;
  discountAgorot: number;
  paidAgorot: number;
  note?: string;
}

export type SaleDraftErrors = Record<string, string>;

export function emptySaleLine(): SaleLineDraft {
  return {
    key: crypto.randomUUID(),
    variantId: "",
    quantity: "1",
    unitPrice: "",
  };
}

export function emptySaleDraft(): SaleDraft {
  return {
    customerMode: "cash",
    customerId: "",
    newCustomerName: "",
    lines: [emptySaleLine()],
    discount: "",
    payment: "paid",
    paid: "",
    note: "",
  };
}

export function saleLineFrom(input: {
  variantId: string;
  quantityMilli: number;
  unitPriceAgorot: number;
  spokenText?: string;
}): SaleLineDraft {
  return {
    key: crypto.randomUUID(),
    variantId: input.variantId,
    quantity: formatQuantity(input.quantityMilli),
    unitPrice: formatAgorotAsIlsInput(input.unitPriceAgorot),
    spokenText: input.spokenText,
  };
}

export function parseSaleMoney(input: string): number | null {
  const value = toLatinDigits(input).trim();
  return value ? parseIlsToAgorot(value) : null;
}

export function buildSalePayload(
  draft: SaleDraft,
  options: { idempotencyKey: string; source: SaleSource },
): { payload: SalePayload | null; errors: SaleDraftErrors } {
  const errors: SaleDraftErrors = {};
  if (draft.customerMode === "existing" && !draft.customerId) {
    errors.customer = "اختاري الزبون.";
  }
  if (draft.customerMode === "new" && draft.newCustomerName.trim().length < 2) {
    errors.customer = "اكتبي اسم الزبون.";
  }

  const seen = new Set<string>();
  const lines = draft.lines.map((line) => {
    const quantityMilli = parseQuantityToMilli(line.quantity);
    const unitPriceAgorot = parseSaleMoney(line.unitPrice);
    if (!line.variantId) {
      errors[`${line.key}.variantId`] = "اختاري المنتج.";
    } else if (seen.has(line.variantId)) {
      errors[`${line.key}.variantId`] =
        "هذا المنتج مكرر. عدّلي الكمية بدلاً من ذلك.";
    }
    seen.add(line.variantId);
    if (quantityMilli === null || quantityMilli <= 0) {
      errors[`${line.key}.quantity`] = "أدخلي كمية أكبر من صفر.";
    }
    if (unitPriceAgorot === null) {
      errors[`${line.key}.unitPrice`] = "أدخلي سعر البيع.";
    }
    return {
      variantId: line.variantId,
      quantityMilli: quantityMilli ?? 0,
      unitPriceAgorot: unitPriceAgorot ?? 0,
    };
  });
  if (!lines.length) errors.lines = "أضيفي منتجاً واحداً على الأقل.";

  let discountAgorot = 0;
  if (draft.discount.trim()) {
    const discount = parseSaleMoney(draft.discount);
    if (discount === null) errors.discount = "أدخلي خصماً صالحاً.";
    else discountAgorot = discount;
  }
  if (Object.keys(errors).length) return { payload: null, errors };

  const hasCustomer = draft.customerMode !== "cash";
  let paidAgorot = 0;
  try {
    const full = calculateSale({
      lines,
      discountAgorot,
      paidAgorot: 0,
      hasCustomer: true,
    });
    if (draft.payment === "paid") {
      paidAgorot = full.totalAgorot;
    } else if (draft.payment === "partial") {
      const paid = parseSaleMoney(draft.paid);
      if (paid === null || paid <= 0) {
        errors.paid = "أدخلي المبلغ المدفوع.";
      } else if (paid >= full.totalAgorot) {
        errors.paid = "المبلغ المدفوع جزئياً يجب أن يكون أقل من الإجمالي.";
      } else {
        paidAgorot = paid;
      }
    }
    if (!hasCustomer && draft.payment !== "paid") {
      errors.customer = "البيع بالدَّين يحتاج اسم الزبون.";
    }
  } catch (error) {
    if (!(error instanceof SaleCalculationError)) throw error;
    errors.discount = "الخصم أكبر من مجموع الفاتورة.";
  }
  if (Object.keys(errors).length) return { payload: null, errors };

  return {
    errors,
    payload: {
      idempotencyKey: options.idempotencyKey,
      customerId:
        draft.customerMode === "existing" ? draft.customerId : undefined,
      customerName:
        draft.customerMode === "new" ? draft.newCustomerName.trim() : undefined,
      source: options.source,
      lines,
      discountAgorot,
      paidAgorot,
      note: draft.note.trim() || undefined,
    },
  };
}
