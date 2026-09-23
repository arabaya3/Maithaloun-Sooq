import { describe, expect, it } from "vitest";

import {
  assertOwnerBootstrapDatabase,
  assertProductionOwnerBootstrapDatabase,
} from "@/features/admin/auth/owner-bootstrap-guard";
import { OwnerBootstrapError } from "@/features/admin/auth/owner-service";

describe("owner bootstrap guards", () => {
  it("allows local loopback maithalun_dev only", () => {
    expect(
      assertOwnerBootstrapDatabase(
        "postgres://u:p@127.0.0.1:5433/maithalun_dev",
      ),
    ).toBe("maithalun_dev");
    expect(() =>
      assertOwnerBootstrapDatabase(
        "postgres://u:p@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
      ),
    ).toThrow(OwnerBootstrapError);
  });

  it("requires an explicit production allow flag and Supabase host", () => {
    expect(() =>
      assertProductionOwnerBootstrapDatabase(
        "postgres://u:p@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
        undefined,
      ),
    ).toThrow(OwnerBootstrapError);

    expect(
      assertProductionOwnerBootstrapDatabase(
        "postgres://u:p@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
        "1",
      ),
    ).toBe("production");

    expect(() =>
      assertProductionOwnerBootstrapDatabase(
        "postgres://u:p@127.0.0.1:5433/maithalun_dev",
        "1",
      ),
    ).toThrow(OwnerBootstrapError);
  });
});
