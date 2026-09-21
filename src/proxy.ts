import { NextResponse, type NextRequest } from "next/server";

import { getSafeAdminRedirect } from "@/features/admin/auth/safe-redirect";
import { getAdminSessionCookieName } from "@/features/admin/auth/session-cookie";

function withAdminPrivacy(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return response;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!pathname.startsWith("/admin")) {
    return NextResponse.next();
  }

  if (pathname === "/admin/login") {
    return withAdminPrivacy(NextResponse.next());
  }

  const sessionToken = request.cookies.get(getAdminSessionCookieName())?.value;
  if (sessionToken) {
    return withAdminPrivacy(NextResponse.next());
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/admin/login";
  loginUrl.search = "";
  const nextPath = getSafeAdminRedirect(`${pathname}${request.nextUrl.search}`);
  if (nextPath !== "/admin") {
    loginUrl.searchParams.set("next", nextPath);
  }
  return withAdminPrivacy(NextResponse.redirect(loginUrl));
}

export const config = {
  matcher: ["/admin/:path*"],
};
