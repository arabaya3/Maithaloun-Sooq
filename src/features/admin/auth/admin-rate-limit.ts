import "server-only";

import { createHash } from "node:crypto";

import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { db } from "@/server/db/db";
import { getServerEnv } from "@/server/env/env";

import { PostgresRateLimiter } from "./postgres-rate-limiter";

const limiter = new PostgresRateLimiter(db);
const HOUR_MS = 60 * 60 * 1_000;

export async function allowAdminRequest(
  actor: AdminActor,
  scope: string,
  limitPerHour: number,
): Promise<boolean> {
  const keyHash = createHash("sha256")
    .update(`${actor.id}:${getServerEnv().ORDER_RATE_LIMIT_PEPPER}`)
    .digest("hex");
  const result = await limiter.hit({
    scope,
    keyHash,
    limit: limitPerHour,
    windowMs: HOUR_MS,
  });
  return result.allowed;
}
