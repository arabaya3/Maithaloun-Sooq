import { z } from "zod";

import { MAX_CART_QUANTITY } from "@/features/cart/cart-store";
import { productIdSchema } from "@/features/catalog/domain/product";
import { variantDomainIdSchema } from "@/features/catalog/domain/product-variant";
import { ACTIVE_SERVICE_AREA_CODE } from "@/features/delivery/delivery-policy";

import {
  isPlainDeliveryAddress,
  isValidCustomerFullName,
  normalizeContactWhitespace,
} from "./customer-contact";
import {
  WHATSAPP_COUNTRY_CODES,
  normalizeWhatsAppPhone,
  type WhatsAppCountryCode,
} from "./phone";

const optionalTrimmedString = (maximumLength: number, tooLong: string) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().trim().max(maximumLength, tooLong).optional(),
  );

const checkoutItemSchema = z
  .object({
    productId: productIdSchema,
    variantId: variantDomainIdSchema,
    quantity: z
      .number()
      .int()
      .min(1, "الكمية غير صالحة.")
      .max(MAX_CART_QUANTITY, "تجاوزت الكمية الحد المسموح."),
  })
  .strict();

export const checkoutRequestSchema = z
  .object({
    idempotencyKey: z.uuid({ error: "تعذّر التحقق من محاولة الطلب." }),
    customerName: z
      .string()
      .max(120, "الاسم أطول من المسموح.")
      .transform(normalizeContactWhitespace)
      .pipe(
        z
          .string()
          .min(2, "أدخل الاسم الكامل.")
          .max(100, "الاسم أطول من المسموح."),
      ),
    whatsappCountryCode: z.enum(WHATSAPP_COUNTRY_CODES, {
      error: "اختر مفتاح الدولة.",
    }),
    whatsappNationalNumber: z
      .string()
      .trim()
      .min(7, "أدخل رقم واتساب صالح.")
      .max(24, "رقم الواتساب أطول من المسموح."),
    serviceAreaCode: z
      .string()
      .optional()
      .transform((value) => value ?? ACTIVE_SERVICE_AREA_CODE),
    deliveryAddress: z
      .string()
      .max(600, "العنوان أطول من المسموح.")
      .transform(normalizeContactWhitespace)
      .pipe(
        z
          .string()
          .min(8, "أدخل العنوان بالتفصيل أو أقرب نقطة دالة.")
          .max(500, "العنوان أطول من المسموح."),
      ),
    customerNote: optionalTrimmedString(500, "ملاحظة الطلب أطول من المسموح."),
    paymentMethod: z.literal("cash_on_delivery"),
    honeypot: z.string().max(200).default(""),
    items: z
      .array(checkoutItemSchema)
      .min(1, "أضف منتجاً واحداً على الأقل.")
      .max(50, "تجاوزت السلة الحد المسموح."),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.serviceAreaCode !== ACTIVE_SERVICE_AREA_CODE) {
      context.addIssue({
        code: "custom",
        path: ["serviceAreaCode"],
        message: "التوصيل متاح حالياً داخل ميثلون فقط.",
      });
    }
    const keys = value.items.map(
      (item) => `${item.productId}::${item.variantId}`,
    );
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "تحتوي السلة على منتجات مكررة.",
      });
    }
    if (!isValidCustomerFullName(value.customerName)) {
      context.addIssue({
        code: "custom",
        path: ["customerName"],
        message: "أدخل اسماً صالحاً.",
      });
    }
    if (!isPlainDeliveryAddress(value.deliveryAddress)) {
      context.addIssue({
        code: "custom",
        path: ["deliveryAddress"],
        message: "أدخل العنوان كنص عادي فقط.",
      });
    }
  })
  .transform((value, context) => {
    const whatsappPhoneE164 = normalizeWhatsAppPhone(
      value.whatsappCountryCode as WhatsAppCountryCode,
      value.whatsappNationalNumber,
    );
    if (!whatsappPhoneE164) {
      context.addIssue({
        code: "custom",
        path: ["whatsappNationalNumber"],
        message: "رقم الواتساب غير صالح.",
      });
      return z.NEVER;
    }

    return {
      idempotencyKey: value.idempotencyKey,
      customerName: value.customerName,
      whatsappCountryCode: value.whatsappCountryCode,
      whatsappNationalNumber: value.whatsappNationalNumber,
      whatsappPhoneE164,
      serviceAreaCode: ACTIVE_SERVICE_AREA_CODE,
      deliveryAddress: value.deliveryAddress,
      customerNote: value.customerNote,
      paymentMethod: value.paymentMethod,
      honeypot: value.honeypot,
      items: value.items,
      normalizedPhone: whatsappPhoneE164,
      address: value.deliveryAddress,
      landmark: undefined as string | undefined,
    };
  });

export type CheckoutRequest = z.output<typeof checkoutRequestSchema>;
