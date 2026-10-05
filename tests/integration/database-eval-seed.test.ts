import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  resetTestDatabase,
  testDatabaseConnection,
} from "@/test/test-database";

import { seedEvaluationData } from "../model-eval/eval-seed";
import { createOwnerActor } from "./support";

const { db, client } = testDatabaseConnection;

beforeAll(async () => {
  await resetTestDatabase();
});

afterAll(async () => {
  await client.end();
});

describe("model-evaluation seed", () => {
  it("creates the fixed records the evaluation cases rely on", async () => {
    const owner = await createOwnerActor();
    await seedEvaluationData(db, owner);
    const [counts] = await client.unsafe(`
      select
        (select count(*)::int from products where name_ar = 'معطر جو فينيسيا') as venicia,
        (select count(*)::int from product_variants v join products p on p.id = v.product_id
          where p.name_ar = 'معطر جو فينيسيا' and v.archived_at is null) as venicia_variants,
        (select count(*)::int from products where archived_at is not null) as archived,
        (select count(*)::int from customers) as customers,
        (select count(*)::int from suppliers) as suppliers,
        (select count(*)::int from orders) as orders,
        (select count(*)::int from offers) as offers`);
    expect(counts).toEqual({
      venicia: 1,
      venicia_variants: 3,
      archived: 1,
      customers: 3,
      suppliers: 2,
      orders: 1,
      offers: 1,
    });
  });
});
