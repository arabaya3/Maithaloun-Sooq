import { describe, expect, it } from "vitest";

import { checkoutRequestSchema } from "./checkout-request";

const validRequest = {
  idempotencyKey: "f3208b42-f864-47ca-b5b1-4b99842ec899",
  customerName: "  عميل   تجريبي  ",
  whatsappCountryCode: "970",
  whatsappNationalNumber: "0591234567",
  serviceAreaCode: "maythalun",
  deliveryAddress: "  شارع السوق،  ميثلون  ",
  customerNote: "",
  paymentMethod: "cash_on_delivery",
  honeypot: "",
  items: [{ productId: "general-cleaner", quantity: 2 }],
};

describe("checkout request validation", () => {
  it("normalizes accepted Arabic and Latin contact input", () => {
    const parsed = checkoutRequestSchema.parse(validRequest);
    expect(parsed.customerName).toBe("عميل تجريبي");
    expect(parsed.deliveryAddress).toBe("شارع السوق، ميثلون");
    expect(parsed.whatsappPhoneE164).toBe("+970591234567");
    expect(parsed.normalizedPhone).toBe("+970591234567");
    expect(parsed).not.toHaveProperty("itemsSubtotalAgorot");

    const latin = checkoutRequestSchema.parse({
      ...validRequest,
      customerName: "Sara Nasser",
      whatsappCountryCode: "972",
      whatsappNationalNumber: "٠٥٢١٢٣٤٥٦٧",
    });
    expect(latin.customerName).toBe("Sara Nasser");
    expect(latin.whatsappPhoneE164).toBe("+972521234567");
  });

  it("enforces field lengths and required address", () => {
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
      checkoutRequestSchema
        .safeParse({
          ...validRequest,
          deliveryAddress: "قصير",
        })
        .error?.flatten().fieldErrors.deliveryAddress?.[0],
    ).toBe("أدخل العنوان بالتفصيل أو أقرب نقطة دالة.");
    expect(
      checkoutRequestSchema.safeParse({
        ...validRequest,
        deliveryAddress: "x".repeat(501),
      }).success,
    ).toBe(false);
    expect(
      checkoutRequestSchema.safeParse({
        ...validRequest,
        items: [{ productId: "general-cleaner", quantity: 10 }],
      }).success,
    ).toBe(false);
  });

  it("rejects invalid phones, unsupported prefixes, and monetary fields", () => {
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
        whatsappNationalNumber: "123",
      }).success,
    ).toBe(false);
    expect(
      checkoutRequestSchema.safeParse({
        ...validRequest,
        whatsappCountryCode: "961",
      }).success,
    ).toBe(false);
    expect(
      checkoutRequestSchema.safeParse({
        ...validRequest,
        finalTotalAgorot: 1,
      }).success,
    ).toBe(false);
    expect(
      checkoutRequestSchema.safeParse({
        ...validRequest,
        deliveryAddress: "<script>alert(1)</script>",
      }).success,
    ).toBe(false);
  });
});
