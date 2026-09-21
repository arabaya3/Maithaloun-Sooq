import "server-only";

import { parseServerEnv, type ServerEnv } from "./env-schema";

let cachedEnvironment: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  cachedEnvironment ??= parseServerEnv({
    DATABASE_URL: process.env.DATABASE_URL,
    ORDER_RATE_LIMIT_PEPPER: process.env.ORDER_RATE_LIMIT_PEPPER,
    APP_ORIGIN: process.env.APP_ORIGIN,
  });
  return cachedEnvironment;
}
