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
  phone: "0591234567",
  serviceAreaCode: "maythalun",
  address: "عنوان محلي مفصل للاختبار",
  paymentMethod: "cash_on_delivery",
  honeypot: "",
  items: [
    { productId: "general-cleaner", quantity: 1 },
    { productId: "dolphin-bleach", quantity: 2 },
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
        address: "عنوان مختلف تماماً للاختبار",
      }),
    ).not.toBe(createOrderRequestFingerprint(request));
  });
});
