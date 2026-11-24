import { describe, expect, it } from "vitest";

import {
  groupDailyProducts,
  pickDailyCategory,
  storeDayNumber,
} from "./daily-category";

const categories = [
  { code: "laundry", sortOrder: 30 },
  { code: "home-cleaners", sortOrder: 10 },
  { code: "empty", sortOrder: 15 },
  { code: "kitchen", sortOrder: 20 },
];
const products = [
  { categoryId: "laundry" },
  { categoryId: "home-cleaners" },
  // Listed in the kitchen only as an extra category: that still makes the kitchen non-empty.
  { categoryId: "laundry", categoryIds: ["laundry", "kitchen"] },
];

describe("pickDailyCategory", () => {
  it("walks the non-empty categories in the owner's order, one per day", () => {
    const codes = [0, 1, 2].map(
      (day) => pickDailyCategory(categories, products, day)?.code,
    );
    expect(codes).toEqual(["home-cleaners", "kitchen", "laundry"]);
  });

  it("starts over after the last category", () => {
    expect(pickDailyCategory(categories, products, 3)?.code).toBe(
      "home-cleaners",
    );
    expect(pickDailyCategory(categories, products, 3 * 1000 + 2)?.code).toBe(
      "laundry",
    );
  });

  it("never picks an empty category", () => {
    for (let day = 0; day < 12; day += 1) {
      expect(pickDailyCategory(categories, products, day)?.code).not.toBe(
        "empty",
      );
    }
  });

  it("does not depend on the order the categories arrive in", () => {
    const shuffled = [...categories].reverse();
    for (let day = 0; day < 6; day += 1) {
      expect(pickDailyCategory(shuffled, products, day)?.code).toBe(
        pickDailyCategory(categories, products, day)?.code,
      );
    }
  });

  it("breaks equal sort orders by code", () => {
    const tied = [
      { code: "b", sortOrder: 1 },
      { code: "a", sortOrder: 1 },
    ];
    const items = [{ categoryId: "a" }, { categoryId: "b" }];
    expect(pickDailyCategory(tied, items, 0)?.code).toBe("a");
    expect(pickDailyCategory(tied, items, 1)?.code).toBe("b");
  });

  it("handles days before the epoch without going out of range", () => {
    expect(pickDailyCategory(categories, products, -1)?.code).toBe("laundry");
  });

  it("returns null when no category has products", () => {
    expect(pickDailyCategory(categories, [], 5)).toBeNull();
    expect(pickDailyCategory([], products, 5)).toBeNull();
  });
});

describe("storeDayNumber", () => {
  it("counts days in Hebron time, so the day changes at Hebron midnight", () => {
    // 21:59 UTC on 23 Nov 2026 is 23:59 in Hebron (UTC+2 in winter); 22:01 UTC is the next day.
    const before = storeDayNumber(new Date("2026-11-23T21:59:00Z"));
    const after = storeDayNumber(new Date("2026-11-23T22:01:00Z"));
    expect(after - before).toBe(1);
    expect(storeDayNumber(new Date("2026-11-23T10:00:00Z"))).toBe(before);
  });

  it("follows summer time too", () => {
    // Hebron is UTC+3 in summer: 20:59 UTC is still 23:59 the same day.
    const before = storeDayNumber(new Date("2026-07-01T20:59:00Z"));
    const after = storeDayNumber(new Date("2026-07-01T21:01:00Z"));
    expect(after - before).toBe(1);
  });

  it("is the same day number for every instant of one store day", () => {
    const day = storeDayNumber(new Date("2026-11-24T00:00:00+02:00"));
    expect(storeDayNumber(new Date("2026-11-24T23:59:59+02:00"))).toBe(day);
  });
});

describe("groupDailyProducts", () => {
  const items = (count: number) =>
    Array.from({ length: count }, (_, index) => ({ id: `p${index}` }));

  it("keeps the order and fills groups of the given size", () => {
    expect(
      groupDailyProducts(items(6), 3).map((group) => group.map((p) => p.id)),
    ).toEqual([
      ["p0", "p1", "p2"],
      ["p3", "p4", "p5"],
    ]);
  });

  it("balances the groups instead of leaving a lone product", () => {
    expect(groupDailyProducts(items(4), 3).map((group) => group.length)).toEqual(
      [2, 2],
    );
    expect(groupDailyProducts(items(7), 3).map((group) => group.length)).toEqual(
      [3, 2, 2],
    );
  });

  it("never repeats a product, inside a group or across groups", () => {
    const repeated = [...items(5), { id: "p1" }, { id: "p3" }];
    const ids = groupDailyProducts(repeated, 3).flat().map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(5);
  });

  it("gives one group for a few products and none for an empty list", () => {
    expect(groupDailyProducts(items(2), 3)).toHaveLength(1);
    expect(groupDailyProducts([], 3)).toEqual([]);
  });
});
