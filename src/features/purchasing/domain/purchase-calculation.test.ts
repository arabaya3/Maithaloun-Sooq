import { describe, expect, it } from "vitest";

import {
  PurchaseCalculationError,
  calculatePurchase,
  printedTotalDifference,
  resolvePaymentStatus,
} from "./purchase-calculation";

const line = (
  quantityMilli: number,
  unitCostAgorot: number,
  packQuantity = 1,
  lineDiscountAgorot = 0,
) => ({ quantityMilli, unitCostAgorot, packQuantity, lineDiscountAgorot });

describe("purchase calculation", () => {
  it("totals lines and converts packs into stock units", () => {
    const totals = calculatePurchase({
      lines: [line(5_000, 4_000, 12), line(3_000, 250)],
      discountAgorot: 0,
      taxAgorot: null,
    });
    expect(totals.subtotalAgorot).toBe(20_750);
    expect(totals.totalAgorot).toBe(20_750);
    expect(totals.lines[0]).toEqual({
      stockQuantityMilli: 60_000,
      lineTotalAgorot: 20_000,
      costAgorot: 20_000,
      stockUnitCostAgorot: 333,
    });
    expect(totals.lines[1]?.stockUnitCostAgorot).toBe(250);
  });

  it("spreads the invoice discount so line costs add up to the total", () => {
    const totals = calculatePurchase({
      lines: [line(1_000, 1_000), line(1_000, 1_000), line(1_000, 1_000)],
      discountAgorot: 100,
      taxAgorot: null,
    });
    expect(totals.totalAgorot).toBe(2_900);
    const costs = totals.lines.map((item) => item.costAgorot);
    expect(costs.reduce((sum, value) => sum + value, 0)).toBe(2_900);
    expect(Math.max(...costs) - Math.min(...costs)).toBeLessThanOrEqual(1);
  });

  it("includes explicit tax in the stock cost", () => {
    const totals = calculatePurchase({
      lines: [line(2_000, 500)],
      discountAgorot: 0,
      taxAgorot: 160,
    });
    expect(totals.totalAgorot).toBe(1_160);
    expect(totals.lines[0]?.costAgorot).toBe(1_160);
    expect(totals.lines[0]?.stockUnitCostAgorot).toBe(580);
  });

  it("rejects discounts larger than their base", () => {
    expect(() =>
      calculatePurchase({
        lines: [line(1_000, 500, 1, 600)],
        discountAgorot: 0,
        taxAgorot: null,
      }),
    ).toThrow(PurchaseCalculationError);
    expect(() =>
      calculatePurchase({
        lines: [line(1_000, 500)],
        discountAgorot: 501,
        taxAgorot: null,
      }),
    ).toThrow(PurchaseCalculationError);
  });

  it("derives the payment status from the paid amount", () => {
    expect(resolvePaymentStatus(1_000, 1_000)).toBe("paid");
    expect(resolvePaymentStatus(1_000, 0)).toBe("unpaid");
    expect(resolvePaymentStatus(1_000, 400)).toBe("partially_paid");
    expect(() => resolvePaymentStatus(1_000, 1_001)).toThrow(
      PurchaseCalculationError,
    );
  });

  it("reports the difference from the printed total", () => {
    expect(printedTotalDifference(1_000, null)).toBeNull();
    expect(printedTotalDifference(1_000, 1_050)).toBe(-50);
  });
});
