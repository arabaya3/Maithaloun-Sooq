export interface RateLimitBucket {
  count: number;
  windowStartedAt: Date;
  blockedUntil: Date | null;
}

export interface RateLimitEvaluation {
  count: number;
  windowStartedAt: Date;
  blockedUntil: Date | null;
  allowed: boolean;
}

export function loginLockDelayMs(failuresOverLimit: number): number {
  if (failuresOverLimit <= 0) return 0;
  const steps = [5_000, 15_000, 60_000, 300_000, 900_000];
  return steps[Math.min(failuresOverLimit, steps.length) - 1] ?? 900_000;
}

export function evaluateRateLimitHit(input: {
  existing: RateLimitBucket | null;
  now: Date;
  windowMs: number;
  limit: number;
  delayMs?: (failuresOverLimit: number) => number;
}): RateLimitEvaluation {
  const { existing, now, windowMs, limit, delayMs } = input;
  const windowExpired =
    !existing || now.getTime() - existing.windowStartedAt.getTime() >= windowMs;

  if (
    existing?.blockedUntil &&
    existing.blockedUntil.getTime() > now.getTime()
  ) {
    return {
      count: existing.count,
      windowStartedAt: existing.windowStartedAt,
      blockedUntil: existing.blockedUntil,
      allowed: false,
    };
  }

  if (windowExpired) {
    return {
      count: 1,
      windowStartedAt: now,
      blockedUntil: null,
      allowed: true,
    };
  }

  const count = existing.count + 1;
  const allowed = count <= limit;
  const blockedUntil =
    allowed || !delayMs
      ? null
      : new Date(now.getTime() + delayMs(count - limit));

  return {
    count,
    windowStartedAt: existing.windowStartedAt,
    blockedUntil,
    allowed,
  };
}
