import { describe, expect, it } from "vitest";

import { domainMoveLink, readMovedCart } from "./domain-move";

describe("domain move link", () => {
  it("opens the new store home in the visitor's language", () => {
    expect(domainMoveLink("ar", null)).toBe("https://www.maytha.app/");
    expect(domainMoveLink("en", null)).toBe("https://www.maytha.app/en");
  });

  it("carries the cart in the hash and reads it back unchanged", () => {
    const cart = '{"version":3,"lines":[{"quantity":2}]}';
    const link = new URL(domainMoveLink("ar", cart));
    expect(link.search).toBe("");
    expect(readMovedCart(link.hash)).toBe(cart);
  });

  it("ignores other and malformed hashes", () => {
    expect(readMovedCart("")).toBeNull();
    expect(readMovedCart("#details")).toBeNull();
    expect(readMovedCart("#moved-cart=%E0%A4%A")).toBeNull();
  });
});
