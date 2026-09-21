import "server-only";

import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "@/server/db/schema";

import { evaluateRateLimitHit, type RateLimitBucket } from "./rate-limit";

export class PostgresRateLimiter {
  constructor(private readonly database: PostgresJsDatabase<typeof schema>) {}

  async hit(input: {
    scope: string;
    keyHash: string;
    limit: number;
    windowMs: number;
    delayMs?: (failuresOverLimit: number) => number;
    now?: Date;
  }): Promise<{ allowed: boolean; retryAfterMs: number }> {
    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      await transaction
        .insert(schema.rateLimitBuckets)
        .values({
          scope: input.scope,
          keyHash: input.keyHash,
          count: 0,
          windowStartedAt: now,
          blockedUntil: null,
          updatedAt: now,
        })
        .onConflictDoNothing();

      const [existing] = await transaction
        .select()
        .from(schema.rateLimitBuckets)
        .where(
          and(
            eq(schema.rateLimitBuckets.scope, input.scope),
            eq(schema.rateLimitBuckets.keyHash, input.keyHash),
          ),
        )
        .for("update");

      const evaluation = evaluateRateLimitHit({
        existing: existing ? toBucket(existing) : null,
        now,
        windowMs: input.windowMs,
        limit: input.limit,
        delayMs: input.delayMs,
      });

      await transaction
        .update(schema.rateLimitBuckets)
        .set({
          count: evaluation.count,
          windowStartedAt: evaluation.windowStartedAt,
          blockedUntil: evaluation.blockedUntil,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.rateLimitBuckets.scope, input.scope),
            eq(schema.rateLimitBuckets.keyHash, input.keyHash),
          ),
        );

      const retryAfterMs = evaluation.blockedUntil
        ? Math.max(0, evaluation.blockedUntil.getTime() - now.getTime())
        : 0;
      return { allowed: evaluation.allowed, retryAfterMs };
    });
  }

  async reset(scope: string, keyHash: string): Promise<void> {
    await this.database
      .delete(schema.rateLimitBuckets)
      .where(
        and(
          eq(schema.rateLimitBuckets.scope, scope),
          eq(schema.rateLimitBuckets.keyHash, keyHash),
        ),
      );
  }
}

function toBucket(
  row: typeof schema.rateLimitBuckets.$inferSelect,
): RateLimitBucket {
  return {
    count: row.count,
    windowStartedAt: row.windowStartedAt,
    blockedUntil: row.blockedUntil,
  };
}
