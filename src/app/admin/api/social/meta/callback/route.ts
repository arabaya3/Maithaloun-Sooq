import { timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { authorizeAdminApi } from "@/features/admin/auth/authorize-admin-api";
import { can } from "@/features/admin/domain/permissions";
import { SocialError } from "@/features/social/application/social-service";
import {
  socialEnabled,
  socialService,
} from "@/features/social/application/social-instance";
import {
  choosePage,
  OAUTH_STATE_COOKIE,
  pagesFromLoginCode,
} from "@/features/social/infrastructure/meta-oauth";
import { errorCode, logEvent } from "@/server/log/ops-log";
import { getServerEnv } from "@/server/env/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function sameState(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function GET(request: Request) {
  const { APP_ORIGIN } = getServerEnv();
  const back = (result: string) =>
    NextResponse.redirect(
      `${APP_ORIGIN}/admin/social/settings?facebook=${result}`,
      {
        headers: { "Cache-Control": "no-store, max-age=0" },
      },
    );
  const actor = await authorizeAdminApi(request);
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (
    !socialEnabled() ||
    !actor ||
    !can(actor, "social.approve") ||
    !appId ||
    !appSecret
  ) {
    return new NextResponse(null, { status: 404 });
  }
  const params = new URL(request.url).searchParams;
  const jar = await cookies();
  const expected = jar.get(OAUTH_STATE_COOKIE)?.value;
  jar.delete({ name: OAUTH_STATE_COOKIE, path: "/admin/api/social/meta" });
  if (!sameState(params.get("state"), expected)) return back("state");
  const code = params.get("code");
  if (!code) return back("cancelled");
  try {
    const pages = await pagesFromLoginCode(
      {
        appId,
        appSecret,
        redirectUri: `${APP_ORIGIN}/admin/api/social/meta/callback`,
        graphVersion: process.env.META_GRAPH_VERSION || undefined,
      },
      code,
    );
    const page = choosePage(
      pages,
      process.env.SOCIAL_PAGE_ID?.trim() || undefined,
    );
    if (!page) return back("no_page");
    await socialService.connectPage(actor, {
      pageId: page.id,
      pageName: page.name,
      token: page.accessToken,
    });
    return back("connected");
  } catch (error) {
    logEvent("warn", "social_oauth_failed", { code: errorCode(error) });
    return back(error instanceof SocialError ? error.code : "failed");
  }
}
