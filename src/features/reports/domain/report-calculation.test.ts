import { describe, expect, it } from "vitest";

import { addDays, daysBetween, startOfStoreDay } from "@/shared/lib/store-time";

import {
  buildReport,
  resolvePeriod,
  type SaleFact,
} from "./report-calculation";

const totals = {
  cashCollectedAgorot: 0,
  creditSalesAgorot: 0,
  outstandingBalancesAgorot: 0,
  purchasesAgorot: 0,
  inventoryValueAgorot: 10_000,
  shrinkageAgorot: 0,
};

function fact(overrides: Partial<SaleFact>): SaleFact {
  return {
    channel: "manual",
    documentId: "doc-1",
    date: "2026-09-10",
    productKey: "cleaner",
    name: "منظف عام",
    quantityMilli: 1_000,
    grossAgorot: 1_000,
    discountAgorot: 0,
    cogsAgorot: 600,
    ...overrides,
  };
}

const period = { from: "2026-09-01", to: "2026-09-30" };

describe("report calculation", () => {
  it("derives net sales, COGS, gross profit and margin from recorded facts", () => {
    const report = buildReport({
      period,
      sales: [
        fact({ grossAgorot: 2_000, discountAgorot: 200, cogsAgorot: 1_200 }),
        fact({
          documentId: "doc-2",
          channel: "storefront",
          productKey: "bleach",
          name: "مبيض",
          quantityMilli: 3_000,
          grossAgorot: 2_400,
          cogsAgorot: 1_500,
        }),
      ],
      returns: [],
      totals,
    });
    expect(report.metrics).toMatchObject({
      grossSalesAgorot: 4_400,
      discountsAgorot: 200,
      returnsAgorot: 0,
      netSalesAgorot: 4_200,
      cogsAgorot: 2_700,
      grossProfitAgorot: 1_500,
      grossMarginBasisPoints: 3_571,
      costComplete: true,
      orderCount: 2,
      averageOrderValueAgorot: 2_100,
      unitsSoldMilli: 4_000,
      stockTurnoverBasisPoints: 2_700,
    });
    expect(report.channels).toEqual([
      {
        channel: "storefront",
        orderCount: 1,
        netSalesAgorot: 2_400,
        grossProfitAgorot: 900,
      },
      {
        channel: "manual",
        orderCount: 1,
        netSalesAgorot: 1_800,
        grossProfitAgorot: 600,
      },
    ]);
  });

  it("never turns a missing cost into profit", () => {
    const report = buildReport({
      period,
      sales: [
        fact({ cogsAgorot: 600 }),
        fact({
          documentId: "doc-2",
          productKey: "brush",
          name: "فرشاة",
          grossAgorot: 500,
          cogsAgorot: null,
        }),
      ],
      returns: [],
      totals,
    });
    expect(report.metrics).toMatchObject({
      netSalesAgorot: 1_500,
      costedSalesAgorot: 1_000,
      uncostedSalesAgorot: 500,
      cogsAgorot: 600,
      grossProfitAgorot: 400,
      costComplete: false,
    });
    expect(report.byProfit.map((item) => item.productKey)).toEqual(["cleaner"]);
    expect(report.byRevenue.map((item) => item.productKey)).toEqual([
      "cleaner",
      "brush",
    ]);
  });

  it("subtracts returns from sales, cost and units", () => {
    const sale = fact({
      grossAgorot: 2_000,
      cogsAgorot: 1_200,
      quantityMilli: 2_000,
    });
    const report = buildReport({
      period,
      sales: [sale, fact({ documentId: "doc-2" })],
      returns: [{ ...sale, date: "2026-09-12" }],
      totals,
    });
    expect(report.metrics).toMatchObject({
      grossSalesAgorot: 3_000,
      returnsAgorot: 2_000,
      netSalesAgorot: 1_000,
      cogsAgorot: 600,
      grossProfitAgorot: 400,
      orderCount: 1,
      unitsSoldMilli: 1_000,
    });
  });

  it("ranks products by quantity, revenue, profit and margin", () => {
    const report = buildReport({
      period,
      sales: [
        fact({
          productKey: "a",
          name: "أ",
          quantityMilli: 5_000,
          grossAgorot: 1_000,
          cogsAgorot: 900,
        }),
        fact({
          productKey: "b",
          name: "ب",
          quantityMilli: 1_000,
          grossAgorot: 3_000,
          cogsAgorot: 1_000,
        }),
      ],
      returns: [],
      totals,
    });
    expect(report.byQuantity[0]?.productKey).toBe("a");
    expect(report.byRevenue[0]?.productKey).toBe("b");
    expect(report.byProfit[0]).toMatchObject({
      productKey: "b",
      profitAgorot: 2_000,
    });
    expect(report.byMargin[0]).toMatchObject({
      productKey: "b",
      marginBasisPoints: 6_667,
    });
  });

  it("splits profit by day for short periods and by week for longer ones", () => {
    const daily = buildReport({
      period: { from: "2026-09-09", to: "2026-09-11" },
      sales: [fact({})],
      returns: [],
      totals,
    });
    expect(daily.profitSeries.map((point) => point.netSalesAgorot)).toEqual([
      0, 1_000, 0,
    ]);
    const weekly = buildReport({
      period: { from: "2026-07-01", to: "2026-09-30" },
      sales: [fact({})],
      returns: [],
      totals,
    });
    expect(weekly.profitSeries).toHaveLength(14);
    expect(
      weekly.profitSeries.reduce(
        (sum, point) => sum + point.grossProfitAgorot,
        0,
      ),
    ).toBe(400);
  });
});

describe("report periods", () => {
  it("resolves presets in store time with a Saturday week start", () => {
    // 2026-09-30 is a Wednesday.
    expect(resolvePeriod("today", "2026-09-30")).toEqual({
      from: "2026-09-30",
      to: "2026-09-30",
    });
    expect(resolvePeriod("week", "2026-09-30").from).toBe("2026-09-26");
    expect(resolvePeriod("week", "2026-09-26").from).toBe("2026-09-26");
    expect(resolvePeriod("last14", "2026-09-30").from).toBe("2026-09-17");
    expect(resolvePeriod("month", "2026-09-30").from).toBe("2026-09-01");
  });

  it("sanitises custom ranges", () => {
    expect(
      resolvePeriod("custom", "2026-09-30", {
        from: "2026-09-10",
        to: "2026-09-05",
      }),
    ).toEqual({ from: "2026-09-05", to: "2026-09-05" });
    expect(
      resolvePeriod("custom", "2026-09-30", { from: "drop table", to: "x" }),
    ).toEqual({ from: "2026-09-30", to: "2026-09-30" });
    const capped = resolvePeriod("custom", "2026-09-30", {
      from: "2020-01-01",
      to: "2026-09-30",
    });
    expect(daysBetween(capped.from, capped.to)).toBe(365);
  });

  it("uses the store's midnight, including daylight saving time", () => {
    expect(startOfStoreDay("2026-01-15").toISOString()).toBe(
      "2026-01-14T22:00:00.000Z",
    );
    expect(startOfStoreDay("2026-07-15").toISOString()).toBe(
      "2026-07-14T21:00:00.000Z",
    );
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });
});
