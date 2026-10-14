import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { normalizeWhatsAppPhone } from "./phone";
import { whatsAppChatUrl, whatsAppLinks } from "./whatsapp-order";

const NEW_NUMBER = "+972599105456";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|css|json)$/.test(name) && !name.includes(".test.")
      ? [full]
      : [];
  });
}

describe("store WhatsApp number", () => {
  it("is never hard-coded: every surface reads it from Admin settings", () => {
    // Real Palestinian or Israeli mobile numbers; test fixtures use 590000000 and are excluded.
    const realNumber = /\+?97[02]\s?5(?!90000000)\d{8}/;
    const offenders = sourceFiles("src").filter((file) =>
      realNumber.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("accepts the new number in the admin format and builds working links to it", () => {
    expect(normalizeWhatsAppPhone("972", "0599105456")).toBe(NEW_NUMBER);
    expect(whatsAppChatUrl(NEW_NUMBER)).toBe("https://wa.me/972599105456");
    expect(whatsAppLinks(NEW_NUMBER, "طلب")).toEqual({
      app: "https://wa.me/972599105456?text=%D8%B7%D9%84%D8%A8",
      web: "https://web.whatsapp.com/send?phone=972599105456&text=%D8%B7%D9%84%D8%A8",
    });
  });
});
