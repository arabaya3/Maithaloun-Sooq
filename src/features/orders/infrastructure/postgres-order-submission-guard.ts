import "server-only";

import { createHmac } from "node:crypto";

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { PostgresRateLimiter } from "@/features/admin/auth/postgres-rate-limiter";
import * as schema from "@/server/db/schema";

import {
  MAX_ORDER_REQUEST_BYTES,
  type OrderSubmissionAttempt,
  type OrderSubmissionGuard,
  type OrderSubmissionGuardResult,
} from "../application/order-submission-guard";

export class PostgresOrderSubmissionGuard implements OrderSubmissionGuard {
  constructor(
    private readonly pepper: string,
    private readonly limiter: PostgresRateLimiter,
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

    const keyHash = createHmac("sha256", this.pepper)
      .update(attempt.idempotencyKey)
      .digest("hex");
    const globalHash = createHmac("sha256", this.pepper)
      .update("order-global")
      .digest("hex");

    const [keyLimit, globalLimit] = await Promise.all([
      this.limiter.hit({
        scope: "order-key",
        keyHash,
        limit: 3,
        windowMs: 60_000,
      }),
      this.limiter.hit({
        scope: "order-global",
        keyHash: globalHash,
        limit: 100,
        windowMs: 60_000,
      }),
    ]);

    return keyLimit.allowed && globalLimit.allowed
      ? { allowed: true }
      : { allowed: false, reason: "rate_limited" };
  }
}

export function createPostgresOrderSubmissionGuard(
  database: PostgresJsDatabase<typeof schema>,
  pepper: string,
): PostgresOrderSubmissionGuard {
  return new PostgresOrderSubmissionGuard(
    pepper,
    new PostgresRateLimiter(database),
  );
}
