import "server-only";

import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { getServerEnv } from "@/server/env/env";

import { getAdminSession } from "./admin-session";
import {
  isTrustedMutationOrigin,
  isTrustedMutationSite,
} from "./trusted-origin";

export async function authorizeAdminApi(
  request: Request,
  mutation = false,
): Promise<AdminActor | null> {
  const actor = await getAdminSession();
  if (!actor?.active) return null;
  if (!mutation) return actor;
  const { APP_ORIGIN } = getServerEnv();
  if (
    !isTrustedMutationOrigin(request.headers.get("origin"), APP_ORIGIN) ||
    !isTrustedMutationSite(request.headers.get("sec-fetch-site"))
  ) {
    return null;
  }
  return actor;
}
