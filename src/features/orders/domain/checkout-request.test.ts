import { describe, expect, it } from "vitest";

import { checkoutRequestSchema } from "./checkout-request";

const validRequest = {
  idempotencyKey: "f3208b42-f864-47ca-b5b1-4b99842ec899",
  customerName: "عميل تجريبي",
  phone: "0591234567",
  serviceAreaCode: "maythalun",
  address: "عنوان محلي مفصل للاختبار",
  landmark: "",
  customerNote: "",
  paymentMethod: "cash_on_delivery",
  honeypot: "",
  items: [{ productId: "general-cleaner", quantity: 2 }],
};

describe("checkout request validation", () => {
  it("normalizes accepted input without accepting browser totals", () => {
    const parsed = checkoutRequestSchema.parse(validRequest);
    expect(parsed.normalizedPhone).toBe("+970591234567");
    expect(parsed.landmark).toBeUndefined();
    expect(parsed).not.toHaveProperty("itemsSubtotalAgorot");
  });

  it("enforces field lengths and quantity boundaries", () => {
    expect(
      checkoutRequestSchema
        .safeParse({
          ...validRequest,
          customerName: "",
        })
        .error?.flatten().fieldErrors.customerName?.[0],
    ).toBe("أدخل الاسم الكامل.");
    expect(
      checkoutRequestSchema.safeParse({
        ...validRequest,
        customerName: "x".repeat(101),
      }).success,
    ).toBe(false);
    expect(
      checkoutRequestSchema.safeParse({
        ...validRequest,
        address: "x".repeat(501),
      }).success,
    ).toBe(false);
    expect(
      checkoutRequestSchema.safeParse({
        ...validRequest,
        items: [{ productId: "general-cleaner", quantity: 10 }],
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate products, bad phones, and extra monetary fields", () => {
    expect(
      checkoutRequestSchema.safeParse({
        ...validRequest,
        items: [
          { productId: "general-cleaner", quantity: 1 },
          { productId: "general-cleaner", quantity: 2 },
        ],
      }).success,
    ).toBe(false);
    expect(
      checkoutRequestSchema.safeParse({
        ...validRequest,
        phone: "123",
      }).success,
    ).toBe(false);
    expect(
      checkoutRequestSchema.safeParse({
        ...validRequest,
        finalTotalAgorot: 1,
      }).success,
    ).toBe(false);
  });
});
