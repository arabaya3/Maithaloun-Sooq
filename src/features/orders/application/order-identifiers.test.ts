import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { checkoutRequestSchema } from "@/features/orders/domain/checkout-request";

vi.mock("server-only", () => ({}));

import {
  createOrderRequestFingerprint,
  generatePublicOrderReference,
} from "./order-identifiers";

const request = checkoutRequestSchema.parse({
  idempotencyKey: "f3208b42-f864-47ca-b5b1-4b99842ec899",
  customerName: "عميل تجريبي",
  whatsappCountryCode: "970",
  whatsappNationalNumber: "0591234567",
  serviceAreaCode: "maythalun",
  deliveryAddress: "عنوان محلي مفصل للاختبار",
  paymentMethod: "cash_on_delivery",
  honeypot: "",
  items: [
    {
      productId: "general-cleaner",
      variantId: "general-cleaner--default",
      quantity: 1,
    },
    {
      productId: "dolphin-bleach",
      variantId: "dolphin-bleach--default",
      quantity: 2,
    },
  ],
});

describe("order identifiers", () => {
  it("generates opaque high-entropy public references", () => {
    const first = generatePublicOrderReference();
    const second = generatePublicOrderReference();
    expect(first).toMatch(/^MS-[A-Za-z0-9_-]{24}$/);
    expect(second).toMatch(/^MS-[A-Za-z0-9_-]{24}$/);
    expect(first).not.toBe(second);
  });

  it("fingerprints material payload changes but ignores item order", () => {
    const reordered = {
      ...request,
      items: [...request.items].reverse(),
    };
    expect(createOrderRequestFingerprint(reordered)).toBe(
      createOrderRequestFingerprint(request),
    );
    expect(
      createOrderRequestFingerprint({
        ...request,
        deliveryAddress: "عنوان مختلف تماماً للاختبار",
      }),
    ).not.toBe(createOrderRequestFingerprint(request));
  });

  it("hashes requests without selling units exactly as before, so old retries still replay", () => {
    // The canonical payload used before selling units existed.
    const legacy = createHash("sha256")
      .update(
        JSON.stringify({
          customerName: request.customerName,
          whatsappPhoneE164: request.whatsappPhoneE164,
          serviceAreaCode: request.serviceAreaCode,
          deliveryAddress: request.deliveryAddress,
          customerNote: request.customerNote ?? null,
          paymentMethod: request.paymentMethod,
          items: [...request.items].sort((left, right) =>
            left.productId.localeCompare(right.productId),
          ),
        }),
      )
      .digest("hex");
    expect(createOrderRequestFingerprint(request)).toBe(legacy);
  });

  it("treats a different way of buying as a different request", () => {
    const withUnit = (sellingUnitId: string) => ({
      ...request,
      items: request.items.map((item) => ({ ...item, sellingUnitId })),
    });
    expect(
      createOrderRequestFingerprint(
        withUnit("11111111-1111-4111-8111-000000000001"),
      ),
    ).not.toBe(
      createOrderRequestFingerprint(
        withUnit("11111111-1111-4111-8111-000000000003"),
      ),
    );
  });
});

describe("landmark and WhatsApp in the fingerprint", () => {
  it("keeps the hash of requests without them, and changes it when they are used", () => {
    const plain = createOrderRequestFingerprint(request);
    expect(
      createOrderRequestFingerprint({ ...request, checkoutChannel: "web" }),
    ).toBe(plain);
    expect(
      createOrderRequestFingerprint({ ...request, landmark: "قرب المسجد" }),
    ).not.toBe(plain);
    expect(
      createOrderRequestFingerprint({
        ...request,
        checkoutChannel: "whatsapp",
      }),
    ).not.toBe(plain);
  });
});
