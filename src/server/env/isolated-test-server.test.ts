import { describe, expect, it } from "vitest";

import {
  isIsolatedTestServer,
  testDoublesAllowed,
} from "./isolated-test-server";

const local = "postgres://u:p@127.0.0.1:5434/maithalun_test";

describe("isolated test server", () => {
  it("allows test doubles only for the flagged local test database", () => {
    expect(
      isIsolatedTestServer({
        E2E_ISOLATED_TEST_SERVER: "1",
        DATABASE_URL: local,
      }),
    ).toBe(true);
    expect(
      testDoublesAllowed({
        NODE_ENV: "production",
        E2E_ISOLATED_TEST_SERVER: "1",
        DATABASE_URL: local,
      }),
    ).toBe(true);
  });

  it.each([
    { DATABASE_URL: local },
    {
      E2E_ISOLATED_TEST_SERVER: "1",
      DATABASE_URL: "postgres://u:p@db.example.supabase.co:5432/postgres",
    },
    {
      E2E_ISOLATED_TEST_SERVER: "1",
      DATABASE_URL: "postgres://u:p@127.0.0.1:5433/maithalun_dev",
    },
    { E2E_ISOLATED_TEST_SERVER: "1", DATABASE_URL: local, VERCEL: "1" },
    { E2E_ISOLATED_TEST_SERVER: "1", DATABASE_URL: "not a url" },
  ])(
    "never allows them for a deployed production server: %o",
    (environment) => {
      expect(
        testDoublesAllowed({ NODE_ENV: "production", ...environment }),
      ).toBe(false);
    },
  );
});
