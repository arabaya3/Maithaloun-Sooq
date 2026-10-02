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

describe("0015 assistant product drafts migration", () => {
  it("adds an isolated draft table to a populated database", async () => {
    await client.unsafe("DROP SCHEMA IF EXISTS public CASCADE");
    await client.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await client.unsafe("CREATE SCHEMA public");
    const files = (await readdir("drizzle"))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    expect(files).toContain("0015_assistant_product_drafts.sql");
    for (const file of files.filter((name) => name < "0015")) await apply(file);

    const [admin] = await client.unsafe(
      "INSERT INTO admin_users (username, display_name, password_hash, role) VALUES ('owner-m', 'مالكة', 'x', 'owner') RETURNING id",
    );
    const [conversation] = await client.unsafe(
      `INSERT INTO admin_assistant_conversations (admin_user_id) VALUES ('${admin!.id}') RETURNING id`,
    );
    const before = await client.unsafe(
      "SELECT id FROM admin_assistant_conversations",
    );

    await apply("0015_assistant_product_drafts.sql");

    expect(
      await client.unsafe("SELECT id FROM admin_assistant_conversations"),
    ).toEqual(before);
    const insert = (status: string) =>
      client.unsafe(
        `INSERT INTO admin_assistant_product_drafts (admin_user_id, conversation_id, status, data, expires_at)
         VALUES ('${admin!.id}', '${conversation!.id}', '${status}', '{}', now() + interval '1 day')`,
      );
    await insert("open");
    await expect(insert("open")).rejects.toThrow(
      /admin_assistant_product_drafts_open_uidx/,
    );
    await insert("cancelled");
    await expect(insert("done")).rejects.toThrow(
      /admin_assistant_product_drafts_status/,
    );
    const [security] = await client.unsafe(`
      SELECT c.relrowsecurity AS rls,
        has_table_privilege('anon', c.oid, 'SELECT') AS anon_select
      FROM pg_class c WHERE c.relname = 'admin_assistant_product_drafts'`);
    expect(security).toEqual({ rls: true, anon_select: false });
  });
});
