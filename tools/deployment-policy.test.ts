import { describe, expect, it } from "vitest";

import {
  mayChangeRemoteSchema,
  missingProductionVariables,
} from "./deployment-policy";

const remote = "postgresql://user:pass@db.example.supabase.co:5432/postgres";
const local = "postgresql://user:pass@127.0.0.1:5434/postgres";

describe("deployment policy", () => {
  it("never changes a schema from a Preview build, even with a remote DATABASE_URL", () => {
    expect(
      mayChangeRemoteSchema({ VERCEL: "1", VERCEL_ENV: "preview" }, remote),
    ).toBe(false);
  });

  it("changes a remote schema only for Production or an explicit opt-in", () => {
    expect(
      mayChangeRemoteSchema({ VERCEL: "1", VERCEL_ENV: "production" }, remote),
    ).toBe(true);
    expect(mayChangeRemoteSchema({ APPLY_DB_MIGRATIONS: "1" }, remote)).toBe(
      true,
    );
    expect(mayChangeRemoteSchema({}, remote)).toBe(false);
    expect(mayChangeRemoteSchema({ VERCEL_ENV: "production" }, local)).toBe(
      false,
    );
  });

  it("requires runtime secrets only for Production builds", () => {
    expect(missingProductionVariables({ VERCEL_ENV: "preview" })).toEqual([]);
    expect(missingProductionVariables({})).toEqual([]);
    expect(
      missingProductionVariables({
        VERCEL_ENV: "production",
        DATABASE_URL: remote,
        APP_ORIGIN: " ",
      }),
    ).toEqual(["APP_ORIGIN", "ORDER_RATE_LIMIT_PEPPER"]);
  });
});
