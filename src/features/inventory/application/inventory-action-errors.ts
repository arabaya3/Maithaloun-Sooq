import { AuthorizationError } from "@/features/admin/domain/admin-actor";
import { InventoryError } from "@/features/inventory/application/stock-ledger";
import { ExtractionError } from "@/features/purchasing/application/extraction-service";
import { PurchaseError } from "@/features/purchasing/application/purchase-service";
import { SupplierError } from "@/features/purchasing/application/supplier-service";

export const UNAUTHORIZED_MESSAGE = "ليست لديك صلاحية لهذا الإجراء.";

export function mapInventoryError(error: unknown): string {
  if (error instanceof AuthorizationError) return UNAUTHORIZED_MESSAGE;
  if (error instanceof InventoryError) {
    if (error.code === "insufficient_stock") {
      return "الكمية المتوفرة لا تكفي. قد تكون محجوزة لطلبات أو تغيّرت من جلسة أخرى.";
    }
    if (error.code === "cost_required") {
      return "أدخلي سعر شراء الوحدة لهذه الكمية.";
    }
    if (error.code === "untracked") {
      return "هذا المنتج غير متتبَّع بعد. سجّلي له شراءً أو رصيداً افتتاحياً أولاً.";
    }
    if (error.code === "not_found") return "المنتج غير موجود.";
    if (error.detail === "no_change") {
      return "الكمية المُدخلة مطابقة للمخزون الحالي.";
    }
  }
  return "تعذّر حفظ تعديل المخزون. راجعي الحقول وحاولي مجدداً.";
}

export function mapPurchaseError(error: unknown): string {
  if (error instanceof AuthorizationError) return UNAUTHORIZED_MESSAGE;
  if (error instanceof PurchaseError) {
    switch (error.code) {
      case "duplicate_invoice":
        return "هذه الفاتورة مسجّلة مسبقاً لنفس المورد.";
      case "possible_duplicate":
        return "توجد فاتورة مشابهة لنفس المورد والتاريخ والمبلغ. أكّدي أنها فاتورة مختلفة.";
      case "supplier_not_found":
        return "المورد غير موجود.";
      case "variant_not_found":
        return "أحد المنتجات غير موجود. اختاريه من القائمة من جديد.";
      case "line_discount_exceeds_line":
        return `خصم السطر ${error.detail ?? ""} أكبر من مجموعه.`;
      case "discount_exceeds_subtotal":
        return "الخصم أكبر من مجموع الفاتورة.";
      case "paid_exceeds_total":
        return "المبلغ المدفوع أكبر من إجمالي الفاتورة.";
      case "future_date":
        return "تاريخ الفاتورة لا يمكن أن يكون في المستقبل.";
      default:
        break;
    }
  }
  if (error instanceof InventoryError) return mapInventoryError(error);
  return "تعذّر حفظ الفاتورة. راجعي الحقول وحاولي مجدداً.";
}

export function mapSupplierError(error: unknown): string {
  if (error instanceof AuthorizationError) return UNAUTHORIZED_MESSAGE;
  if (error instanceof SupplierError) {
    if (error.code === "duplicate") return "يوجد مورد بهذا الاسم.";
    if (error.code === "not_found") return "المورد غير موجود.";
    if (error.code === "payment_exceeds_balance") {
      return "المبلغ أكبر من الرصيد المستحق للمورد.";
    }
  }
  return "تعذّر حفظ بيانات المورد. راجعي الاسم ورقم الهاتف.";
}

const extractionMessages: Record<ExtractionError["code"], string> = {
  invalid_input: "البيانات المُدخلة غير مكتملة. راجعي الأعمدة المطلوبة.",
  not_found: "الملف أو المراجعة غير موجودة.",
  not_reviewable: "هذه المراجعة أُغلقت مسبقاً.",
  multiple_invoices:
    "الملف يحتوي أكثر من مورد أو أكثر من رقم فاتورة. ارفعي كل فاتورة في ملف مستقل.",
  no_valid_rows: "لا توجد صفوف بيانات تحت صف العناوين المحدد.",
  too_large: "حجم الملف أكبر من المسموح (5MB).",
  empty: "الملف فارغ.",
  macros: "الملف يحتوي وحدات ماكرو. احفظيه بصيغة xlsx عادية ثم ارفعيه.",
  legacy_xls:
    "صيغة xls القديمة غير مدعومة. افتحي الملف واحفظيه بصيغة xlsx أو csv.",
  unsupported: "نوع الملف غير مدعوم. المسموح: xlsx أو csv.",
  too_many_rows: "عدد الصفوف أكبر من 1000. قسّمي الملف إلى أكثر من ملف.",
  unreadable: "تعذّرت قراءة الملف. تأكدي أنه xlsx سليم أو csv بترميز UTF-8.",
};

export function mapExtractionError(error: unknown): string {
  if (error instanceof AuthorizationError) return UNAUTHORIZED_MESSAGE;
  if (error instanceof ExtractionError) return extractionMessages[error.code];
  if (error instanceof PurchaseError || error instanceof InventoryError) {
    return mapPurchaseError(error);
  }
  if (error instanceof Error && error.message === "STORAGE_NOT_CONFIGURED") {
    return "تخزين الملفات غير مهيأ على الخادم بعد.";
  }
  return "تعذّرت معالجة الملف. حاولي مجدداً.";
}
