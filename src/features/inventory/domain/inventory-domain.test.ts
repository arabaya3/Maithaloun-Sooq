import { describe, expect, it } from "vitest";

import {
  InsufficientStockError,
  averageCostAgorot,
  issueStock,
  receiveStock,
} from "./costing";
import { compareCostToSalePrice, unitMargin } from "./pricing";
import { formatQuantity, parseQuantityToMilli } from "./quantity";
import { availableMilli, resolveStockStatus } from "./stock-status";

describe("quantities", () => {
  it("parses whole and decimal quantities into thousandths", () => {
    expect(parseQuantityToMilli("2")).toBe(2_000);
    expect(parseQuantityToMilli("1.5")).toBe(1_500);
    expect(parseQuantityToMilli("0,25")).toBe(250);
    expect(parseQuantityToMilli("٣")).toBe(3_000);
    expect(parseQuantityToMilli("1.2345")).toBeNull();
    expect(parseQuantityToMilli("-1")).toBeNull();
    expect(parseQuantityToMilli("abc")).toBeNull();
  });

  it("formats thousandths without trailing zeros", () => {
    expect(formatQuantity(2_000)).toBe("2");
    expect(formatQuantity(1_500)).toBe("1.5");
    expect(formatQuantity(-250)).toBe("-0.25");
  });
});

describe("weighted average cost", () => {
  it("blends receipts by quantity", () => {
    let state = { onHandMilli: 0, valueAgorot: 0 };
    state = receiveStock(state, 10_000, 5_000);
    expect(averageCostAgorot(state)).toBe(500);
    state = receiveStock(state, 10_000, 7_000);
    expect(state).toEqual({ onHandMilli: 20_000, valueAgorot: 12_000 });
    expect(averageCostAgorot(state)).toBe(600);
  });

  it("issues stock at the average and keeps the average unchanged", () => {
    const start = { onHandMilli: 20_000, valueAgorot: 12_000 };
    const { state, costAgorot } = issueStock(start, 5_000);
    expect(costAgorot).toBe(3_000);
    expect(state).toEqual({ onHandMilli: 15_000, valueAgorot: 9_000 });
    expect(averageCostAgorot(state)).toBe(600);
  });

  it("leaves no residual value after the last unit is issued", () => {
    let state = { onHandMilli: 3_000, valueAgorot: 1_000 };
    let cogs = 0;
    for (let index = 0; index < 3; index += 1) {
      const result = issueStock(state, 1_000);
      cogs += result.costAgorot;
      state = result.state;
    }
    expect(cogs).toBe(1_000);
    expect(state).toEqual({ onHandMilli: 0, valueAgorot: 0 });
    expect(averageCostAgorot(state)).toBeNull();
  });

  it("rejects issuing more than the balance", () => {
    expect(() =>
      issueStock({ onHandMilli: 1_000, valueAgorot: 500 }, 2_000),
    ).toThrow(InsufficientStockError);
  });
});

describe("stock status", () => {
  it("subtracts reservations from availability", () => {
    expect(availableMilli({ onHandMilli: 5_000, reservedMilli: 2_000 })).toBe(
      3_000,
    );
  });

  it("classifies out, low and ok", () => {
    const base = { onHandMilli: 5_000, reservedMilli: 0 };
    expect(resolveStockStatus({ ...base, reorderThresholdMilli: 5_000 })).toBe(
      "low",
    );
    expect(resolveStockStatus({ ...base, reorderThresholdMilli: 4_000 })).toBe(
      "ok",
    );
    expect(resolveStockStatus({ ...base, reorderThresholdMilli: null })).toBe(
      "ok",
    );
    expect(
      resolveStockStatus({
        onHandMilli: 2_000,
        reservedMilli: 2_000,
        reorderThresholdMilli: null,
      }),
    ).toBe("out");
  });
});

describe("cost and sale price comparison", () => {
  it("computes unit profit and margin deterministically", () => {
    expect(unitMargin(1_000, 750)).toEqual({
      profitAgorot: 250,
      marginBasisPoints: 2_500,
    });
  });

  it("flags a loss, a thin margin and a cost increase", () => {
    expect(
      compareCostToSalePrice({
        previousCostAgorot: 700,
        newCostAgorot: 1_100,
        salePriceAgorot: 1_000,
      }).advice,
    ).toBe("loss");
    expect(
      compareCostToSalePrice({
        previousCostAgorot: 900,
        newCostAgorot: 950,
        salePriceAgorot: 1_000,
      }).advice,
    ).toBe("thin_margin");
    const increase = compareCostToSalePrice({
      previousCostAgorot: 500,
      newCostAgorot: 600,
      salePriceAgorot: 1_000,
    });
    expect(increase.advice).toBe("cost_increase");
    expect(increase.costChangeBasisPoints).toBe(2_000);
    expect(
      compareCostToSalePrice({
        previousCostAgorot: null,
        newCostAgorot: 600,
        salePriceAgorot: 1_000,
      }),
    ).toMatchObject({ advice: "ok", costChangeBasisPoints: null });
  });
});
