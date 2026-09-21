import { describe, expect, it } from "vitest";

import {
  canTransitionOrderStatus,
  getAllowedTransitions,
  isTerminalOrderStatus,
  orderStatuses,
  type OrderStatus,
} from "./order-status";

const allowed = [
  ["pending", "confirmed"],
  ["pending", "cancelled"],
  ["confirmed", "preparing"],
  ["confirmed", "cancelled"],
  ["preparing", "out_for_delivery"],
  ["preparing", "cancelled"],
  ["out_for_delivery", "delivered"],
  ["out_for_delivery", "cancelled"],
] as const;

describe("order status transitions", () => {
  it("allows only the documented matrix", () => {
    for (const from of orderStatuses) {
      for (const to of orderStatuses) {
        const shouldAllow = allowed.some(
          ([source, target]) => source === from && target === to,
        );
        expect(canTransitionOrderStatus(from, to)).toBe(shouldAllow);
      }
    }
  });

  it("treats delivered and cancelled as terminal", () => {
    expect(isTerminalOrderStatus("delivered")).toBe(true);
    expect(isTerminalOrderStatus("cancelled")).toBe(true);
    expect(getAllowedTransitions("delivered")).toEqual([]);
    expect(getAllowedTransitions("cancelled")).toEqual([]);
    expect(getAllowedTransitions("pending")).toEqual([
      "confirmed",
      "cancelled",
    ]);
  });

  it("does not skip statuses", () => {
    const invalid: Array<[OrderStatus, OrderStatus]> = [
      ["pending", "preparing"],
      ["pending", "delivered"],
      ["confirmed", "out_for_delivery"],
      ["preparing", "delivered"],
      ["delivered", "pending"],
      ["cancelled", "pending"],
    ];
    for (const [from, to] of invalid) {
      expect(canTransitionOrderStatus(from, to)).toBe(false);
    }
  });
});
