import { describe, expect, it } from "vitest";

import {
  getPrimaryNextStatus,
  orderStatusLabels,
} from "@/features/orders/domain/order-status";
import { buildWhatsAppContactUrl } from "@/features/orders/domain/phone";

describe("admin operational helpers", () => {
  it("uses Arabic ops status labels", () => {
    expect(orderStatusLabels.pending).toBe("جديد");
    expect(orderStatusLabels.confirmed).toBe("مؤكّد");
    expect(orderStatusLabels.cancelled).toBe("ملغي");
  });

  it("picks the primary non-cancel next status", () => {
    expect(getPrimaryNextStatus("pending")).toBe("confirmed");
    expect(getPrimaryNextStatus("out_for_delivery")).toBe("delivered");
    expect(getPrimaryNextStatus("delivered")).toBeNull();
  });

  it("builds a WhatsApp contact URL with order reference only", () => {
    const url = buildWhatsAppContactUrl(
      "+970591234567",
      "MS-abcdefghijklmnopqrstuvwx",
    );
    expect(url).toContain("https://wa.me/970591234567");
    expect(url).toContain(encodeURIComponent("MS-abcdefghijklmnopqrstuvwx"));
    expect(url).toContain(encodeURIComponent("سوق ميثلون"));
    expect(url).not.toContain("address=");
    expect(decodeURIComponent(url!)).not.toMatch(/عنوان|هاتف/);
  });
});
