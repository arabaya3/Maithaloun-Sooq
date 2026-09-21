import { describe, expect, it } from "vitest";

import {
  hashPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  validatePasswordPolicy,
  verifyPassword,
} from "./password";

const validPassword = "correct-horse-battery";

describe("password hashing", () => {
  it("hashes with a unique salt and verifies in constant-time comparison", async () => {
    const first = await hashPassword(validPassword);
    const second = await hashPassword(validPassword);

    expect(first).toMatch(/^v1\$scrypt\$n=16384,r=8,p=1,dk=32\$/);
    expect(first).not.toBe(second);
    await expect(verifyPassword(validPassword, first)).resolves.toBe(true);
    await expect(verifyPassword("wrong-password-1", first)).resolves.toBe(
      false,
    );
  });

  it("rejects invalid encoded hashes without throwing", async () => {
    await expect(verifyPassword(validPassword, "not-a-hash")).resolves.toBe(
      false,
    );
    await expect(
      verifyPassword(validPassword, "v1$bcrypt$n=16384,r=8,p=1,dk=32$abc$def"),
    ).resolves.toBe(false);
    await expect(verifyPassword(validPassword, "")).resolves.toBe(false);
  });

  it("enforces minimum and maximum password length without truncation", () => {
    expect(validatePasswordPolicy("short")).toBe(false);
    expect(validatePasswordPolicy("x".repeat(PASSWORD_MIN_LENGTH))).toBe(true);
    expect(validatePasswordPolicy("x".repeat(PASSWORD_MAX_LENGTH))).toBe(true);
    expect(validatePasswordPolicy("x".repeat(PASSWORD_MAX_LENGTH + 1))).toBe(
      false,
    );
  });
});
