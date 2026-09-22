import "server-only";

import { createHash, randomBytes } from "node:crypto";

import type { CheckoutRequest } from "@/features/orders/domain/checkout-request";

export function generatePublicOrderReference(): string {
  return `MS-${randomBytes(18).toString("base64url")}`;
}

export function createOrderRequestFingerprint(
  request: CheckoutRequest,
): string {
  const canonicalPayload = {
    customerName: request.customerName,
    whatsappPhoneE164: request.whatsappPhoneE164,
    serviceAreaCode: request.serviceAreaCode,
    deliveryAddress: request.deliveryAddress,
    customerNote: request.customerNote ?? null,
    paymentMethod: request.paymentMethod,
    items: [...request.items].sort((left, right) =>
      left.productId.localeCompare(right.productId),
    ),
  };

  return createHash("sha256")
    .update(JSON.stringify(canonicalPayload))
    .digest("hex");
}
