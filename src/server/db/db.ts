import "server-only";

import { createDatabaseConnection } from "./database";
import { getServerEnv } from "../env/env";

const connection = createDatabaseConnection(
  getServerEnv().DATABASE_URL,
  process.env.VERCEL ? 1 : 10,
);

export const db = connection.db;
