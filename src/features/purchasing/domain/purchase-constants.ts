export const paymentStatuses = ["paid", "unpaid", "partially_paid"] as const;
export type PurchasePaymentStatus = (typeof paymentStatuses)[number];

export const paymentStatusLabels: Record<PurchasePaymentStatus, string> = {
  paid: "مدفوعة",
  unpaid: "غير مدفوعة",
  partially_paid: "مدفوعة جزئياً",
};

export const purchaseSources = [
  "manual",
  "excel",
  "ai_capture",
  "voice",
] as const;
export type PurchaseSource = (typeof purchaseSources)[number];

export const purchaseSourceLabels: Record<PurchaseSource, string> = {
  manual: "إدخال يدوي",
  excel: "ملف Excel",
  ai_capture: "تصوير فاتورة",
  voice: "أمر صوتي",
};

export const supplierLedgerEntryTypes = [
  "purchase",
  "payment",
  "correction",
] as const;

export const documentKinds = [
  "invoice_image",
  "invoice_pdf",
  "spreadsheet",
] as const;
export type DocumentKind = (typeof documentKinds)[number];

export const extractionJobKinds = [
  "purchase_invoice_ai",
  "purchase_excel",
] as const;
export type ExtractionJobKind = (typeof extractionJobKinds)[number];

export const extractionJobStatuses = [
  "processing",
  "needs_review",
  "confirmed",
  "discarded",
  "failed",
] as const;
export type ExtractionJobStatus = (typeof extractionJobStatuses)[number];

export const extractionLineStatuses = [
  "matched",
  "suggested",
  "unmatched",
  "new_product",
  "ignored",
  "error",
] as const;
export type ExtractionLineStatus = (typeof extractionLineStatuses)[number];

export const extractionMatchMethods = [
  "barcode",
  "sku",
  "exact_name",
  "supplier_alias",
  "fuzzy",
  "manual",
] as const;
export type ExtractionMatchMethod = (typeof extractionMatchMethods)[number];

export const priceReviewStatuses = [
  "pending",
  "kept",
  "price_changed",
  "later",
] as const;
export type PriceReviewStatus = (typeof priceReviewStatuses)[number];
