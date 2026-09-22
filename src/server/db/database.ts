import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";

import * as schema from "./schema";

export interface DatabaseConnection {
  db: PostgresJsDatabase<typeof schema>;
  client: Sql;
}

function resolveDatabaseUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  // After DDL, transaction pooler (:6543) was timing out simple SELECTs from Vercel.
  // Session mode (:5432) remains readable and is preferred for this serverless app size.
  if (url.hostname.includes("pooler.supabase.com") && url.port === "6543") {
    url.port = "5432";
  }
  return url.toString();
}

export function createDatabaseConnection(
  databaseUrl: string,
  maxConnections = 10,
): DatabaseConnection {
  const isVercel = Boolean(process.env.VERCEL);
  const client = postgres(resolveDatabaseUrl(databaseUrl), {
    max: isVercel ? Math.min(maxConnections, 1) : maxConnections,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 20,
    connection: {
      statement_timeout: 15000,
    },
  });
  return {
    client,
    db: drizzle(client, { schema }),
  };
}
