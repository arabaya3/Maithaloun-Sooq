import { NextResponse, type NextRequest } from "next/server";

import { getSafeAdminRedirect } from "@/features/admin/auth/safe-redirect";
import { getAdminSessionCookieName } from "@/features/admin/auth/session-cookie";
import {
  isLocale,
  LOCALE_COOKIE,
  LOCALE_HEADER,
  localeFromAcceptLanguage,
  localizePath,
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

/**
 * Every storefront page lives under `app/[locale]`, so the language is part of the route and pages can be
 * served from the static cache. English keeps its /en address; Arabic addresses have no prefix and are
 * rewritten to /ar internally. The header is only for Server Actions, which cannot read the route.
 */
function forward(request: NextRequest, locale: Locale, path: string) {
  const headers = new Headers(request.headers);
  headers.set(LOCALE_HEADER, locale);
  if (locale === "en") return NextResponse.next({ request: { headers } });
  const url = request.nextUrl.clone();
  url.pathname = path === "/" ? "/ar" : `/ar${path}`;
  const response = NextResponse.rewrite(url, { request: { headers } });
  response.headers.append("Vary", "Accept-Language, Cookie");
  return response;
}

// Vulnerability scanners probe these by the thousand. None is a store address, so they get a tiny,
// CDN-cacheable 404 here instead of a rendered page.
const SCANNER_PATH =
  /^\/(?:wp-|wp\/|wordpress|xmlrpc|cgi-bin|phpmyadmin|myadmin|pma\/|\.env|\.git|\.svn|\.hg|\.aws|\.ssh|\.vscode|\.ds_store|vendor\/|actuator|server-status|boaform|hnap1|owa\/|autodiscover|telescope|_ignition|administrator)|\.(?:php\d?|aspx?|jsp|cgi|env|ini|sql|bak|swp)$/i;

export function isScannerPath(pathname: string): boolean {
  return SCANNER_PATH.test(pathname);
}

function scannerNotFound() {
  return new NextResponse("Not found", {
    status: 404,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
      "X-Robots-Tag": "noindex",
    },
  });
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
  if (isScannerPath(pathname)) return scannerNotFound();
  // The internal Arabic prefix is never a public address.
  if (pathname === "/ar" || pathname.startsWith("/ar/")) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.slice(3) || "/";
    return NextResponse.redirect(url, 308);
  }
  return storefrontProxy(request, pathname);
}

export const config = {
  matcher: [
    "/admin/:path*",
    // File-like scanner probes (wp-login.php, .env, …) skip the storefront entry below; catching them here
    // returns a tiny 404 instead of letting them reach a page render.
    "/(.*\\.(?:php\\d?|aspx?|jsp|cgi|env|ini|sql|bak|swp))",
    "/(\\.(?:env|git|svn|hg|aws|ssh).*)",
    // Storefront pages only: no API, Next internals, service worker, manifests or files.
    "/((?!api|_next|admin|\\.well-known|sw\\.js|swe-worker|manifest\\.webmanifest|admin-manifest\\.webmanifest|robots\\.txt|sitemap\\.xml|opengraph-image|favicon\\.ico|.*\\.[a-zA-Z0-9]+$).*)",
  ],
};
