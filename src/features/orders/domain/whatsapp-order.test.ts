import { describe, expect, it } from "vitest";

import { whatsAppLinks, whatsAppOrderMessage } from "./whatsapp-order";

const order = {
  publicReference: "MS-abcdefghijklmnopqrstuvwx",
  lines: [
    {
      name: "منظف عام",
      options: "الرائحة: لافندر · الحجم: 750 مل",
      unit: null,
      quantity: 2,
      lineSubtotalAgorot: 1200,
    },
    {
      name: "مبيض",
      options: null,
      unit: "علبة 3 قطع",
      quantity: 1,
      lineSubtotalAgorot: 1500,
    },
  ],
  itemsSubtotalAgorot: 2700,
  deliveryFeeAgorot: 1000,
  finalTotalAgorot: 3700,
};

describe("WhatsApp order message", () => {
  it("lists the reference, each line with its options and the totals", () => {
    const message = whatsAppOrderMessage(order);
    expect(message).toContain("MS-abcdefghijklmnopqrstuvwx");
    expect(message).toContain(
      "• منظف عام (الرائحة: لافندر · الحجم: 750 مل) × 2",
    );
    expect(message).toContain("• مبيض (علبة 3 قطع) × 1");
    expect(message).toContain("الإجمالي");
    expect(message).toContain("الدفع نقداً عند الاستلام.");
  });

  it("builds app and web links only for a supported store number", () => {
    const links = whatsAppLinks("+970590000000", "مرحبا طلب");
    expect(links?.app).toBe(
      `https://wa.me/970590000000?text=${encodeURIComponent("مرحبا طلب")}`,
    );
    expect(links?.web).toMatch(
      /^https:\/\/web\.whatsapp\.com\/send\?phone=970590000000&text=/,
    );
    expect(whatsAppLinks("+1555", "x")).toBeNull();
    expect(whatsAppLinks("", "x")).toBeNull();
  });
});
