import { NextResponse } from "next/server";

import {
  allowPublicApiRequest,
  noStoreHeaders,
  readJsonBody,
} from "@/features/commerce/api-guard";
import {
  CAMPAIGN_COOKIE,
  CAMPAIGN_COOKIE_MAX_AGE,
  CampaignAttribution,
  isAutomatedVisit,
  isCampaignCode,
} from "@/features/social/application/campaign-attribution";
import { db } from "@/server/db/db";

export const dynamic = "force-dynamic";

/**
 * A landing from a tracked campaign link: counts it and remembers the campaign in a first-party
 * cookie so a later order can be attributed. The answer is the same whether or not the code is
 * known, and no visitor data is stored.
 */
export async function POST(request: Request) {
  const done = new NextResponse(null, { status: 204, headers: noStoreHeaders });
  if (!(await allowPublicApiRequest(request, "api:campaign-visit", 30)))
    return done;
  const body = await readJsonBody(request, 200);
  const code = body.ok ? (body.value as { code?: unknown })?.code : null;
  if (!isCampaignCode(code)) return done;
  if (isAutomatedVisit(request.headers.get("user-agent"))) return done;
  const postId = await new CampaignAttribution(db).recordVisit(code);
  if (postId) {
    done.cookies.set(CAMPAIGN_COOKIE, code, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: CAMPAIGN_COOKIE_MAX_AGE,
    });
  }
  return done;
}
