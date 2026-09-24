import { describe, expect, it } from "vitest";

import {
  ACTIVE_SERVICE_AREA_CODE,
  amountUntilFreeDeliveryAgorot,
  calculateDeliveryFeeAgorot,
  FREE_DELIVERY_THRESHOLD_AGOROT,
  isActiveServiceAreaCode,
  STANDARD_DELIVERY_FEE_AGOROT,
} from "./delivery-policy";

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

  it("reports remaining amount until free delivery", () => {
    expect(amountUntilFreeDeliveryAgorot(2000)).toBe(3000);
    expect(amountUntilFreeDeliveryAgorot(5000)).toBe(0);
  });

  it("recognizes only ميثلون as the active area", () => {
    expect(isActiveServiceAreaCode(ACTIVE_SERVICE_AREA_CODE)).toBe(true);
    expect(isActiveServiceAreaCode("ramallah")).toBe(false);
  });
});
