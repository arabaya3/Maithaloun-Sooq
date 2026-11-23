import { describe, expect, it } from "vitest";

import { orderCreatedNotification } from "./order-notification";

describe("orderCreatedNotification", () => {
  it("shows total, first name, pieces, channel and items", () => {
    const n = orderCreatedNotification({
      customerName: "  سارة أحمد ",
      totalAgorot: 1700,
      channel: "web",
      lines: [
        { name: "مسحوق أريال — 7 كيلو", quantity: 2 },
        { name: "صابون", quantity: 1 },
      ],
    });
    expect(n.title).toBe("طلب جديد · 17 ₪");
    expect(n.body).toBe("سارة · 3 قطع · من الموقع\nمسحوق أريال وصنف آخر");
  });

  it("handles a single item over WhatsApp", () => {
    const n = orderCreatedNotification({
      customerName: "محمد",
      totalAgorot: 1250,
      channel: "whatsapp",
      lines: [{ name: "شامبو", quantity: 1 }],
    });
    expect(n.body).toBe("محمد · قطعة واحدة · عبر واتساب\nشامبو");
  });

  it("stays within the stored column limits", () => {
    const n = orderCreatedNotification({
      customerName: "س".repeat(300),
      totalAgorot: 100,
      channel: "web",
      lines: [{ name: "ص".repeat(400), quantity: 30 }],
    });
    expect(n.title.length).toBeLessThanOrEqual(120);
    expect(n.body.length).toBeLessThanOrEqual(240);
  });
});
