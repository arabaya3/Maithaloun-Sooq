import { randomBytes } from "node:crypto";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { authorizeAdminApi } from "@/features/admin/auth/authorize-admin-api";
import { can } from "@/features/admin/domain/permissions";
import { socialEnabled } from "@/features/social/application/social-instance";
import {
  loginDialogUrl,
  OAUTH_STATE_COOKIE,
} from "@/features/social/infrastructure/meta-oauth";
import { getServerEnv } from "@/server/env/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Starts Facebook Login for the owner; the state cookie ties the callback to this browser. */
export async function GET(request: Request) {
  const actor = await authorizeAdminApi(request);
  const appId = process.env.META_APP_ID;
  if (
    !socialEnabled() ||
    !actor ||
    !can(actor, "social.approve") ||
    !appId ||
    !process.env.META_APP_SECRET
  ) {
    return new NextResponse(null, { status: 404 });
  }
  const state = randomBytes(32).toString("base64url");
  (await cookies()).set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/admin/api/social/meta",
    maxAge: 600,
  });
  const { APP_ORIGIN } = getServerEnv();
  return NextResponse.redirect(
    loginDialogUrl(
      {
        appId,
        appSecret: "",
        redirectUri: `${APP_ORIGIN}/admin/api/social/meta/callback`,
        graphVersion: process.env.META_GRAPH_VERSION || undefined,
        loginConfigId: process.env.META_LOGIN_CONFIG_ID || undefined,
      },
      state,
    ),
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
