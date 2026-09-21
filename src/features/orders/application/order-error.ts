import type { OrderCreationErrorCode } from "./order-service";

export interface SafeOrderError {
  status: number;
  message: string;
}

export function mapOrderCreationError(
  code: OrderCreationErrorCode,
): SafeOrderError {
  if (code === "unknown_product") {
    return {
      status: 409,
      message: "تحتوي السلة على منتج لم يعد متاحاً. حدّث السلة وحاول مجدداً.",
    };
  }
  if (code === "unavailable_product") {
    return {
      status: 409,
      message: "أحد المنتجات غير متاح حالياً. عدّل السلة وحاول مجدداً.",
    };
  }
  if (code === "invalid_service_area") {
    return {
      status: 409,
      message: "منطقة التوصيل المحددة غير متاحة حالياً.",
    };
  }
  if (code === "idempotency_conflict") {
    return {
      status: 409,
      message: "تعذّر إعادة استخدام محاولة الطلب. ابدأ محاولة جديدة.",
    };
  }
  return {
    status: 503,
    message: "تعذّر حفظ الطلب الآن. لم يتم إنشاء طلب جديد.",
  };
}
