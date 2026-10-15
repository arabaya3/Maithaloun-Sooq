import { NextResponse } from "next/server";

import { appleAppSiteAssociation } from "@/features/mobile/app-links";

export const dynamic = "force-dynamic";

/** Served at /.well-known/apple-app-site-association (see next.config rewrites). */
export function GET() {
  const body = appleAppSiteAssociation(process.env.APPLE_TEAM_ID);
  if (!body) return new NextResponse(null, { status: 404 });
  return NextResponse.json(body, {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
