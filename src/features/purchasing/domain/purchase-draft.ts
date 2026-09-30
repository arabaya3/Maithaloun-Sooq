import {
  formatQuantity,
  parseQuantityToMilli,
} from "@/features/inventory/domain/quantity";
import type { StockUnit } from "@/features/inventory/domain/stock-constants";
import { toLatinDigits } from "@/shared/lib/digits";
import {
  formatAgorotAsIlsInput,
  parseIlsToAgorot,
} from "@/shared/lib/parse-ils";

import {
  PurchaseCalculationError,
  calculatePurchase,
} from "./purchase-calculation";
import type { PurchaseSource } from "./purchase-constants";

export interface PurchaseLineDraft {
  key: string;
  variantId: string;
  quantity: string;
  unit: StockUnit;
  packQuantity: string;
  unitCost: string;
  lineDiscount: string;
  sourceText?: string;
  sourceLineNo?: number;
  confidence?: number | null;
  suggestions?: Array<{ variantId: string; label: string; score: number }>;
}

export type PaymentChoice = "paid" | "unpaid" | "partial";

export interface PurchaseDraft {
  supplierId: string;
  newSupplierName: string;
  reference: string;
  invoiceDate: string;
  lines: PurchaseLineDraft[];
  discount: string;
  tax: string;
  printedTotal: string;
  payment: PaymentChoice;
  paid: string;
  notes: string;
}

export interface PurchasePayload {
  idempotencyKey: string;
  supplierId?: string;
  supplierName?: string;
  reference?: string;
  invoiceDate: string;
  source: PurchaseSource;
  lines: Array<{
    variantId: string;
    unit: StockUnit;
    quantityMilli: number;
    packQuantity: number;
    unitCostAgorot: number;
    lineDiscountAgorot: number;
    sourceText?: string;
    sourceLineNo?: number;
  }>;
  discountAgorot: number;
  taxAgorot: number | null;
  printedTotalAgorot: number | null;
  paidAgorot: number;
  notes?: string;
  documentId?: string;
  extractionJobId?: string;
  acknowledgeDuplicate: boolean;
}

export type DraftErrors = Record<string, string>;

export const NEW_SUPPLIER = "__new__";

export function emptyPurchaseLine(): PurchaseLineDraft {
  return {
    key: crypto.randomUUID(),
    variantId: "",
    quantity: "",
    unit: "piece",
    packQuantity: "1",
    unitCost: "",
    lineDiscount: "",
  };
}

export function parseMoney(input: string): number | null {
  const value = toLatinDigits(input).trim();
  return value ? parseIlsToAgorot(value) : null;
}

function optionalMoney(
  input: string,
  field: string,
  errors: DraftErrors,
): number {
  if (!input.trim()) return 0;
  const value = parseMoney(input);
  if (value === null) {
    errors[field] = "أدخلي مبلغاً صالحاً بالشيكل.";
    return 0;
  }
  return value;
}

// Turns the free-text form into integer amounts; money is parsed once, here.
export function buildPurchasePayload(
  draft: PurchaseDraft,
  options: {
    idempotencyKey: string;
    source: PurchaseSource;
    acknowledgeDuplicate: boolean;
    documentId?: string;
    extractionJobId?: string;
  },
): { payload: PurchasePayload | null; errors: DraftErrors } {
  const errors: DraftErrors = {};

  const newSupplier = draft.supplierId === NEW_SUPPLIER;
  if (!draft.supplierId) errors.supplier = "اختاري المورد.";
  if (newSupplier && draft.newSupplierName.trim().length < 2) {
    errors.supplier = "اكتبي اسم المورد الجديد.";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.invoiceDate)) {
    errors.invoiceDate = "اختاري تاريخ الفاتورة.";
  }
  if (!draft.lines.length) errors.lines = "أضيفي صنفاً واحداً على الأقل.";

  const lines = draft.lines.map((line) => {
    const quantityMilli = parseQuantityToMilli(line.quantity);
    const unitCostAgorot = parseMoney(line.unitCost);
    const packQuantity = Number(toLatinDigits(line.packQuantity || "1"));
    if (!line.variantId) errors[`${line.key}.variantId`] = "اختاري المنتج.";
    if (quantityMilli === null || quantityMilli <= 0) {
      errors[`${line.key}.quantity`] = "أدخلي كمية أكبر من صفر.";
    }
    if (unitCostAgorot === null) {
      errors[`${line.key}.unitCost`] = "أدخلي سعر الشراء.";
    }
    if (
      !Number.isInteger(packQuantity) ||
      packQuantity < 1 ||
      packQuantity > 10_000
    ) {
      errors[`${line.key}.packQuantity`] = "عدد صحيح من 1 فأكثر.";
    }
    return {
      variantId: line.variantId,
      unit: line.unit,
      quantityMilli: quantityMilli ?? 0,
      packQuantity: Number.isInteger(packQuantity) ? packQuantity : 1,
      unitCostAgorot: unitCostAgorot ?? 0,
      lineDiscountAgorot: optionalMoney(
        line.lineDiscount,
        `${line.key}.lineDiscount`,
        errors,
      ),
      sourceText: line.sourceText?.slice(0, 280) || undefined,
      sourceLineNo: line.sourceLineNo,
    };
  });

  const discountAgorot = optionalMoney(draft.discount, "discount", errors);
  const taxAgorot = draft.tax.trim()
    ? optionalMoney(draft.tax, "tax", errors)
    : null;
  const printedTotalAgorot = draft.printedTotal.trim()
    ? optionalMoney(draft.printedTotal, "printedTotal", errors)
    : null;

  if (Object.keys(errors).length) return { payload: null, errors };

  let totalAgorot = 0;
  try {
    totalAgorot = calculatePurchase({
      lines,
      discountAgorot,
      taxAgorot,
    }).totalAgorot;
  } catch (error) {
    if (!(error instanceof PurchaseCalculationError)) throw error;
    if (error.code === "line_discount_exceeds_line") {
      const line = draft.lines[error.lineIndex ?? 0];
      if (line)
        errors[`${line.key}.lineDiscount`] = "الخصم أكبر من مجموع السطر.";
    } else {
      errors.discount = "الخصم أكبر من مجموع الفاتورة.";
    }
    return { payload: null, errors };
  }

  let paidAgorot = 0;
  if (draft.payment === "paid") {
    paidAgorot = totalAgorot;
  } else if (draft.payment === "partial") {
    const paid = parseMoney(draft.paid);
    if (paid === null || paid <= 0) {
      errors.paid = "أدخلي المبلغ المدفوع.";
    } else if (paid >= totalAgorot) {
      errors.paid = "المبلغ المدفوع جزئياً يجب أن يكون أقل من الإجمالي.";
    } else {
      paidAgorot = paid;
    }
  }

  if (Object.keys(errors).length) return { payload: null, errors };
  return {
    errors,
    payload: {
      idempotencyKey: options.idempotencyKey,
      supplierId: newSupplier ? undefined : draft.supplierId,
      supplierName: newSupplier ? draft.newSupplierName.trim() : undefined,
      reference: draft.reference.trim() || undefined,
      invoiceDate: draft.invoiceDate,
      source: options.source,
      lines,
      discountAgorot,
      taxAgorot,
      printedTotalAgorot,
      paidAgorot,
      notes: draft.notes.trim() || undefined,
      documentId: options.documentId,
      extractionJobId: options.extractionJobId,
      acknowledgeDuplicate: options.acknowledgeDuplicate,
    },
  };
}

export interface ExtractionDraftSource {
  header: {
    supplierName: string | null;
    supplierId: string | null;
    reference: string | null;
    invoiceDate: string | null;
    paymentStatus: "paid" | "unpaid" | "partially_paid" | null;
    paidAgorot: number | null;
    discountAgorot: number | null;
    taxAgorot: number | null;
    printedTotalAgorot: number | null;
  };
  lines: ReadonlyArray<{
    lineNo: number;
    status: string;
    variantId: string | null;
    confidence: number | null;
    candidates: ReadonlyArray<{
      variantId: string;
      label: string;
      score: number;
    }>;
    values: {
      name: string;
      size: string;
      unit: StockUnit;
      quantityMilli: number | null;
      unitCostAgorot: number | null;
    };
  }>;
}

const money = (agorot: number | null) =>
  agorot === null ? "" : formatAgorotAsIlsInput(agorot);

// Extracted values only pre-fill the form; nothing here selects an uncertain product.
export function draftFromExtraction(
  source: ExtractionDraftSource,
  today: string,
): PurchaseDraft {
  const { header } = source;
  return {
    supplierId: header.supplierId ?? (header.supplierName ? NEW_SUPPLIER : ""),
    newSupplierName: header.supplierId ? "" : (header.supplierName ?? ""),
    reference: header.reference ?? "",
    invoiceDate: header.invoiceDate ?? today,
    lines: source.lines
      .filter((line) => line.status !== "error" && line.status !== "ignored")
      .map((line) => ({
        key: `line-${line.lineNo}`,
        variantId: line.status === "matched" ? (line.variantId ?? "") : "",
        quantity:
          line.values.quantityMilli === null
            ? ""
            : formatQuantity(line.values.quantityMilli),
        unit: line.values.unit,
        packQuantity: "1",
        unitCost: money(line.values.unitCostAgorot),
        lineDiscount: "",
        sourceText: [line.values.name, line.values.size]
          .filter(Boolean)
          .join(" "),
        sourceLineNo: line.lineNo,
        confidence: line.confidence,
        suggestions:
          line.status === "matched" ? [] : [...line.candidates].slice(0, 4),
      })),
    discount: header.discountAgorot ? money(header.discountAgorot) : "",
    tax: header.taxAgorot ? money(header.taxAgorot) : "",
    printedTotal: money(header.printedTotalAgorot),
    payment:
      header.paymentStatus === "unpaid"
        ? "unpaid"
        : header.paymentStatus === "partially_paid"
          ? "partial"
          : "paid",
    paid:
      header.paymentStatus === "partially_paid" ? money(header.paidAgorot) : "",
    notes: "",
  };
}
