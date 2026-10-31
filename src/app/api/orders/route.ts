import { NextResponse } from "next/server";
import { after } from "next/server";

import { MAX_ORDER_REQUEST_BYTES } from "@/features/orders/application/order-submission-guard";
import { OrderCreationError } from "@/features/orders/application/order-service";
import { orderService } from "@/features/orders/application/order-service-instance";
import {
  localizeCheckoutFieldErrors,
  mapOrderCreationError,
  orderErrorMessages,
} from "@/features/orders/application/order-error";
import { checkoutRequestSchema } from "@/features/orders/domain/checkout-request";
import { createPostgresOrderSubmissionGuard } from "@/features/orders/infrastructure/postgres-order-submission-guard";
import { db } from "@/server/db/db";
import { getServerEnv } from "@/server/env/env";
import { lazyObject } from "@/server/lazy-object";
import { adminNotificationService } from "@/features/admin/application/admin-services";
import { getCustomerSession } from "@/features/accounts/application/customer-session";
import {
  CAMPAIGN_COOKIE,
  CampaignAttribution,
} from "@/features/social/application/campaign-attribution";
import { isLocale, LOCALE_HEADER, type Locale } from "@/i18n/config";

export const dynamic = "force-dynamic";

const submissionGuard = lazyObject(() =>
  createPostgresOrderSubmissionGuard(
    db,
    getServerEnv().ORDER_RATE_LIMIT_PEPPER,
  ),
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
  // The proxy skips /api, so the checkout form names its language itself.
  const requested = request.headers.get(LOCALE_HEADER);
  const locale: Locale = isLocale(requested) ? requested : "ar";
  const errors = orderErrorMessages(locale);

  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return safeErrorResponse(errors.unsupportedFormat, 415);
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_ORDER_REQUEST_BYTES
  ) {
    return safeErrorResponse(errors.tooLarge, 413);
  }

  const rawBody = await request.text();
  const requestSize = new TextEncoder().encode(rawBody).byteLength;
  if (requestSize > MAX_ORDER_REQUEST_BYTES) {
    return safeErrorResponse(errors.tooLarge, 413);
  }

  let input: unknown;
  try {
    input = JSON.parse(rawBody);
  } catch {
    return safeErrorResponse(errors.unreadable, 400);
  }

  const parsed = checkoutRequestSchema.safeParse(input);
  if (!parsed.success) {
    return safeErrorResponse(
      errors.reviewFields,
      400,
      localizeCheckoutFieldErrors(parsed.error.flatten().fieldErrors, locale),
    );
  }

  const guardResult = await submissionGuard.check({
    idempotencyKey: parsed.data.idempotencyKey,
    honeypot: parsed.data.honeypot,
    requestSize,
  });
  if (!guardResult.allowed) {
    const status = guardResult.reason === "too_large" ? 413 : 429;
    // Metadata only, never the request (no name, phone, cart or key): so a rejected checkout
    // can be traced in the logs.
    console.warn("order_submission_rejected", {
      reason: guardResult.reason,
      status,
      requestSize,
    });
    return safeErrorResponse(errors.tryLater, status);
  }

  try {
    const customer = await getCustomerSession();
    const confirmation = await orderService.create(parsed.data, {
      customerAccountId: customer?.id ?? null,
    });
    if (!confirmation.duplicate) {
      after(async () => {
        try {
          await adminNotificationService.dispatchOrderNotification(
            confirmation.publicReference,
          );
        } catch {
          // The durable in-app notification remains available if push delivery fails.
        }
      });
      // After the answer, apart from the order: a tracked campaign link links the order to its
      // campaign. Nothing about the order changes, and a failure here is invisible to the customer.
      const campaignCookie = (request.headers.get("cookie") ?? "")
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${CAMPAIGN_COOKIE}=`))
        ?.slice(CAMPAIGN_COOKIE.length + 1);
      if (campaignCookie) {
        after(async () => {
          try {
            await new CampaignAttribution(db).attributeOrder(
              confirmation.publicReference,
              decodeURIComponent(campaignCookie),
            );
          } catch {
            // Attribution is best effort; the order stands either way.
          }
        });
      }
    }
    return NextResponse.json(
      { ok: true, confirmation },
      {
        status: confirmation.duplicate ? 200 : 201,
        headers: noStoreHeaders,
      },
    );
  } catch (error) {
    if (error instanceof OrderCreationError) {
      const safeError = mapOrderCreationError(error.code, locale);
      return safeErrorResponse(safeError.message, safeError.status);
    }

    return safeErrorResponse(errors.saveFailed, 503);
  }
}
