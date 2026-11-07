import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/root-params", () => ({ locale: async () => "ar" }));

const SERVER_ENV = {
  DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/maithalun",
  APP_ORIGIN: "https://maytha.test",
  ORDER_RATE_LIMIT_PEPPER: "a".repeat(32),
};

async function staticParams() {
  vi.resetModules();
  const { generateStaticParams } = await import("./layout");
  return generateStaticParams();
}

describe("storefront prerendering at build time", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("prerenders both languages when the server environment is configured (Production)", async () => {
    for (const [name, value] of Object.entries(SERVER_ENV)) {
      vi.stubEnv(name, value);
    }
    expect(await staticParams()).toEqual([{ locale: "ar" }, { locale: "en" }]);
  });

  it("prerenders nothing without server secrets (Preview), so the build never reads the database", async () => {
    for (const name of Object.keys(SERVER_ENV)) vi.stubEnv(name, "");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(await staticParams()).toEqual([]);
  });
});
