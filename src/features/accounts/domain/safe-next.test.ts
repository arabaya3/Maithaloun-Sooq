import { describe, expect, it } from "vitest";

import { safeAccountNext } from "./safe-next";

describe("safeAccountNext", () => {
  it("allows only known in-store destinations after sign-in", () => {
    expect(safeAccountNext("/checkout")).toBe("/checkout");
    expect(safeAccountNext("/favorites")).toBe("/favorites");
    expect(safeAccountNext("https://evil.example")).toBe("/account");
    expect(safeAccountNext("//evil.example")).toBe("/account");
    expect(safeAccountNext("/admin")).toBe("/account");
    expect(safeAccountNext(undefined)).toBe("/account");
  });
});
