import "server-only";

import {
  isServerEnvConfigured,
  parseServerEnv,
  type ServerEnv,
} from "./env-schema";

function serverEnvInput() {
  return {
    DATABASE_URL: process.env.DATABASE_URL,
    ORDER_RATE_LIMIT_PEPPER: process.env.ORDER_RATE_LIMIT_PEPPER,
    APP_ORIGIN: process.env.APP_ORIGIN,
    TRUST_PROXY: process.env.TRUST_PROXY,
  };
}

/**
 * Preview builds run without server secrets (see tools/deployment-policy.ts). Storefront pages then
 * skip build-time prerendering and render on their first request instead; runtime validation in
 * getServerEnv() is unchanged.
 */
export function canPrerenderWithData(): boolean {
  return isServerEnvConfigured(serverEnvInput());
}

let cachedEnvironment: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  cachedEnvironment ??= parseServerEnv(serverEnvInput());
  return cachedEnvironment;
}
