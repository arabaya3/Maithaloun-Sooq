import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { PostgresRateLimiter } from "@/features/admin/auth/postgres-rate-limiter";
import {
  getApprovedNetworkKey,
  hashRateLimitIdentifier,
} from "@/features/admin/auth/rate-limit-key";
import type * as schema from "@/server/db/schema";

// Everyone together may use this many times one client's budget each minute, so a single
// abuser (or a spoofing attempt) can never use up the whole shop's capacity.
export const SHARED_BUDGET_MULTIPLIER = 20;

export interface ClientAddressSource {
  /** TRUST_PROXY: an operator-approved proxy in front of the app sets the forwarded headers. */
  trustProxy: boolean;
  /** Running on Vercel, whose edge overwrites x-forwarded-for with the real client address. */
  onVercel: boolean;
}

/**
 * The client address to rate-limit by, or null when the request cannot prove one.
 * Forwarded headers are believed only behind a proxy that overwrites them; anywhere else a
 * caller could forge them to get a fresh budget on every request.
 */
export function publicApiClientKey(
  headers: Headers,
  source: ClientAddressSource,
): string | null {
  return getApprovedNetworkKey(headers, source.trustProxy || source.onVercel);
}

export interface PublicApiBucket {
  key: string;
  limit: number;
}

/** Buckets one request counts against: always the shared one, plus its own client's when known. */
export function publicApiBuckets(
  client: string | null,
  limit: number,
): PublicApiBucket[] {
  const shared = { key: "all", limit: limit * SHARED_BUDGET_MULTIPLIER };
  return client ? [{ key: `client:${client}`, limit }, shared] : [shared];
}

export async function hitPublicApiBudget(
  database: PostgresJsDatabase<typeof schema>,
  input: {
    pepper: string;
    scope: string;
    limit: number;
    headers: Headers;
    source: ClientAddressSource;
    now?: Date;
  },
): Promise<boolean> {
  const limiter = new PostgresRateLimiter(database);
  const client = publicApiClientKey(input.headers, input.source);
  // The client's own bucket is checked first, so an over-limit client does not spend the shared budget.
  for (const bucket of publicApiBuckets(client, input.limit)) {
    const verdict = await limiter.hit({
      scope: input.scope,
      keyHash: hashRateLimitIdentifier(input.pepper, input.scope, bucket.key),
      limit: bucket.limit,
      windowMs: 60_000,
      now: input.now,
    });
    if (!verdict.allowed) return false;
  }
  return true;
}
