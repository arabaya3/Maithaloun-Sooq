import { config } from "dotenv";

import { createDatabaseConnection } from "../src/server/db/database";
import { seedDevelopmentDatabase } from "../src/server/db/development-seed";
import { parseServerEnv } from "../src/server/env/env-schema";

config({ path: ".env.local", quiet: true });

const environment = parseServerEnv({
  DATABASE_URL: process.env.DATABASE_URL,
  ORDER_RATE_LIMIT_PEPPER: process.env.ORDER_RATE_LIMIT_PEPPER,
  APP_ORIGIN: process.env.APP_ORIGIN,
});
const databaseUrl = new URL(environment.DATABASE_URL);

if (
  !["127.0.0.1", "localhost"].includes(databaseUrl.hostname) ||
  databaseUrl.pathname !== "/maithalun_dev"
) {
  throw new Error("Development seed requires the local maithalun_dev database");
}

const connection = createDatabaseConnection(environment.DATABASE_URL, 1);
try {
  await seedDevelopmentDatabase(connection.db);
} finally {
  await connection.client.end();
}
