"use server";

import { randomUUID } from "node:crypto";

import { redirect } from "next/navigation";
import { z } from "zod";

import { requireTrustedAdminMutation } from "@/features/admin/auth/admin-session";
import {
  AuthorizationError,
  assertOwnerActor,
} from "@/features/admin/domain/admin-actor";
import { MAX_CART_QUANTITY } from "@/features/cart/cart-store";
import { productIdSchema } from "@/features/catalog/domain/product";
import { variantDomainIdSchema } from "@/features/catalog/domain/product-variant";
import { ACTIVE_SERVICE_AREA_CODE } from "@/features/delivery/delivery-policy";
import {
  OrderCreationError,
  QA_ORDER_PHONE,
} from "@/features/orders/application/order-service";
import { orderService } from "@/features/orders/application/order-service-instance";
import type { CheckoutRequest } from "@/features/orders/domain/checkout-request";
import { db } from "@/server/db/db";
import { adminAuditEvents } from "@/server/db/schema";

export type QaOrderResult = { ok: false; message: string } | null;

const QA_ORDER_NAME = "طلب اختبار داخلي";
const QA_ORDER_ADDRESS = "طلب اختبار — لا يُوصَّل ولا يُحتسب";
const MAX_QA_LINES = 5;

const lineSchema = z.object({
  productId: productIdSchema,
  variantId: variantDomainIdSchema,
  quantity: z.number().int().min(1).max(MAX_CART_QUANTITY),
});

const failures: Record<OrderCreationError["code"], string> = {
  unknown_product: "أحد الأصناف غير موجود. حدّثي الصفحة.",
  unavailable_product: "أحد الأصناف غير متوفر أو غير منشور في المتجر.",
  selling_unit_changed: "لا توجد طريقة بيع بالحبة لهذا الصنف.",
  insufficient_stock: "الكمية أكبر من المخزون المتاح.",
  invalid_service_area: "منطقة التوصيل غير مفعّلة.",
  idempotency_conflict: "أُرسل الطلب مرتين. حدّثي الصفحة.",
  whatsapp_unavailable: "رقم واتساب المتجر غير محدد في الإعدادات.",
  database_error: "تعذّر إنشاء طلب الاختبار.",
};

// Owner-only: the order goes through the real pricing path but is never notified, queued, delivered or reported.
export async function createQaOrderAction(
  _state: QaOrderResult,
  formData: FormData,
): Promise<QaOrderResult> {
  const actor = await requireTrustedAdminMutation();
  try {
    assertOwnerActor(actor);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { ok: false, message: "طلبات الاختبار للمالك فقط." };
    }
    throw error;
  }

  const lines = [];
  for (let index = 0; index < MAX_QA_LINES; index += 1) {
    const key = String(formData.get(`variant-${index}`) ?? "");
    if (!key) continue;
    const [productId, variantId] = key.split("|");
    const parsed = lineSchema.safeParse({
      productId,
      variantId,
      quantity: Number(formData.get(`quantity-${index}`) ?? 1),
    });
    if (!parsed.success) {
      return { ok: false, message: "تحقّقي من الأصناف والكميات." };
    }
    lines.push(parsed.data);
  }
  const keys = new Set(lines.map((line) => line.variantId));
  if (!lines.length || keys.size !== lines.length) {
    return {
      ok: false,
      message: "اختاري صنفاً واحداً على الأقل، بدون تكرار.",
    };
  }

  const request: CheckoutRequest = {
    idempotencyKey: randomUUID(),
    customerName: QA_ORDER_NAME,
    whatsappCountryCode: "970",
    whatsappNationalNumber: "",
    whatsappPhoneE164: QA_ORDER_PHONE,
    serviceAreaCode: ACTIVE_SERVICE_AREA_CODE,
    deliveryAddress: QA_ORDER_ADDRESS,
    customerNote:
      String(formData.get("note") ?? "")
        .trim()
        .slice(0, 500) || undefined,
    paymentMethod: "cash_on_delivery",
    honeypot: "",
    items: lines,
    normalizedPhone: QA_ORDER_PHONE,
    address: QA_ORDER_ADDRESS,
    landmark: undefined,
    checkoutChannel: "web",
  };

  let reference: string;
  try {
    const created = await orderService.create(
      request,
      { customerAccountId: null },
      { test: true },
    );
    reference = created.publicReference;
  } catch (error) {
    if (error instanceof OrderCreationError) {
      return { ok: false, message: failures[error.code] };
    }
    throw error;
  }
  await db.insert(adminAuditEvents).values({
    adminUserId: actor.id,
    actionType: "qa_order_create",
    entityType: "order",
    entityId: reference,
    beforeState: null,
    afterState: { isTest: true, lines: lines.length },
  });
  redirect(`/admin/orders/${reference}?qa=created`);
}
