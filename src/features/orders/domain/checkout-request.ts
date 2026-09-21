import { z } from "zod";

import { MAX_CART_QUANTITY } from "@/features/cart/cart-store";
import { productIdSchema } from "@/features/catalog/domain/product";
import { serviceAreaCodeSchema } from "@/features/delivery/service-area";

import { normalizePalestinianPhone } from "./phone";

const optionalTrimmedString = (maximumLength: number, tooLong: string) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().trim().max(maximumLength, tooLong).optional(),
  );

const checkoutItemSchema = z
  .object({
    productId: productIdSchema,
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
      .trim()
      .min(2, "أدخل الاسم الكامل.")
      .max(100, "الاسم أطول من المسموح."),
    phone: z
      .string()
      .trim()
      .min(7, "أدخل رقم هاتف فلسطيني صالح.")
      .max(32, "رقم الهاتف أطول من المسموح."),
    serviceAreaCode: serviceAreaCodeSchema,
    address: z
      .string()
      .trim()
      .min(5, "أدخل عنواناً تفصيلياً.")
      .max(500, "العنوان أطول من المسموح."),
    landmark: optionalTrimmedString(150, "أقرب معلم أطول من المسموح."),
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
    if (
      new Set(value.items.map((item) => item.productId)).size !==
      value.items.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "تحتوي السلة على منتجات مكررة.",
      });
    }
  })
  .transform((value, context) => {
    const normalizedPhone = normalizePalestinianPhone(value.phone);
    if (!normalizedPhone) {
      context.addIssue({
        code: "custom",
        path: ["phone"],
        message: "رقم الهاتف غير صالح.",
      });
      return z.NEVER;
    }
    return { ...value, normalizedPhone };
  });

export type CheckoutRequest = z.output<typeof checkoutRequestSchema>;
