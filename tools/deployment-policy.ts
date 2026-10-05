export type BuildEnvironment = Readonly<Record<string, string | undefined>>;

export const requiredProductionVariables = [
  "DATABASE_URL",
  "APP_ORIGIN",
  "ORDER_RATE_LIMIT_PEPPER",
] as const;

const isLocalHost = (databaseUrl: string) =>
  ["127.0.0.1", "localhost"].includes(new URL(databaseUrl).hostname);

// Only a Production deployment (or an explicit operator opt-in) may change a remote schema; Preview never does.
export function mayChangeRemoteSchema(
  environment: BuildEnvironment,
  databaseUrl: string,
): boolean {
  if (isLocalHost(databaseUrl)) return false;
  return (
    environment.VERCEL_ENV === "production" ||
    environment.APPLY_DB_MIGRATIONS === "1"
  );
}

export function missingProductionVariables(
  environment: BuildEnvironment,
): string[] {
  if (environment.VERCEL_ENV !== "production") return [];
  return requiredProductionVariables.filter(
    (name) => !environment[name]?.trim(),
  );
}
