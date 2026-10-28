import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import {
  socialEnabled,
  socialService,
} from "@/features/social/application/social-instance";
import { makeCallbackSchema } from "@/features/social/infrastructure/make-payload";
import { makeCallbackSecret } from "@/features/social/infrastructure/make-publisher";
import { logEvent } from "@/server/log/ops-log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { "Cache-Control": "no-store, max-age=0" };
const MAX_BYTES = 8_000;

function sameSecret(provided: string | null, expected: string): boolean {
  const left = Buffer.from(provided ?? "");
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * The Make scenario reports Facebook's real result for a post it was handed. It must present the
 * shared callback secret, name a post that is waiting for Make, and carry that post's approval key.
 * It can only settle a post; it can never approve or publish one.
 */
export async function POST(request: Request) {
  const secret = makeCallbackSecret(process.env);
  if (!socialEnabled() || !secret) {
    return NextResponse.json({ ok: false }, { status: 404, headers });
  }
  if (!sameSecret(request.headers.get("x-maytha-callback-key"), secret)) {
    return NextResponse.json({ ok: false }, { status: 401, headers });
  }
  const raw = await request.text();
  if (raw.length > MAX_BYTES) {
    return NextResponse.json({ ok: false }, { status: 413, headers });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400, headers });
  }
  const parsed = makeCallbackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false }, { status: 400, headers });
  }
  const result = await socialService.confirmFromProvider({
    postId: parsed.data.post_id,
    idempotencyKey: parsed.data.idempotency_key,
    status: parsed.data.status,
    facebookPostId: parsed.data.facebook_post_id,
    error: parsed.data.error,
  });
  logEvent("info", "social_make_callback", {
    status: parsed.data.status,
    result,
  });
  // «ignored» is still a 200: the scenario must not retry a report we have deliberately set aside.
  return NextResponse.json({ ok: true, result }, { headers });
}
