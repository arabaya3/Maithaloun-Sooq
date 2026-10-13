import { NextResponse, type NextRequest } from "next/server";

import { getSafeAdminRedirect } from "@/features/admin/auth/safe-redirect";
import { getAdminSessionCookieName } from "@/features/admin/auth/session-cookie";
import {
  isLocale,
  LOCALE_COOKIE,
  LOCALE_HEADER,
  localeFromAcceptLanguage,
  localizePath,
  PATH_HEADER,
  splitLocalePath,
  type Locale,
} from "@/i18n/config";

function withAdminPrivacy(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return response;
}

function adminProxy(request: NextRequest, pathname: string) {
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

function forward(request: NextRequest, locale: Locale, path: string) {
  const headers = new Headers(request.headers);
  headers.set(LOCALE_HEADER, locale);
  headers.set(PATH_HEADER, path);
  if (locale === "ar") {
    const response = NextResponse.next({ request: { headers } });
    response.headers.append("Vary", "Accept-Language, Cookie");
    return response;
  }
  const url = request.nextUrl.clone();
  url.pathname = path;
  return NextResponse.rewrite(url, { request: { headers } });
}

/**
 * Storefront language: an /en address always shows English. On an Arabic address the
 * visitor's saved choice wins, then the browser's language; only page loads are redirected.
 */
function storefrontProxy(request: NextRequest, pathname: string) {
  const { locale, path } = splitLocalePath(pathname);
  if (locale === "en") return forward(request, "en", path);

  // The service worker caches /~offline as the Arabic page; it must never be redirected.
  const isPageLoad =
    path !== "/~offline" &&
    (request.method === "GET" || request.method === "HEAD") &&
    !request.headers.has("next-action") &&
    !request.headers.has("rsc");
  const saved = request.cookies.get(LOCALE_COOKIE)?.value;
  const preferred: Locale = isLocale(saved)
    ? saved
    : localeFromAcceptLanguage(request.headers.get("accept-language"));
  if (isPageLoad && preferred === "en") {
    const url = request.nextUrl.clone();
    url.pathname = localizePath("en", path);
    const response = NextResponse.redirect(url, 307);
    response.headers.set("Vary", "Accept-Language, Cookie");
    return response;
  }
  return forward(request, "ar", path);
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/admin")) return adminProxy(request, pathname);
  return storefrontProxy(request, pathname);
}

export const config = {
  matcher: [
    "/admin/:path*",
    // Storefront pages only: no API, Next internals, service worker, manifests or files.
    "/((?!api|_next|admin|sw\\.js|swe-worker|manifest\\.webmanifest|admin-manifest\\.webmanifest|robots\\.txt|sitemap\\.xml|opengraph-image|favicon\\.ico|.*\\.[a-zA-Z0-9]+$).*)",
  ],
};
