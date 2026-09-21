import "server-only";

import { createHmac } from "node:crypto";

export const MAX_ORDER_REQUEST_BYTES = 20_000;

export interface OrderSubmissionAttempt {
  idempotencyKey: string;
  honeypot: string;
  requestSize: number;
}

export type OrderSubmissionGuardResult =
  | { allowed: true }
  | { allowed: false; reason: "automated" | "rate_limited" | "too_large" };

export interface OrderSubmissionGuard {
  check(attempt: OrderSubmissionAttempt): Promise<OrderSubmissionGuardResult>;
}

interface AttemptWindow {
  count: number;
  resetAt: number;
}

export class InMemoryOrderSubmissionGuard implements OrderSubmissionGuard {
  private readonly attempts = new Map<string, AttemptWindow>();
  private globalWindow: AttemptWindow = { count: 0, resetAt: 0 };

  constructor(
    private readonly pepper: string,
    private readonly now: () => number = Date.now,
  ) {}

  async check(
    attempt: OrderSubmissionAttempt,
  ): Promise<OrderSubmissionGuardResult> {
    if (attempt.requestSize > MAX_ORDER_REQUEST_BYTES) {
      return { allowed: false, reason: "too_large" };
    }
    if (attempt.honeypot.trim()) {
      return { allowed: false, reason: "automated" };
    }

    const currentTime = this.now();
    this.globalWindow = this.incrementWindow(
      this.globalWindow,
      currentTime,
      100,
    );
    if (this.globalWindow.count > 100) {
      return { allowed: false, reason: "rate_limited" };
    }

    const key = createHmac("sha256", this.pepper)
      .update(attempt.idempotencyKey)
      .digest("hex");
    const keyWindow = this.incrementWindow(
      this.attempts.get(key),
      currentTime,
      3,
    );
    this.attempts.set(key, keyWindow);

    return keyWindow.count > 3
      ? { allowed: false, reason: "rate_limited" }
      : { allowed: true };
  }

  private incrementWindow(
    window: AttemptWindow | undefined,
    currentTime: number,
    limit: number,
  ): AttemptWindow {
    if (!window || currentTime >= window.resetAt) {
      return { count: 1, resetAt: currentTime + 60_000 };
    }
    return { ...window, count: Math.min(limit + 1, window.count + 1) };
  }
}
