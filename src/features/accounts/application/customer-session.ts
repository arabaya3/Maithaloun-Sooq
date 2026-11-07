import "server-only";

import { cookies, headers } from "next/headers";
import { cache } from "react";

import { getApprovedNetworkKey } from "@/features/admin/auth/rate-limit-key";
import {
  isTrustedMutationOrigin,
  isTrustedMutationSite,
} from "@/features/admin/auth/trusted-origin";
import {
  CUSTOMER_SESSION_ABSOLUTE_MS,
  customerAccountsEnabled,
} from "@/features/accounts/domain/account-config";
import { SIGNED_IN_MARKER_COOKIE } from "@/features/accounts/domain/signed-in-marker";
import { getServerEnv } from "@/server/env/env";

import type { CustomerActor } from "./customer-auth-service";
import { customerAuthService } from "./customer-services";

export function customerSessionCookieName(): string {
  return process.env.NODE_ENV === "production"
    ? "__Host-souq-customer"
    : "souq_customer_session";
}

// Lax so links from WhatsApp keep the customer signed in; mutations are origin-checked separately.
function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

// Readable by the page and carries no secret: it only says "ask the server who is signed in".
function markerOptions(maxAgeSeconds: number) {
  return { ...cookieOptions(maxAgeSeconds), httpOnly: false };
}

export async function readCustomerSessionToken(): Promise<string | null> {
  return (await cookies()).get(customerSessionCookieName())?.value ?? null;
}

export async function writeCustomerSessionCookie(rawToken: string) {
  const maxAge = Math.floor(CUSTOMER_SESSION_ABSOLUTE_MS / 1_000);
  const store = await cookies();
  store.set(customerSessionCookieName(), rawToken, cookieOptions(maxAge));
  store.set(SIGNED_IN_MARKER_COOKIE, "1", markerOptions(maxAge));
}

export async function clearCustomerSessionCookie() {
  const store = await cookies();
  store.set(customerSessionCookieName(), "", cookieOptions(0));
  store.set(SIGNED_IN_MARKER_COOKIE, "", markerOptions(0));
}

/** Keeps the readable marker in step with the session (sessions from before it existed, expiry). */
export async function syncSignedInMarker(signedIn: boolean) {
  const store = await cookies();
  const present = store.get(SIGNED_IN_MARKER_COOKIE)?.value === "1";
  if (signedIn && !present) {
    store.set(
      SIGNED_IN_MARKER_COOKIE,
      "1",
      markerOptions(Math.floor(CUSTOMER_SESSION_ABSOLUTE_MS / 1_000)),
    );
  } else if (!signedIn && present) {
    store.set(SIGNED_IN_MARKER_COOKIE, "", markerOptions(0));
  }
}

export const getCustomerSession = cache(
  async (): Promise<CustomerActor | null> => {
    if (!customerAccountsEnabled()) return null;
    const token = await readCustomerSessionToken();
    return token ? customerAuthService.lookup(token) : null;
  },
);

export async function isTrustedCustomerMutation(): Promise<boolean> {
  const requestHeaders = await headers();
  return (
    isTrustedMutationOrigin(
      requestHeaders.get("origin"),
      getServerEnv().APP_ORIGIN,
    ) && isTrustedMutationSite(requestHeaders.get("sec-fetch-site"))
  );
}

export async function customerNetworkKey(): Promise<string | null> {
  return getApprovedNetworkKey(await headers(), getServerEnv().trustProxy);
}
