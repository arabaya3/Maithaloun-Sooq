import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import path from "node:path";

import {
  checkoutFieldMessagesEn,
  localizeCheckoutFieldErrors,
  mapOrderCreationError,
} from "./order-error";

describe("safe order error mapping", () => {
  it("returns useful domain messages without internal details", () => {
    expect(mapOrderCreationError("unknown_product")).toEqual({
      status: 409,
      message: "تحتوي السلة على منتج لم يعد متاحاً. حدّث السلة وحاول مجدداً.",
    });
    expect(mapOrderCreationError("database_error")).toEqual({
      status: 503,
      message: "تعذّر حفظ الطلب الآن. لم يتم إنشاء طلب جديد.",
    });
  });
});

describe("English order errors", () => {
  it("maps order creation errors to English with the same status", () => {
    expect(mapOrderCreationError("whatsapp_unavailable", "en")).toEqual({
      status: 409,
      message:
        "Ordering via WhatsApp isn’t available right now. Please place your order on the website.",
    });
    expect(mapOrderCreationError("database_error", "en").status).toBe(503);
  });

  it("translates field errors only in English", () => {
    const fieldErrors = { customerName: ["أدخل الاسم الكامل."] };
    expect(localizeCheckoutFieldErrors(fieldErrors)).toBe(fieldErrors);
    expect(localizeCheckoutFieldErrors(fieldErrors, "en")).toEqual({
      customerName: ["Enter your full name."],
    });
    expect(
      localizeCheckoutFieldErrors({ items: ["رسالة غير معروفة"] }, "en"),
    ).toEqual({ items: ["Check this field."] });
  });

  it("has English for every Arabic message in the checkout schema", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../domain/checkout-request.ts"),
      "utf8",
    );
    const arabic = [...source.matchAll(/"([^"]*[؀-ۿ][^"]*)"/g)].map(
      (match) => match[1]!,
    );
    expect(arabic.length).toBeGreaterThan(10);
    for (const message of arabic) {
      expect(checkoutFieldMessagesEn[message], message).toBeTruthy();
    }
  });
});
