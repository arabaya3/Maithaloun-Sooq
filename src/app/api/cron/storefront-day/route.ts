import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { revalidateStorefront } from "@/features/catalog/application/revalidate-storefront";
import { todayInStoreZone } from "@/shared/lib/store-time";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { "Cache-Control": "no-store, max-age=0" };

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // Without a configured secret the endpoint stays closed.
  if (!secret || secret.length < 32) return false;
  const provided = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return (
    provided.length === expected.length && timingSafeEqual(provided, expected)
  );
}

/**
 * Called just after midnight in Hebron: the storefront is re-rendered on its next visit, so «today's
 * category» moves to the new day's category. It only refreshes cached pages; no data changes.
 */
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false }, { status: 401, headers });
  }
  revalidateStorefront();
  return NextResponse.json(
    { ok: true, storeDate: todayInStoreZone() },
    { headers },
  );
}
