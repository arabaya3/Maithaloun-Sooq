import { describe, expect, it } from "vitest";

import {
  localeFromAcceptLanguage,
  localizePath,
  splitLocalePath,
} from "./config";

describe("locale from the browser language", () => {
  it("follows the visitor's own preference order", () => {
    expect(localeFromAcceptLanguage("ar-PS,ar;q=0.9,en;q=0.8")).toBe("ar");
    expect(localeFromAcceptLanguage("en-US,en;q=0.9,ar;q=0.5")).toBe("en");
    expect(localeFromAcceptLanguage("en;q=0.4, ar;q=0.8")).toBe("ar");
    expect(localeFromAcceptLanguage("he-IL,ar;q=0.6")).toBe("ar");
  });

  it("falls back to English for unsupported languages and keeps Arabic without a header", () => {
    expect(localeFromAcceptLanguage("fr-FR,de;q=0.8")).toBe("en");
    expect(localeFromAcceptLanguage("*")).toBe("en");
    expect(localeFromAcceptLanguage("ar;q=0")).toBe("en");
    expect(localeFromAcceptLanguage(null)).toBe("ar");
    expect(localeFromAcceptLanguage("  ")).toBe("ar");
  });
});

describe("localized paths", () => {
  it("keeps Arabic addresses and prefixes English ones", () => {
    expect(localizePath("ar", "/cart")).toBe("/cart");
    expect(localizePath("en", "/")).toBe("/en");
    expect(localizePath("en", "/cart")).toBe("/en/cart");
    expect(localizePath("en", "/?q=finish")).toBe("/en?q=finish");
    expect(localizePath("en", "/#catalog")).toBe("/en#catalog");
    expect(localizePath("en", "/en/cart")).toBe("/en/cart");
    // External and protocol-relative links are left alone.
    expect(localizePath("en", "https://wa.me/1")).toBe("https://wa.me/1");
    expect(localizePath("en", "//evil.example")).toBe("//evil.example");
  });

  it("splits a pathname into its locale and shared path", () => {
    expect(splitLocalePath("/en")).toEqual({ locale: "en", path: "/" });
    expect(splitLocalePath("/en/products/x")).toEqual({
      locale: "en",
      path: "/products/x",
    });
    expect(splitLocalePath("/english")).toEqual({
      locale: "ar",
      path: "/english",
    });
    expect(splitLocalePath("/cart")).toEqual({ locale: "ar", path: "/cart" });
  });
});
