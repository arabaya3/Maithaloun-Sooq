import { AuthorizationError } from "@/features/admin/domain/admin-actor";
import { CustomerError } from "@/features/sales/application/customer-service";
import { SalesError } from "@/features/sales/application/sales-service";

const UNAUTHORIZED = "ليست لديك صلاحية لهذا الإجراء.";

export function mapSalesError(error: unknown): string {
  if (error instanceof AuthorizationError) return UNAUTHORIZED;
  if (error instanceof SalesError) {
    switch (error.code) {
      case "insufficient_stock":
        return error.detail
          ? `الكمية المتوفرة لا تكفي: ${error.detail}. راجعي المخزون أو عدّلي الكمية.`
          : "الكمية المتوفرة في المخزون لا تكفي.";
      case "customer_not_found":
        return "الزبون غير موجود.";
      case "variant_not_found":
        return "أحد المنتجات غير موجود. اختاريه من القائمة من جديد.";
      case "discount_exceeds_subtotal":
        return "الخصم أكبر من مجموع الفاتورة.";
      case "paid_exceeds_total":
        return "المبلغ المدفوع أكبر من إجمالي الفاتورة.";
      case "cash_sale_must_be_paid":
        return "البيع بالدَّين يحتاج اسم الزبون.";
      case "payment_exceeds_balance":
        return "المبلغ أكبر من رصيد الزبون المستحق.";
      case "already_cancelled":
        return "هذه الفاتورة ملغاة مسبقاً.";
      case "already_reversed":
        return "هذه الدفعة عُكست مسبقاً.";
      case "not_found":
        return "السجل غير موجود.";
      default:
        if (error.detail === "duplicate_line") {
          return "يوجد منتج مكرر في الفاتورة. اجمعي الكمية في سطر واحد.";
        }
    }
  }
  return "تعذّر حفظ العملية. راجعي الحقول وحاولي مجدداً.";
}

export function mapCustomerError(error: unknown): string {
  if (error instanceof AuthorizationError) return UNAUTHORIZED;
  if (error instanceof CustomerError) {
    if (error.code === "duplicate") return "يوجد زبون أو لقب بهذا الاسم.";
    if (error.code === "invalid_phone") {
      return "رقم الهاتف غير صالح. مثال: 0591234567";
    }
    if (error.code === "not_found") return "الزبون غير موجود.";
  }
  return "تعذّر حفظ بيانات الزبون. راجعي الاسم.";
}
