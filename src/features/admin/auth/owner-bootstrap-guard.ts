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
