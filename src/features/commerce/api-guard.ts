import "server-only";

import { NextResponse } from "next/server";

import { isLocale, type Locale } from "@/i18n/config";
import { db } from "@/server/db/db";
import { getServerEnv } from "@/server/env/env";

import { hitPublicApiBudget } from "./public-api-limit";

export const noStoreHeaders = { "Cache-Control": "no-store, max-age=0" };
// Catalog reads change rarely and are the same for everyone, so the edge may keep them briefly.
export const catalogCacheHeaders = {
  "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
};

export function apiLocale(request: Request): Locale {
  const url = new URL(request.url);
  const requested =
    url.searchParams.get("locale") ?? request.headers.get("accept-language");
  const short = requested?.slice(0, 2).toLowerCase() ?? null;
  return isLocale(short) ? short : "ar";
}

export function apiError(code: string, status: number) {
  return NextResponse.json(
    { ok: false, error: code },
    { status, headers: noStoreHeaders },
  );
}

/** Per-client request budget for the public API, inside a shared ceiling for all clients. */
export async function allowPublicApiRequest(
  request: Request,
  scope: string,
  limit: number,
): Promise<boolean> {
  const env = getServerEnv();
  return hitPublicApiBudget(db, {
    pepper: env.ORDER_RATE_LIMIT_PEPPER,
    scope,
    limit,
    headers: request.headers,
    source: {
      trustProxy: env.trustProxy,
      onVercel: process.env.VERCEL === "1",
    },
  });
}

export async function readJsonBody(
  request: Request,
  maxBytes: number,
): Promise<
  { ok: true; value: unknown } | { ok: false; status: number; code: string }
> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return { ok: false, status: 415, code: "unsupported_format" };
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    return { ok: false, status: 413, code: "too_large" };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, code: "unreadable" };
  }
}
