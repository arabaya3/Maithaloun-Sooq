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

describe("0014 customer accounts migration", () => {
  it("adds isolated account tables to a populated database without touching orders or customers", async () => {
    await client.unsafe("DROP SCHEMA IF EXISTS public CASCADE");
    await client.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await client.unsafe("CREATE SCHEMA public");
    const files = (await readdir("drizzle"))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    expect(files).toContain("0014_customer_accounts.sql");
    for (const file of files.filter((name) => name < "0014")) await apply(file);

    await client.unsafe(`
      INSERT INTO customers (name, normalized_name, phone_e164) VALUES
        ('زبون قديم', 'زبون قديم', '+970591112222'),
        ('زبون مكرر', 'زبون مكرر', '+970591112222')`);
    const before = await client.unsafe(
      "SELECT id, name, phone_e164 FROM customers ORDER BY name",
    );

    await apply("0014_customer_accounts.sql");

    expect(
      await client.unsafe(
        "SELECT id, name, phone_e164 FROM customers ORDER BY name",
      ),
    ).toEqual(before);

    const [account] = await client.unsafe(
      "INSERT INTO customer_accounts (phone_e164) VALUES ('+970591112222') RETURNING id",
    );
    await expect(
      client.unsafe(
        "INSERT INTO customer_accounts (phone_e164) VALUES ('+970591112222')",
      ),
    ).rejects.toThrow(/customer_accounts_phone_uidx/);
    await client.unsafe(
      `UPDATE customer_accounts SET phone_e164 = NULL, deleted_at = now() WHERE id = '${account!.id}'`,
    );
    await client.unsafe(
      "INSERT INTO customer_accounts (phone_e164) VALUES ('+970591112222')",
    );
    await expect(
      client.unsafe("INSERT INTO customer_accounts (phone_e164) VALUES (NULL)"),
    ).rejects.toThrow(/customer_accounts_active_has_phone/);
    await client.unsafe(
      `INSERT INTO customer_account_events (account_id, type) VALUES ('${account!.id}', 'login')`,
    );
    await expect(
      client.unsafe("DELETE FROM customer_account_events"),
    ).rejects.toThrow(/append-only/);

    const security = await client.unsafe(`
      SELECT c.relname AS table, c.relrowsecurity AS rls,
        has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
        has_table_privilege('authenticated', c.oid, 'SELECT') AS auth_select
      FROM pg_class c
      WHERE c.relkind = 'r' AND c.relname IN ('customer_account_events','customer_accounts','customer_addresses','customer_favorites','customer_order_links','customer_sessions')
      ORDER BY 1`);
    expect(security).toEqual(
      [
        "customer_account_events",
        "customer_accounts",
        "customer_addresses",
        "customer_favorites",
        "customer_order_links",
        "customer_sessions",
      ].map((table) => ({
        table,
        rls: true,
        anon_select: false,
        auth_select: false,
      })),
    );
  });
});
