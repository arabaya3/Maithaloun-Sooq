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
  if (code === "selling_unit_changed") {
    return {
      status: 409,
      message:
        "تغيّرت طريقة شراء أحد المنتجات. راجع السلة واختر طريقة شراء متاحة.",
    };
  }
  if (code === "insufficient_stock") {
    return {
      status: 409,
      message:
        "الكمية المطلوبة من أحد المنتجات أكبر من المتوفر حالياً. قلّل العدد وحاول مجدداً.",
    };
  }
  if (code === "invalid_service_area") {
    return {
      status: 409,
      message: "منطقة التوصيل المحددة غير متاحة حالياً.",
    };
  }
  if (code === "whatsapp_unavailable") {
    return {
      status: 409,
      message: "الطلب عبر واتساب غير متاح الآن. أكمل الطلب من الموقع مباشرة.",
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
