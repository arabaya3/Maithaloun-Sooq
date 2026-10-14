import { NextResponse } from "next/server";

import { androidAssetLinks } from "@/features/mobile/app-links";

export const dynamic = "force-dynamic";

/** Served at /.well-known/assetlinks.json (see next.config rewrites). */
export function GET() {
  const body = androidAssetLinks(process.env.ANDROID_APP_CERT_SHA256);
  if (!body) return new NextResponse(null, { status: 404 });
  return NextResponse.json(body, {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
