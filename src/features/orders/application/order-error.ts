import type { Locale } from "@/i18n/config";
import { messagesFor } from "@/i18n/messages";

import type { OrderCreationErrorCode } from "./order-service";

export interface SafeOrderError {
  status: number;
  message: string;
}

export function orderErrorMessages(locale: Locale = "ar") {
  return messagesFor(locale).orders.errors;
}

export function mapOrderCreationError(
  code: OrderCreationErrorCode,
  locale: Locale = "ar",
): SafeOrderError {
  const errors = orderErrorMessages(locale);
  if (code === "unknown_product") {
    return { status: 409, message: errors.unknownProduct };
  }
  if (code === "unavailable_product") {
    return { status: 409, message: errors.unavailableProduct };
  }
  if (code === "selling_unit_changed") {
    return { status: 409, message: errors.sellingUnitChanged };
  }
  if (code === "insufficient_stock") {
    return { status: 409, message: errors.insufficientStock };
  }
  if (code === "invalid_service_area") {
    return { status: 409, message: errors.invalidServiceArea };
  }
  if (code === "whatsapp_unavailable") {
    return { status: 409, message: errors.whatsAppUnavailable };
  }
  if (code === "idempotency_conflict") {
    return { status: 409, message: errors.idempotencyConflict };
  }
  return { status: 503, message: errors.saveFailed };
}

/** English for every Arabic message the checkout schema can return. */
export const checkoutFieldMessagesEn: Readonly<Record<string, string>> = {
  "الكمية غير صالحة.": "Invalid quantity.",
  "تجاوزت الكمية الحد المسموح.": "The quantity exceeds the allowed limit.",
  "تعذّر التحقق من محاولة الطلب.": "We couldn’t verify this order attempt.",
  "الاسم أطول من المسموح.": "The name is too long.",
  "أدخل الاسم الكامل.": "Enter your full name.",
  "اختر مفتاح الدولة.": "Choose a country code.",
  "أدخل رقم واتساب صالح.": "Enter a valid WhatsApp number.",
  "رقم الواتساب أطول من المسموح.": "The WhatsApp number is too long.",
  "العنوان أطول من المسموح.": "The address is too long.",
  "أدخل العنوان بالتفصيل أو أقرب نقطة دالة.":
    "Enter the full address or the nearest landmark.",
  "أقرب معلم أطول من المسموح.": "The landmark is too long.",
  "ملاحظة الطلب أطول من المسموح.": "The order note is too long.",
  "أضف منتجاً واحداً على الأقل.": "Add at least one product.",
  "تجاوزت السلة الحد المسموح.": "Your cart exceeds the allowed limit.",
  "التوصيل متاح حالياً داخل ميثلون فقط.":
    "Delivery is currently available within Maythaloun only.",
  "تحتوي السلة على منتجات مكررة.": "Your cart contains duplicate products.",
  "أدخل اسماً صالحاً.": "Enter a valid name.",
  "أدخل أقرب معلم كنص عادي فقط.": "Enter the landmark as plain text only.",
  "أدخل العنوان كنص عادي فقط.": "Enter the address as plain text only.",
  "رقم الواتساب غير صالح.": "Invalid WhatsApp number.",
};

const ARABIC_LETTERS = /[؀-ۿ]/;

/** Field errors stay as the schema wrote them in Arabic; English gets the mapped text. */
export function localizeCheckoutFieldErrors(
  fieldErrors: Record<string, string[] | undefined>,
  locale: Locale = "ar",
): Record<string, string[] | undefined> {
  if (locale === "ar") return fieldErrors;
  return Object.fromEntries(
    Object.entries(fieldErrors).map(([field, messages]) => [
      field,
      messages?.map(
        (message) =>
          checkoutFieldMessagesEn[message] ??
          (ARABIC_LETTERS.test(message) ? "Check this field." : message),
      ),
    ]),
  );
}
