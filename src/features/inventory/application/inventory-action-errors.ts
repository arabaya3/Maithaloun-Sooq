import { AuthorizationError } from "@/features/admin/domain/admin-actor";
import { InventoryError } from "@/features/inventory/application/stock-ledger";
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
