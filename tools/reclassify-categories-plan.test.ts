import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  planReclassification,
  reclassificationPlanSchema,
  type CurrentAssignment,
  type ReclassificationPlan,
} from "./reclassify-categories-plan";

const usable = new Set([
  "kitchen-dishwashing",
  "paper-tissues",
  "home-cleaners",
  "personal-care",
]);

const plan: ReclassificationPlan = {
  entries: [
    {
      productId: "wipes",
      currentPrimary: "kitchen-dishwashing",
      primary: "kitchen-dishwashing",
      extras: ["paper-tissues"],
      reason: "kitchen wipes",
    },
    {
      productId: "floor-wipes",
      currentPrimary: "paper-tissues",
      primary: "home-cleaners",
      extras: ["paper-tissues"],
      reason: "floor cleaner",
    },
  ],
};

function state(
  rows: Array<[string, string, string[]]>,
): Map<string, CurrentAssignment> {
  return new Map(
    rows.map(([productId, primary, links]) => [
      productId,
      { productId, primary, links },
    ]),
  );
}

describe("planReclassification", () => {
  it("adds extra categories and moves a primary, keeping the old one as planned", () => {
    const changes = planReclassification(
      plan,
      state([
        ["wipes", "kitchen-dishwashing", ["kitchen-dishwashing"]],
        ["floor-wipes", "paper-tissues", ["paper-tissues"]],
      ]),
      usable,
    );
    expect(changes).toEqual([
      expect.objectContaining({
        kind: "change",
        productId: "wipes",
        toPrimary: "kitchen-dishwashing",
        addLinks: ["paper-tissues"],
        removeLinks: [],
      }),
      expect.objectContaining({
        kind: "change",
        productId: "floor-wipes",
        fromPrimary: "paper-tissues",
        toPrimary: "home-cleaners",
        addLinks: ["home-cleaners"],
        removeLinks: [],
      }),
    ]);
  });

  it("is idempotent: once applied, nothing is left to do", () => {
    const changes = planReclassification(
      plan,
      state([
        [
          "wipes",
          "kitchen-dishwashing",
          ["kitchen-dishwashing", "paper-tissues"],
        ],
        ["floor-wipes", "home-cleaners", ["home-cleaners", "paper-tissues"]],
      ]),
      usable,
    );
    expect(changes.map((change) => change.kind)).toEqual([
      "unchanged",
      "unchanged",
    ]);
  });

  it("skips products that moved since the plan was written, or are missing", () => {
    const changes = planReclassification(
      plan,
      state([["wipes", "personal-care", ["personal-care"]]]),
      usable,
    );
    expect(changes).toEqual([
      expect.objectContaining({ kind: "skipped", productId: "wipes" }),
      expect.objectContaining({
        kind: "skipped",
        productId: "floor-wipes",
        why: "product not found",
      }),
    ]);
  });

  it("never uses a category that does not exist", () => {
    const [change] = planReclassification(
      plan,
      state([["wipes", "kitchen-dishwashing", ["kitchen-dishwashing"]]]),
      new Set(["kitchen-dishwashing"]),
    );
    expect(change).toMatchObject({ kind: "skipped" });
  });
});

describe("the committed plan", () => {
  const committed = reclassificationPlanSchema.parse(
    JSON.parse(
      readFileSync("tools/data/category-reclassification-plan.json", "utf8"),
    ),
  );

  it("lists each product once and never makes the primary an extra", () => {
    const ids = committed.entries.map((entry) => entry.productId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of committed.entries) {
      expect(entry.extras).not.toContain(entry.primary);
    }
  });

  it("puts the kitchen degreasing wipes in the kitchen and in tissues and wipes", () => {
    const wipes = committed.entries.find(
      (entry) => entry.productId === "product-13b6f6f9",
    );
    expect(wipes).toMatchObject({
      primary: "kitchen-dishwashing",
      extras: ["paper-tissues"],
    });
  });
});
