import { describe, expect, it } from "vitest";

import {
  generateSessionToken,
  hashSessionToken,
  isSessionTokenFormat,
  sessionTokenHashesEqual,
} from "./session-token";
import { evaluateRateLimitHit, loginLockDelayMs } from "./rate-limit";
import { SESSION_ABSOLUTE_MS, SESSION_IDLE_MS } from "./session-absolute";
import { getSafeAdminRedirect, isSafeAdminRedirect } from "./safe-redirect";
import {
  isTrustedMutationOrigin,
  isTrustedMutationSite,
} from "./trusted-origin";
import { normalizeAdminUsername } from "./username";
import { getApprovedNetworkKey } from "./rate-limit-key";
import { LOGIN_FAILURE_MESSAGE } from "./login-policy";
import { assertOwnerBootstrapDatabase } from "./owner-bootstrap-guard";
import { OwnerBootstrapError } from "./owner-service";

describe("session tokens", () => {
  it("generates 256-bit tokens and hashes them", () => {
    const token = generateSessionToken();
    expect(isSessionTokenFormat(token)).toBe(true);
    expect(hashSessionToken(token)).toHaveLength(64);
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
    expect(
      sessionTokenHashesEqual(hashSessionToken(token), hashSessionToken(token)),
    ).toBe(true);
    expect(
      sessionTokenHashesEqual(
        hashSessionToken(token),
        hashSessionToken("other"),
      ),
    ).toBe(false);
  });

  it("uses fixed absolute and idle expiry windows", () => {
    expect(SESSION_ABSOLUTE_MS).toBe(12 * 60 * 60 * 1000);
    expect(SESSION_IDLE_MS).toBe(30 * 60 * 1000);
  });
});

describe("login validation helpers", () => {
  it("normalizes usernames and rejects invalid values", () => {
    expect(normalizeAdminUsername("  Owner.One ")).toBe("owner.one");
    expect(normalizeAdminUsername("ab")).toBeNull();
    expect(normalizeAdminUsername("Owner One")).toBeNull();
  });

  it("keeps login failures generic", () => {
    expect(LOGIN_FAILURE_MESSAGE).toContain("تعذّر تسجيل الدخول");
    expect(LOGIN_FAILURE_MESSAGE.toLowerCase()).not.toContain("password");
    expect(LOGIN_FAILURE_MESSAGE).not.toContain("username");
  });
});

describe("redirect and csrf validation", () => {
  it("rejects unsafe admin redirects", () => {
    expect(getSafeAdminRedirect("/admin/orders")).toBe("/admin/orders");
    expect(getSafeAdminRedirect("/admin/login")).toBe("/admin");
    expect(getSafeAdminRedirect("https://evil.example/admin")).toBe("/admin");
    expect(getSafeAdminRedirect("//evil.example")).toBe("/admin");
    expect(getSafeAdminRedirect("/checkout")).toBe("/admin");
    expect(isSafeAdminRedirect("/admin/products")).toBe(true);
    expect(isSafeAdminRedirect("/admin/login")).toBe(false);
  });

  it("requires a matching origin and same-origin fetch site", () => {
    expect(
      isTrustedMutationOrigin("http://localhost:3000", "http://localhost:3000"),
    ).toBe(true);
    expect(
      isTrustedMutationOrigin("https://evil.example", "http://localhost:3000"),
    ).toBe(false);
    expect(isTrustedMutationOrigin(null, "http://localhost:3000")).toBe(false);
    expect(
      isTrustedMutationOrigin(
        "https://maithaloun-sooq.vercel.app",
        "https://maitloun-sooq.vercel.app",
      ),
    ).toBe(true);
    expect(
      isTrustedMutationOrigin(
        "https://maitloun-sooq.vercel.app",
        "https://maithaloun-sooq.vercel.app",
      ),
    ).toBe(true);
    expect(
      isTrustedMutationOrigin(
        "https://evil.vercel.app",
        "https://maitloun-sooq.vercel.app",
      ),
    ).toBe(false);
    expect(isTrustedMutationSite("same-origin")).toBe(true);
    expect(isTrustedMutationSite("none")).toBe(true);
    expect(isTrustedMutationSite("cross-site")).toBe(false);
    expect(isTrustedMutationSite(null)).toBe(true);
  });
});

describe("rate limit evaluation", () => {
  it("allows hits until the limit and then applies a temporary delay", () => {
    const now = new Date("2026-09-21T10:00:00.000Z");
    let state = evaluateRateLimitHit({
      existing: null,
      now,
      windowMs: 60_000,
      limit: 3,
      delayMs: loginLockDelayMs,
    });
    expect(state.allowed).toBe(true);

    for (let count = 2; count <= 3; count += 1) {
      state = evaluateRateLimitHit({
        existing: state,
        now,
        windowMs: 60_000,
        limit: 3,
        delayMs: loginLockDelayMs,
      });
      expect(state.allowed).toBe(true);
      expect(state.count).toBe(count);
    }

    state = evaluateRateLimitHit({
      existing: state,
      now,
      windowMs: 60_000,
      limit: 3,
      delayMs: loginLockDelayMs,
    });
    expect(state.allowed).toBe(false);
    expect(state.blockedUntil).not.toBeNull();
    expect(loginLockDelayMs(1)).toBe(5_000);
    expect(loginLockDelayMs(5)).toBe(900_000);
  });
});

describe("trusted proxy network keys", () => {
  it("ignores forwarded headers unless the proxy is trusted", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.10" });
    expect(getApprovedNetworkKey(headers, false)).toBeNull();
    expect(getApprovedNetworkKey(headers, true)).toBe("203.0.113.10");
  });
});

describe("owner bootstrap guard", () => {
  it("refuses remote databases without exposing the url", () => {
    expect(() =>
      assertOwnerBootstrapDatabase(
        "postgresql://user:secret@example.com:5432/maithalun_dev",
      ),
    ).toThrow(OwnerBootstrapError);
    try {
      assertOwnerBootstrapDatabase(
        "postgresql://user:secret@example.com:5432/maithalun_dev",
      );
    } catch (error) {
      expect(String(error)).not.toContain("secret");
      expect(String(error)).not.toContain("example.com");
    }
    expect(
      assertOwnerBootstrapDatabase(
        "postgresql://maithalun_dev:local@127.0.0.1:5433/maithalun_dev",
      ),
    ).toBe("maithalun_dev");
  });
});
