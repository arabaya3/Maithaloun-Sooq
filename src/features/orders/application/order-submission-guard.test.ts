import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  InMemoryOrderSubmissionGuard,
  MAX_ORDER_REQUEST_BYTES,
} from "./order-submission-guard";

describe("order submission guard", () => {
  it("rejects oversized and honeypot submissions", async () => {
    const guard = new InMemoryOrderSubmissionGuard("x".repeat(32));

    await expect(
      guard.check({
        idempotencyKey: crypto.randomUUID(),
        honeypot: "",
        requestSize: MAX_ORDER_REQUEST_BYTES + 1,
      }),
    ).resolves.toEqual({ allowed: false, reason: "too_large" });
    await expect(
      guard.check({
        idempotencyKey: crypto.randomUUID(),
        honeypot: "automated.example",
        requestSize: 100,
      }),
    ).resolves.toEqual({ allowed: false, reason: "automated" });
  });

  it("limits repeated attempts without storing raw identifiers", async () => {
    const guard = new InMemoryOrderSubmissionGuard("x".repeat(32), () => 1);
    const attempt = {
      idempotencyKey: crypto.randomUUID(),
      honeypot: "",
      requestSize: 100,
    };

    await expect(guard.check(attempt)).resolves.toEqual({ allowed: true });
    await expect(guard.check(attempt)).resolves.toEqual({ allowed: true });
    await expect(guard.check(attempt)).resolves.toEqual({ allowed: true });
    await expect(guard.check(attempt)).resolves.toEqual({
      allowed: false,
      reason: "rate_limited",
    });
  });
});
