import { describe, expect, it } from "vitest";

import {
  ACTIVE_SERVICE_AREA_CODE,
  amountUntilFreeDeliveryAgorot,
  calculateDeliveryFeeAgorot,
  FREE_DELIVERY_THRESHOLD_AGOROT,
  isActiveServiceAreaCode,
  STANDARD_DELIVERY_FEE_AGOROT,
} from "./delivery-policy";
import {
  getFreeDeliveryBanner,
  getFreeDeliveryMessage,
} from "./delivery-messaging";

describe("delivery policy", () => {
  it("charges standard fee below the free-delivery threshold", () => {
    expect(calculateDeliveryFeeAgorot(0)).toBe(STANDARD_DELIVERY_FEE_AGOROT);
    expect(calculateDeliveryFeeAgorot(4999)).toBe(STANDARD_DELIVERY_FEE_AGOROT);
  });

  it("is free at exactly 50 ₪ and above", () => {
    expect(calculateDeliveryFeeAgorot(FREE_DELIVERY_THRESHOLD_AGOROT)).toBe(0);
    expect(calculateDeliveryFeeAgorot(5001)).toBe(0);
    expect(calculateDeliveryFeeAgorot(12_500)).toBe(0);
  });

  it.each([
    [4999, STANDARD_DELIVERY_FEE_AGOROT, 1],
    [5000, 0, 0],
    [5001, 0, 0],
  ])(
    "at the 50 ₪ boundary a %i agorot subtotal pays %i agorot delivery",
    (subtotal, fee, remaining) => {
      expect(STANDARD_DELIVERY_FEE_AGOROT).toBe(500);
      expect(FREE_DELIVERY_THRESHOLD_AGOROT).toBe(5000);
      expect(calculateDeliveryFeeAgorot(subtotal)).toBe(fee);
      expect(amountUntilFreeDeliveryAgorot(subtotal)).toBe(remaining);
    },
  );

  it("reports remaining amount until free delivery", () => {
    expect(amountUntilFreeDeliveryAgorot(2000)).toBe(3000);
    expect(amountUntilFreeDeliveryAgorot(5000)).toBe(0);
  });

  it("recognizes only ميثلون as the active area", () => {
    expect(isActiveServiceAreaCode(ACTIVE_SERVICE_AREA_CODE)).toBe(true);
    expect(isActiveServiceAreaCode("ramallah")).toBe(false);
  });
});

describe("free delivery messages", () => {
  it("keeps Arabic by default and speaks English when asked", () => {
    expect(getFreeDeliveryMessage(1400)).toBe("أضف 36 ₪ لتحصل على توصيل مجاني");
    expect(getFreeDeliveryMessage(1400, "en")).toBe(
      "Add 36 ₪ more for free delivery",
    );
    expect(getFreeDeliveryMessage(FREE_DELIVERY_THRESHOLD_AGOROT, "en")).toBe(
      "You’ve unlocked free delivery",
    );
    expect(getFreeDeliveryBanner()).toBe(
      "توصيل مجاني للطلبات بقيمة 50 ₪ أو أكثر",
    );
  });
});
