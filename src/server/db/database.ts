import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";

import * as schema from "./schema";

export interface DatabaseConnection {
  db: PostgresJsDatabase<typeof schema>;
  client: Sql;
}

export function createDatabaseConnection(
  databaseUrl: string,
  maxConnections = 10,
): DatabaseConnection {
  const client = postgres(databaseUrl, {
    max: maxConnections,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 20,
  });
  return {
    client,
    db: drizzle(client, { schema }),
  };
}
