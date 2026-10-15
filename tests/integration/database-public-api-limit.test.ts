import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  hitPublicApiBudget,
  SHARED_BUDGET_MULTIPLIER,
  type ClientAddressSource,
} from "@/features/commerce/public-api-limit";
import {
  resetTestDatabase,
  testDatabaseConnection,
} from "@/test/test-database";

const { db, client } = testDatabaseConnection;
const PEPPER = "p".repeat(40);
const LIMIT = 3;
const now = new Date("2026-10-14T12:00:30Z");

const vercel: ClientAddressSource = { trustProxy: false, onVercel: true };
const direct: ClientAddressSource = { trustProxy: false, onVercel: false };

function hit(ip: string | null, source: ClientAddressSource, scope = "t") {
  return hitPublicApiBudget(db, {
    pepper: PEPPER,
    scope,
    limit: LIMIT,
    headers: new Headers(ip ? { "x-forwarded-for": ip } : {}),
    source,
    now,
  });
}

async function hits(count: number, call: () => Promise<boolean>) {
  const results: boolean[] = [];
  for (let index = 0; index < count; index += 1) results.push(await call());
  return results;
}

beforeAll(async () => {
  await resetTestDatabase();
});

beforeEach(async () => {
  await client.unsafe("TRUNCATE TABLE rate_limit_buckets");
});

afterAll(async () => {
  await client.end();
});

describe("public API rate limit", () => {
  it("limits each client on Vercel, without affecting other clients", async () => {
    const first = await hits(LIMIT + 2, () => hit("198.51.100.1", vercel));
    expect(first).toEqual([true, true, true, false, false]);
    // A neighbour keeps a full budget of its own.
    expect(await hit("198.51.100.2", vercel)).toBe(true);
  });

  it("treats customers behind one shared address (mobile carrier NAT) as one client", async () => {
    const shared = await hits(LIMIT + 1, () => hit("100.64.0.9", vercel));
    expect(shared.filter(Boolean)).toHaveLength(LIMIT);
  });

  it("gives forged addresses no fresh budget when the headers cannot be trusted", async () => {
    // Off Vercel and without TRUST_PROXY, a new fake address per request still lands in one shared bucket.
    let allowed = 0;
    for (
      let index = 0;
      index < LIMIT * SHARED_BUDGET_MULTIPLIER + 5;
      index += 1
    ) {
      if (await hit(`203.0.113.${index % 250}`, direct)) allowed += 1;
    }
    expect(allowed).toBe(LIMIT * SHARED_BUDGET_MULTIPLIER);
  });

  it("caps everyone together, even across many distinct clients", async () => {
    let allowed = 0;
    for (
      let index = 0;
      index < LIMIT * SHARED_BUDGET_MULTIPLIER + 5;
      index += 1
    ) {
      if (await hit(`192.0.2.${index}`, vercel)) allowed += 1;
    }
    expect(allowed).toBe(LIMIT * SHARED_BUDGET_MULTIPLIER);
  });

  it("does not let an over-limit client spend the shared budget", async () => {
    await hits(LIMIT + 50, () => hit("198.51.100.66", vercel));
    // The shared bucket saw only the allowed requests, so others still get through.
    const others = await hits(5, () => hit("198.51.100.67", vercel));
    expect(others.filter(Boolean)).toHaveLength(LIMIT);
  });

  it("counts parallel requests from one client exactly", async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () => hit("198.51.100.90", vercel)),
    );
    expect(results.filter(Boolean)).toHaveLength(LIMIT);
  });

  it("holds the shared ceiling under a parallel burst from many clients", async () => {
    const results = await Promise.all(
      Array.from(
        { length: LIMIT * SHARED_BUDGET_MULTIPLIER + 15 },
        (_, index) => hit(`192.0.2.${index % 250}`, vercel),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(
      LIMIT * SHARED_BUDGET_MULTIPLIER,
    );
  });

  it("keeps budgets separate per endpoint", async () => {
    await hits(LIMIT, () => hit("198.51.100.5", vercel, "api:quote"));
    expect(await hit("198.51.100.5", vercel, "api:catalog")).toBe(true);
  });
});
