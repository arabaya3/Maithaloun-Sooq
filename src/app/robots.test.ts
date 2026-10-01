import { describe, expect, it } from "vitest";

import robots from "./robots";

describe("robots", () => {
  it("keeps private and transactional routes out of search engines", () => {
    const rules = robots().rules;
    const rule = Array.isArray(rules) ? rules[0] : rules;
    expect(rule?.allow).toBe("/");
    expect(rule?.disallow).toEqual(
      expect.arrayContaining(["/admin", "/api", "/checkout", "/orders"]),
    );
  });
});
