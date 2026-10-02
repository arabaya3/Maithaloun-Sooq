import { readFile, readdir } from "node:fs/promises";

import { afterAll, describe, expect, it } from "vitest";

import {
  resetTestDatabase,
  testDatabaseConnection,
} from "@/test/test-database";

const { client } = testDatabaseConnection;

async function apply(file: string) {
  const statements = (await readFile(`drizzle/${file}`, "utf8"))
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) await client.unsafe(statement);
}

afterAll(async () => {
  await resetTestDatabase();
});

describe("0013 offers, customers and suppliers migration", () => {
  it("adds offers and contact fields to a populated database without touching existing rows", async () => {
    await client.unsafe("DROP SCHEMA IF EXISTS public CASCADE");
    await client.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await client.unsafe("CREATE SCHEMA public");
    const files = (await readdir("drizzle"))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    expect(files).toContain("0013_assistant_parties.sql");
    for (const file of files.filter((name) => name < "0013")) await apply(file);

    await client.unsafe(`
      INSERT INTO customers (name, normalized_name, phone_e164, notes) VALUES
        ('زبون قديم', 'زبون قديم', '+970591112222', 'ملاحظة'),
        ('زبون مكرر', 'زبون مكرر', NULL, NULL)`);
    await client.unsafe(`
      INSERT INTO suppliers (name_ar, normalized_name, phone) VALUES
        ('مورد قديم', 'مورد قديم', '0599111222'),
        ('مورد قديم ٢', 'مورد قديم ٢', NULL)`);
    const customersBefore = await client.unsafe(
      "SELECT id, name, phone_e164, notes, active FROM customers ORDER BY name",
    );
    const suppliersBefore = await client.unsafe(
      "SELECT id, name_ar, phone, active FROM suppliers ORDER BY name_ar",
    );

    await apply("0013_assistant_parties.sql");

    expect(
      await client.unsafe(
        "SELECT id, name, phone_e164, notes, active FROM customers ORDER BY name",
      ),
    ).toEqual(customersBefore);
    expect(
      await client.unsafe(
        "SELECT id, name_ar, phone, active FROM suppliers ORDER BY name_ar",
      ),
    ).toEqual(suppliersBefore);
    expect(
      await client.unsafe(
        "SELECT count(*)::int AS filled FROM customers WHERE address IS NOT NULL OR landmark IS NOT NULL OR merged_into_customer_id IS NOT NULL",
      ),
    ).toEqual([{ filled: 0 }]);

    await expect(
      client.unsafe(
        "INSERT INTO offers (name_ar, kind, value) VALUES ('خصم كبير', 'percentage', 95)",
      ),
    ).rejects.toThrow(/offers_value_range/);
    await expect(
      client.unsafe(
        "INSERT INTO offers (name_ar, kind, value, starts_at, ends_at) VALUES ('مقلوب', 'fixed_price', 100, now(), now() - interval '1 day')",
      ),
    ).rejects.toThrow(/offers_window/);
    const [offer] = await client.unsafe(
      "INSERT INTO offers (name_ar, kind, value) VALUES ('عرض', 'amount_off', 100) RETURNING id",
    );
    await expect(
      client.unsafe(
        `INSERT INTO offer_targets (offer_id) VALUES ('${offer!.id}')`,
      ),
    ).rejects.toThrow(/offer_targets_exactly_one/);

    const security = await client.unsafe(`
      SELECT c.relname AS table, c.relrowsecurity AS rls,
        has_table_privilege('anon', c.oid, 'SELECT') AS anon_select
      FROM pg_class c WHERE c.relname IN ('offers', 'offer_targets') ORDER BY 1`);
    expect(security).toEqual([
      { table: "offer_targets", rls: true, anon_select: false },
      { table: "offers", rls: true, anon_select: false },
    ]);
    const indexes = await client.unsafe(
      "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('offers_live_idx','offer_targets_offer_idx','offer_targets_product_idx','offer_targets_variant_idx','offer_targets_category_idx','order_items_offer_idx','customers_merged_into_idx','suppliers_merged_into_idx') ORDER BY 1",
    );
    expect(indexes).toHaveLength(8);
  });
});
