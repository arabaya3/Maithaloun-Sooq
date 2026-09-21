import { AdminCatalogError } from "@/features/admin/application/admin-catalog-service";
import { AdminOrderError } from "@/features/admin/application/admin-order-service";

export function mapOrderAdminError(error: unknown): string {
  if (error instanceof AdminOrderError) {
    if (error.code === "invalid_transition") {
      return "لا يمكن نقل الطلب إلى هذه الحالة.";
    }
    if (error.code === "concurrency_conflict") {
      return "تم تعديل الطلب من جلسة أخرى. حدّث الصفحة ثم حاول مجدداً.";
    }
    if (error.code === "not_found") return "الطلب غير موجود.";
  }
  return "تعذّر تحديث حالة الطلب.";
}

export function mapProductAdminError(error: unknown): string {
  if (error instanceof AdminCatalogError) {
    if (error.code === "duplicate") {
      return "معرّف المنتج أو الرابط مستخدم مسبقاً.";
    }
    if (error.code === "not_found") return "المنتج غير موجود.";
  }
  return "تعذّر حفظ المنتج. راجع الحقول المطلوبة.";
}

export function mapDeliveryAdminError(error: unknown): string {
  void error;
  return "تعذّر حفظ منطقة التوصيل.";
}
