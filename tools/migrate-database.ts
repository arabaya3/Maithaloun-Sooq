import { migrate } from "drizzle-orm/postgres-js/migrator";

import { createDatabaseConnection } from "../src/server/db/database";

function shouldApplyMigrations(databaseUrl: string): boolean {
  const hostname = new URL(databaseUrl).hostname;
  if (["127.0.0.1", "localhost"].includes(hostname)) {
    return false;
  }
  return Boolean(process.env.VERCEL) || process.env.APPLY_DB_MIGRATIONS === "1";
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

const parsed = new URL(databaseUrl);
console.log(
  `Applying database migrations to ${parsed.hostname}:${parsed.port || "(default)"}${parsed.pathname}`,
);

const connection = createDatabaseConnection(databaseUrl, 1);
try {
  await migrate(connection.db, { migrationsFolder: "drizzle" });
  console.log("Database migrations applied.");
} finally {
  await connection.client.end();
}
