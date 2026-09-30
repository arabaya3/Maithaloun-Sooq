import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { scheduledJobs } from "@/features/admin/application/admin-services";
import { todayInStoreZone } from "@/shared/lib/store-time";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

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

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false }, { status: 401, headers });
  }
  const result = await scheduledJobs.runDaily(todayInStoreZone());
  return NextResponse.json(
    { ok: result.status !== "failed", ...result },
    { status: result.status === "failed" ? 500 : 200, headers },
  );
}
