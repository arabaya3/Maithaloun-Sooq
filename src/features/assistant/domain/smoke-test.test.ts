import { describe, expect, it } from "vitest";

import {
  draftToolNames,
  prepareToolNames,
  readToolNames,
} from "./assistant-policy";
import {
  maskDebtors,
  maskName,
  maskPrivateText,
  SMOKE_TOOL_ALLOWLIST,
  smokeTestEnabled,
} from "./smoke-test";

describe("assistant smoke test", () => {
  it("is off unless ASSISTANT_SMOKE_TEST=on, independent of ADMIN_ASSISTANT", () => {
    expect(smokeTestEnabled({})).toBe(false);
    expect(smokeTestEnabled({ ADMIN_ASSISTANT: "full" })).toBe(false);
    expect(smokeTestEnabled({ ASSISTANT_SMOKE_TEST: "1" })).toBe(false);
    expect(smokeTestEnabled({ ASSISTANT_SMOKE_TEST: "on" })).toBe(true);
  });

  it("allows read tools only", () => {
    for (const name of SMOKE_TOOL_ALLOWLIST) {
      expect(readToolNames as readonly string[]).toContain(name);
      expect(prepareToolNames as readonly string[]).not.toContain(name);
      expect(draftToolNames as readonly string[]).not.toContain(name);
    }
  });

  it("masks phones in any digit form and shortens debtor names", () => {
    expect(maskPrivateText("رقمها 0599123450 وعليها 45 ₪")).toBe(
      "رقمها •••50 وعليها 45 ₪",
    );
    expect(maskPrivateText("+970 599 123 450")).toBe("•••50");
    expect(maskPrivateText("٠٥٩٩١٢٣٤٥٠")).toBe("•••50");
    expect(maskPrivateText("1,250 ₪ في 2026")).toBe("1,250 ₪ في 2026");
    expect(maskName("أم محمد")).toBe("أ•••");
    expect(
      maskDebtors({
        count: 1,
        total: "45 ₪",
        debtors: [
          {
            customerId: "c1",
            name: "أم محمد",
            balance: "45 ₪",
            oldestDebtDays: 3,
          },
        ],
        href: "/admin/customers?filter=owing",
      }),
    ).toEqual({
      count: 1,
      total: "45 ₪",
      debtors: [{ name: "أ•••", balance: "45 ₪", oldestDebtDays: 3 }],
    });
  });
});
