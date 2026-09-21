import "server-only";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { getServerEnv } from "@/server/env/env";

import { getApprovedNetworkKey } from "./rate-limit-key";
import { getSafeAdminRedirect } from "./safe-redirect";
import {
  getAdminSessionCookieName,
  getAdminSessionCookieOptions,
} from "./session-cookie";
import {
  isTrustedMutationOrigin,
  isTrustedMutationSite,
} from "./trusted-origin";
import { adminSessionService } from "./session-service-instance";

export {
  getAdminSessionCookieName,
  getAdminSessionCookieOptions,
} from "./session-cookie";

export async function readAdminSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(getAdminSessionCookieName())?.value ?? null;
}

export async function writeAdminSessionCookie(rawToken: string): Promise<void> {
  const store = await cookies();
  store.set(
    getAdminSessionCookieName(),
    rawToken,
    getAdminSessionCookieOptions(),
  );
}

export async function clearAdminSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(getAdminSessionCookieName(), "", {
    ...getAdminSessionCookieOptions(),
    maxAge: 0,
  });
}

export async function getAdminSession(): Promise<AdminActor | null> {
  const token = await readAdminSessionToken();
  if (!token) return null;
  return adminSessionService.lookup(token);
}

export async function requireAdminSession(): Promise<AdminActor> {
  const actor = await getAdminSession();
  if (!actor) {
    redirect("/admin/login");
  }
  return actor;
}

export async function requireTrustedAdminMutation(): Promise<AdminActor> {
  const requestHeaders = await headers();
  const { APP_ORIGIN } = getServerEnv();
  if (
    !isTrustedMutationOrigin(requestHeaders.get("origin"), APP_ORIGIN) ||
    !isTrustedMutationSite(requestHeaders.get("sec-fetch-site"))
  ) {
    redirect("/admin/login");
  }
  return requireAdminSession();
}

export function getLoginRedirectTarget(nextValue: string | null): string {
  return getSafeAdminRedirect(nextValue);
}

export function getTrustedNetworkKey(requestHeaders: Headers): string | null {
  return getApprovedNetworkKey(requestHeaders, getServerEnv().trustProxy);
}
