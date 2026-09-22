import { describe, expect, it } from "vitest";

import {
  isPlainDeliveryAddress,
  isValidCustomerFullName,
  normalizeContactWhitespace,
} from "./customer-contact";

describe("customer contact helpers", () => {
  it("normalizes whitespace", () => {
    expect(normalizeContactWhitespace("  عميل   تجريبي  ")).toBe("عميل تجريبي");
  });

  it("accepts Arabic and Latin names", () => {
    expect(isValidCustomerFullName("سارة ناصر")).toBe(true);
    expect(isValidCustomerFullName("Sara Nasser")).toBe(true);
    expect(isValidCustomerFullName("O'Connor")).toBe(true);
  });

  it("rejects empty, control, and digit-only names", () => {
    expect(isValidCustomerFullName("")).toBe(false);
    expect(isValidCustomerFullName("12345")).toBe(false);
    expect(isValidCustomerFullName("name\u0001")).toBe(false);
  });

  it("rejects markup in delivery addresses", () => {
    expect(isPlainDeliveryAddress("شارع السوق ميثلون")).toBe(true);
    expect(isPlainDeliveryAddress("<b>شارع</b>")).toBe(false);
  });
});
