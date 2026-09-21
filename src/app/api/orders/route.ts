import { NextResponse } from "next/server";

import { MAX_ORDER_REQUEST_BYTES } from "@/features/orders/application/order-submission-guard";
import { OrderCreationError } from "@/features/orders/application/order-service";
import { orderService } from "@/features/orders/application/order-service-instance";
import { mapOrderCreationError } from "@/features/orders/application/order-error";
import { checkoutRequestSchema } from "@/features/orders/domain/checkout-request";
import { createPostgresOrderSubmissionGuard } from "@/features/orders/infrastructure/postgres-order-submission-guard";
import { db } from "@/server/db/db";
import { getServerEnv } from "@/server/env/env";

export const dynamic = "force-dynamic";

const submissionGuard = createPostgresOrderSubmissionGuard(
  db,
  getServerEnv().ORDER_RATE_LIMIT_PEPPER,
);
const noStoreHeaders = { "Cache-Control": "no-store, max-age=0" };

function safeErrorResponse(
  message: string,
  status: number,
  fieldErrors?: Record<string, string[] | undefined>,
) {
  return NextResponse.json(
    { ok: false, message, fieldErrors },
    { status, headers: noStoreHeaders },
  );
}

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return safeErrorResponse("صيغة الطلب غير مدعومة.", 415);
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_ORDER_REQUEST_BYTES
  ) {
    return safeErrorResponse("حجم الطلب أكبر من المسموح.", 413);
  }

  const rawBody = await request.text();
  const requestSize = new TextEncoder().encode(rawBody).byteLength;
  if (requestSize > MAX_ORDER_REQUEST_BYTES) {
    return safeErrorResponse("حجم الطلب أكبر من المسموح.", 413);
  }

  let input: unknown;
  try {
    input = JSON.parse(rawBody);
  } catch {
    return safeErrorResponse("تعذّر قراءة بيانات الطلب.", 400);
  }

  const parsed = checkoutRequestSchema.safeParse(input);
  if (!parsed.success) {
    return safeErrorResponse(
      "يرجى مراجعة الحقول المطلوبة.",
      400,
      parsed.error.flatten().fieldErrors,
    );
  }

  const guardResult = await submissionGuard.check({
    idempotencyKey: parsed.data.idempotencyKey,
    honeypot: parsed.data.honeypot,
    requestSize,
  });
  if (!guardResult.allowed) {
    const status = guardResult.reason === "too_large" ? 413 : 429;
    return safeErrorResponse("تعذّر إرسال الطلب الآن. حاول لاحقاً.", status);
  }

  try {
    const confirmation = await orderService.create(parsed.data);
    return NextResponse.json(
      { ok: true, confirmation },
      {
        status: confirmation.duplicate ? 200 : 201,
        headers: noStoreHeaders,
      },
    );
  } catch (error) {
    if (error instanceof OrderCreationError) {
      const safeError = mapOrderCreationError(error.code);
      return safeErrorResponse(safeError.message, safeError.status);
    }

    return safeErrorResponse(
      "تعذّر حفظ الطلب الآن. لم يتم إنشاء طلب جديد.",
      503,
    );
  }
}
