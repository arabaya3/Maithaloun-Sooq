import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import {
  socialEnabled,
  socialJobs,
} from "@/features/social/application/social-instance";
import {
  socialJobNames,
  type SocialJobName,
} from "@/features/social/application/social-jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const headers = { "Cache-Control": "no-store, max-age=0" };

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32) return false;
  const provided = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return (
    provided.length === expected.length && timingSafeEqual(provided, expected)
  );
}

/**
 * Social jobs for schedulers: `?run=tick` publishes what is due (every 15 minutes from the free
 * GitHub Actions worker), `?run=daily` prepares drafts and reports (Vercel's daily cron).
 */
export async function GET(request: Request) {
  if (!socialEnabled())
    return NextResponse.json({ ok: false }, { status: 404, headers });
  if (!isAuthorized(request))
    return NextResponse.json({ ok: false }, { status: 401, headers });
  const run = new URL(request.url).searchParams.get("run") ?? "tick";
  let results;
  if (run === "tick") results = await socialJobs.tick();
  else if (run === "daily") results = await socialJobs.daily();
  else if ((socialJobNames as readonly string[]).includes(run))
    results = [await socialJobs.run(run as SocialJobName)];
  else return NextResponse.json({ ok: false }, { status: 400, headers });
  const failed = results.some((result) => result.status === "failed");
  return NextResponse.json(
    { ok: !failed, results },
    { status: failed ? 500 : 200, headers },
  );
}
