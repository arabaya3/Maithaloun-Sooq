import { describe, expect, it } from "vitest";

import {
  whatsAppChatUrl,
  whatsAppLinks,
  whatsAppOrderMessage,
} from "./whatsapp-order";

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

  it("greets the store and carries no phone, address or internal id", () => {
    const message = whatsAppOrderMessage(order);
    expect(message.split("\n")[0]).toBe("مرحباً MAYTHA MARKET،");
    expect(message).toContain("مجموع المنتجات");
    expect(message).toContain("التوصيل");
    expect(message).not.toMatch(/\+?9[67]\d{8,}|05\d{8}/);
    expect(message).not.toMatch(/عنوان|[0-9a-f]{8}-[0-9a-f]{4}/i);
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

describe("store WhatsApp chat link", () => {
  it("opens a plain chat in international format and refuses unsupported numbers", () => {
    expect(whatsAppChatUrl("+972590000000")).toBe("https://wa.me/972590000000");
    expect(whatsAppChatUrl("+970590000000")).toBe("https://wa.me/970590000000");
    expect(whatsAppChatUrl("0590000000")).toBeNull();
    expect(whatsAppChatUrl("+15550000000")).toBeNull();
  });
});
