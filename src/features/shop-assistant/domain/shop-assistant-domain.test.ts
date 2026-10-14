import { describe, expect, it } from "vitest";

import { decodeCartCode, encodeCartCode } from "./cart-code";
import {
  addToCart,
  MAX_ASSISTANT_CART_LINES,
  setCartQuantity,
} from "./conversation-cart";
import { asksForHuman, isAffirmation, messageLocale } from "./message-intent";

const line = {
  productId: "general-cleaner",
  variantId: "general-cleaner--default",
  quantity: 2,
};

describe("message intent", () => {
  it("accepts a short clear yes in Arabic and English", () => {
    for (const text of ["نعم", "أكيد", "تمام ثبتي", "Yes", "ok!", "ايوه 👍"]) {
      expect(isAffirmation(text), text).toBe(true);
    }
  });

  it("never treats a negation or a long message as confirmation", () => {
    for (const text of [
      "لا",
      "لا مش هلأ",
      "no thanks",
      "not yet ok",
      "نعم بس بدي اغير الكمية لثلاث قطع لو سمحت",
      "",
    ]) {
      expect(isAffirmation(text), text).toBe(false);
    }
  });

  it("detects a request for a person", () => {
    expect(asksForHuman("بدي احكي مع حدا من المحل")).toBe(true);
    expect(asksForHuman("can I talk to a human?")).toBe(true);
    expect(asksForHuman("بدي شامبو")).toBe(false);
  });

  it("answers in the customer's language", () => {
    expect(messageLocale("مرحبا")).toBe("ar");
    expect(messageLocale("hello there")).toBe("en");
    expect(
      messageLocale(
        "مرحباً MAYTHA\nرمز السلة: MC1-W1siZ2VuZXJhbC1jbGVhbmVyIiwiZ2VuZXJhbC1jbGVhbmVyLS1kZWZhdWx0IixudWxsLDEsMl1d\nhttps://maytha.example/cart",
      ),
    ).toBe("ar");
  });
});

describe("conversation cart", () => {
  it("merges the same option and removes a line at zero", () => {
    const once = addToCart([], line);
    const twice = addToCart(once, { ...line, quantity: 3 });
    expect(twice).toHaveLength(1);
    expect(twice[0]!.quantity).toBe(5);
    expect(setCartQuantity(twice, line, 0)).toEqual([]);
  });

  it("refuses more lines than the limit", () => {
    let cart: ReturnType<typeof addToCart> = [];
    for (let index = 0; index < MAX_ASSISTANT_CART_LINES; index += 1) {
      cart = addToCart(cart, {
        ...line,
        productId: `p-${index}`,
        variantId: `p-${index}--default`,
      });
    }
    expect(() =>
      addToCart(cart, { ...line, productId: "x", variantId: "x--default" }),
    ).toThrow();
  });
});

describe("cart code", () => {
  it("round-trips identifiers and counts, never prices", () => {
    const code = encodeCartCode([line]);
    expect(code).toMatch(/^MC1-[A-Za-z0-9_-]+$/);
    const decoded = decodeCartCode(`مرحباً\nرمز السلة: ${code}`);
    expect(decoded).toEqual([{ ...line, unitsPerSale: 1 }]);
    expect(code).not.toMatch(/price|agorot/i);
  });

  it("ignores malformed or tampered codes", () => {
    expect(decodeCartCode("MC1-not_a_real_code")).toBeNull();
    expect(decodeCartCode("no code here")).toBeNull();
    const bad = encodeCartCode([{ ...line, quantity: 2 }]).replace(/.$/, "*");
    expect(decodeCartCode(bad)).toBeNull();
  });
});
