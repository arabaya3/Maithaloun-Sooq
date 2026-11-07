import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { LOCALE_COOKIE } from "@/i18n/config";

import { isScannerPath, proxy } from "./proxy";

function request(
  path: string,
  {
    language,
    cookie,
    method = "GET",
    headers = {},
  }: {
    language?: string;
    cookie?: string;
    method?: string;
    headers?: Record<string, string>;
  } = {},
) {
  const init: Record<string, string> = { ...headers };
  if (language) init["accept-language"] = language;
  if (cookie) init.cookie = `${LOCALE_COOKIE}=${cookie}`;
  return new NextRequest(new URL(path, "https://maytha.test"), {
    method,
    headers: init,
  });
}

const forwardedLocale = (response: Response) =>
  response.headers.get("x-middleware-request-x-maytha-locale");

describe("storefront language proxy", () => {
  it("sends an English browser to /en on its first visit, keeping the path and query", () => {
    const response = proxy(request("/cart?x=1", { language: "en-GB,en" }));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe(
      "/en/cart",
    );
    expect(new URL(response.headers.get("location")!).search).toBe("?x=1");
  });

  it("serves Arabic in place for an Arabic browser and for crawlers without a language", () => {
    for (const language of ["ar-PS,ar;q=0.9", undefined]) {
      const response = proxy(request("/", { language }));
      expect(response.status).toBe(200);
      expect(forwardedLocale(response)).toBe("ar");
    }
  });

  it("falls back to English for unsupported languages", () => {
    const response = proxy(request("/", { language: "fr-FR,de;q=0.8" }));
    expect(new URL(response.headers.get("location")!).pathname).toBe("/en");
  });

  it("lets a saved choice win over the browser language", () => {
    const stayArabic = proxy(
      request("/offers", { language: "en-US", cookie: "ar" }),
    );
    expect(stayArabic.status).toBe(200);
    expect(forwardedLocale(stayArabic)).toBe("ar");

    const goEnglish = proxy(request("/", { language: "ar", cookie: "en" }));
    expect(new URL(goEnglish.headers.get("location")!).pathname).toBe("/en");
  });

  it("always shows English on /en, served by its own static route", () => {
    const response = proxy(
      request("/en/products/finish", { language: "ar", cookie: "ar" }),
    );
    expect(forwardedLocale(response)).toBe("en");
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.headers.get("location")).toBeNull();
  });

  it("rewrites Arabic addresses to the internal /ar route without changing the address", () => {
    const rewritten = (path: string) =>
      new URL(
        proxy(request(path, { language: "ar" })).headers.get(
          "x-middleware-rewrite",
        )!,
      );
    expect(rewritten("/").pathname).toBe("/ar");
    expect(rewritten("/products/finish").pathname).toBe("/ar/products/finish");
    expect(rewritten("/?q=soap").search).toBe("?q=soap");
  });

  it("redirects the internal /ar prefix to the public Arabic address", () => {
    const response = proxy(request("/ar/offers"));
    expect(response.status).toBe(308);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/offers");
    expect(
      new URL(proxy(request("/ar")).headers.get("location")!).pathname,
    ).toBe("/");
  });

  it("never redirects form posts or client navigations", () => {
    const attempts: { method?: string; headers: Record<string, string> }[] = [
      { method: "POST", headers: { "next-action": "abc" } },
      { headers: { rsc: "1" } },
    ];
    for (const init of attempts) {
      const response = proxy(
        request("/account", { language: "en-US", ...init }),
      );
      expect(response.status).toBe(200);
    }
  });

  it("still sends signed-out admin visitors to the login page", () => {
    const response = proxy(request("/admin/orders", { language: "en-US" }));
    expect(new URL(response.headers.get("location")!).pathname).toBe(
      "/admin/login",
    );
  });
});

describe("scanner rejection", () => {
  it("answers common vulnerability probes with a small cacheable 404 and no rendering", async () => {
    for (const path of [
      "/wp-admin",
      "/wp-login.php",
      "/wordpress/wp-includes/x",
      "/xmlrpc.php",
      "/.env",
      "/.env.production",
      "/.git/config",
      "/cgi-bin/luci",
      "/phpmyadmin/index.php",
      "/vendor/phpunit/x",
      "/index.php",
      "/en/wp-login.php",
    ]) {
      const response = proxy(request(path, { language: "en-US" }));
      expect(response.status, path).toBe(404);
      expect(response.headers.get("x-middleware-rewrite"), path).toBeNull();
      expect(response.headers.get("cache-control"), path).toContain("s-maxage");
      expect(await response.text(), path).toBe("Not found");
    }
  });

  it("never touches store addresses", () => {
    for (const path of [
      "/",
      "/en",
      "/products/wipes-soft",
      "/products/wp-cleaner",
      "/categories/env-safe",
      "/brands/Persil",
      "/offers",
      "/cart",
      "/checkout",
      "/account/orders",
      "/en/privacy",
      "/~offline",
      "/admin/login",
    ]) {
      expect(isScannerPath(path), path).toBe(false);
    }
  });
});
