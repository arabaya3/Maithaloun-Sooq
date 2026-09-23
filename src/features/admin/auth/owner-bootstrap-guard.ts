import { OwnerBootstrapError } from "./owner-service";

export function assertOwnerBootstrapDatabase(databaseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new OwnerBootstrapError("LOCAL_DEV_ONLY");
  }

  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/maithalun_dev"
  ) {
    throw new OwnerBootstrapError("LOCAL_DEV_ONLY");
  }

  return "maithalun_dev";
}

export function assertProductionOwnerBootstrapDatabase(
  databaseUrl: string,
  allowFlag: string | undefined,
): string {
  if (allowFlag !== "1") {
    throw new OwnerBootstrapError("PRODUCTION_BOOTSTRAP_DISABLED");
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new OwnerBootstrapError("INVALID_DATABASE_URL");
  }

  const host = parsed.hostname.toLowerCase();
  const isSupabase =
    host.endsWith(".supabase.co") || host.endsWith(".pooler.supabase.com");
  if (!isSupabase) {
    throw new OwnerBootstrapError("PRODUCTION_DB_REQUIRED");
  }

  return "production";
}
