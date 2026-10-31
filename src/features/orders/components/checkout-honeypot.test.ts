import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { messagesFor } from "@/i18n/messages";

// Browsers autofill fields whose name or label looks like a company, website, address or
// e-mail, even with autocomplete="off". A filled honeypot rejects the order as automated, so a
// real customer with a saved company would never be able to check out.
const autofillWords =
  /company|organi[sz]ation|org\b|website|url|address|email|e-mail|name|phone|tel|شركة|الشركة|موقع|عنوان|بريد|اسم|هاتف/i;

describe("checkout honeypot", () => {
  it("has a name and label no browser autofills", () => {
    const source = readFileSync(
      path.join(__dirname, "checkout-form.tsx"),
      "utf8",
    );
    const honeypotName = source.match(/honeypot: form\.get\("([^"]+)"\)/)?.[1];
    expect(honeypotName).toBeTruthy();
    expect(source).toContain(`name="${honeypotName}"`);
    expect(honeypotName).not.toMatch(autofillWords);
    for (const locale of ["ar", "en"] as const) {
      expect(messagesFor(locale).checkout.honeypot).not.toMatch(autofillWords);
    }
  });
});
