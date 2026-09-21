import { describe, expect, it } from "vitest";

import { parseServerEnv, parseTestEnv } from "./env-schema";

const validEnvironment = {
  DATABASE_URL: "postgresql://maithalun_dev:local@127.0.0.1:5433/maithalun_dev",
  TEST_DATABASE_URL:
    "postgresql://maithalun_test:local@127.0.0.1:5434/maithalun_test",
  ORDER_RATE_LIMIT_PEPPER: "a-secure-local-pepper-with-32-characters",
  APP_ORIGIN: "http://localhost:3000",
};

describe("server environment validation", () => {
  it("accepts valid server and isolated test configuration", () => {
    expect(parseServerEnv(validEnvironment).APP_ORIGIN).toBe(
      "http://localhost:3000",
    );
    expect(parseTestEnv(validEnvironment).TEST_DATABASE_URL).toContain(
      "maithalun_test",
    );
  });

  it("fails without exposing secret values", () => {
    expect(() =>
      parseServerEnv({
        ...validEnvironment,
        DATABASE_URL: "secret-database-value",
        ORDER_RATE_LIMIT_PEPPER: "short",
      }),
    ).toThrow("DATABASE_URL, ORDER_RATE_LIMIT_PEPPER");
    try {
      parseServerEnv({
        ...validEnvironment,
        DATABASE_URL: "secret-database-value",
      });
    } catch (error) {
      expect(String(error)).not.toContain("secret-database-value");
    }
  });

  it("rejects a test database that is remote or matches development", () => {
    expect(() =>
      parseTestEnv({
        ...validEnvironment,
        TEST_DATABASE_URL: validEnvironment.DATABASE_URL,
      }),
    ).toThrow("TEST_DATABASE_URL");
    expect(() =>
      parseTestEnv({
        ...validEnvironment,
        TEST_DATABASE_URL:
          "postgresql://user:pass@example.com:5432/maithalun_test",
      }),
    ).toThrow("TEST_DATABASE_URL");
  });
});
