import "server-only";

import { createDatabaseConnection } from "./database";
import { getServerEnv } from "../env/env";
import { lazyObject } from "../lazy-object";

export const db = lazyObject(
  () =>
    createDatabaseConnection(
      getServerEnv().DATABASE_URL,
      process.env.VERCEL ? 1 : 10,
    ).db,
);
