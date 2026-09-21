import { config } from "dotenv";
import { migrate } from "drizzle-orm/postgres-js/migrator";

import { createDatabaseConnection } from "@/server/db/database";
import { insertVerifiedReferenceData } from "@/server/db/development-seed";
import { parseTestEnv } from "@/server/env/env-schema";

config({ path: ".env.local", quiet: true });

const environment = parseTestEnv({
  DATABASE_URL: process.env.DATABASE_URL,
  TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
  ORDER_RATE_LIMIT_PEPPER: process.env.ORDER_RATE_LIMIT_PEPPER,
  APP_ORIGIN: process.env.APP_ORIGIN,
});

export const testDatabaseConnection = createDatabaseConnection(
  environment.TEST_DATABASE_URL,
  5,
);

export async function resetTestDatabase() {
  await testDatabaseConnection.client.unsafe(
    "DROP SCHEMA IF EXISTS public CASCADE",
  );
  await testDatabaseConnection.client.unsafe(
    "DROP SCHEMA IF EXISTS drizzle CASCADE",
  );
  await testDatabaseConnection.client.unsafe("CREATE SCHEMA public");
  await migrate(testDatabaseConnection.db, {
    migrationsFolder: "drizzle",
  });
  await insertVerifiedReferenceData(testDatabaseConnection.db);
}
