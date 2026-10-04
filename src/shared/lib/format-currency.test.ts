import { describe, expect, it } from "vitest";

import { formatIls } from "./format-currency";

describe("formatIls", () => {
  it("never renders negative zero with a minus sign", () => {
    expect(formatIls(-0)).toBe("0 ₪");
    expect(formatIls(0)).toBe("0 ₪");
  });

  it("keeps the sign of real negative amounts", () => {
    expect(formatIls(-250)).not.toBe(formatIls(250));
    expect(formatIls(-250)).toContain("-");
    expect(formatIls(1_050)).not.toContain("-");
  });
});
