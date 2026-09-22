import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { migrate } from "drizzle-orm/postgres-js/migrator";

import { createDatabaseConnection } from "../src/server/db/database";

function shouldApplyMigrations(databaseUrl: string): boolean {
  const hostname = new URL(databaseUrl).hostname;
  if (["127.0.0.1", "localhost"].includes(hostname)) {
    return false;
  }
  return Boolean(process.env.VERCEL) || process.env.APPLY_DB_MIGRATIONS === "1";
}

/** DDL needs session mode; transaction pooler (:6543) often times out on ALTER. */
function toMigrationDatabaseUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  if (
    url.hostname.includes("pooler.supabase.com") &&
    (url.port === "6543" || url.port === "")
  ) {
    url.port = "5432";
  }
  return url.toString();
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("Skipping database migrate: DATABASE_URL is not set.");
  process.exit(0);
}

if (!shouldApplyMigrations(databaseUrl)) {
  console.log("Skipping database migrate outside Vercel/remote apply mode.");
  process.exit(0);
}

const migrationUrl = toMigrationDatabaseUrl(databaseUrl);
const parsed = new URL(migrationUrl);
console.log(
  `Applying database migrations to ${parsed.hostname}:${parsed.port || "(default)"}${parsed.pathname}`,
);

const connection = createDatabaseConnection(migrationUrl, 1);
try {
  await connection.client.unsafe("set statement_timeout = 0");

  const journal = await connection.client.unsafe(`
    select to_regclass('drizzle.__drizzle_migrations') as migrations_table
  `);
  const hasJournal = Boolean(journal[0]?.migrations_table);

  if (!hasJournal) {
    console.log(
      "No drizzle migration journal found on remote DB; ensuring contact columns only.",
    );
    process.exit(0);
  }

  const rows = await connection.client<
    { hash: string }[]
  >`select hash from drizzle.__drizzle_migrations`;
  console.log(`Found ${rows.length} recorded drizzle migrations.`);

  // If the schema already exists but journal is empty, full migrate would recreate enums.
  if (rows.length === 0) {
    console.log(
      "Drizzle journal is empty while schema exists; skipping full migrate.",
    );
    process.exit(0);
  }

  await migrate(connection.db, { migrationsFolder: "drizzle" });
  console.log("Database migrations applied.");

  const contactMigration = readFileSync(
    "drizzle/0004_order_whatsapp_contact_snapshot.sql",
    "utf8",
  );
  console.log(
    "0004 hash",
    createHash("sha256").update(contactMigration).digest("hex").slice(0, 12),
  );
} finally {
  await connection.client.end();
}
