import { describe, expect, it } from "vitest";

import { AuthorizationError, type AdminActor } from "./admin-actor";
import { assertPermission, can, permissions } from "./permissions";

const owner: AdminActor = {
  id: "00000000-0000-4000-8000-000000000001",
  username: "owner",
  displayName: "المالك",
  role: "owner",
  active: true,
};
const operator: AdminActor = { ...owner, username: "op", role: "operator" };

describe("permission matrix", () => {
  it("grants the owner everything", () => {
    for (const permission of permissions) {
      expect(can(owner, permission)).toBe(true);
    }
  });

  it("limits the operator to daily operations", () => {
    const allowed = permissions.filter((permission) =>
      can(operator, permission),
    );
    expect(allowed).toEqual([
      "stock.view",
      "purchase.record",
      "suppliers.manage",
      "sales.record",
      "payments.record",
      "customers.view",
      "reminders.manage",
    ]);
  });

  it("denies inactive accounts and throws on assertion", () => {
    expect(can({ ...owner, active: false }, "stock.view")).toBe(false);
    expect(() => assertPermission(operator, "reports.view")).toThrow(
      AuthorizationError,
    );
    expect(() => assertPermission(operator, "stock.costs")).toThrow(
      AuthorizationError,
    );
  });
});
