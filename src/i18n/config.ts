export const locales = ["ar", "en"] as const;
export type Locale = (typeof locales)[number];

// Arabic keeps the existing addresses; English lives under /en.
export const defaultLocale: Locale = "ar";
export const LOCALE_COOKIE = "maytha_locale";
export const LOCALE_HEADER = "x-maytha-locale";
export const PATH_HEADER = "x-maytha-path";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return value === "ar" || value === "en";
}

export function directionOf(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}

/**
 * The browser's own preference order decides: Arabic only when the visitor prefers it,
 * any other language falls back to English. No header at all (crawlers) keeps the default.
 */
export function localeFromAcceptLanguage(header: string | null): Locale {
  if (!header?.trim()) return defaultLocale;
  const ranked = header
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params
        .map((param) => param.trim())
        .find((param) => param.startsWith("q="));
      const quality = q ? Number(q.slice(2)) : 1;
      return {
        language: tag.toLowerCase().split("-")[0] ?? "",
        quality: Number.isFinite(quality) ? quality : 0,
        index,
      };
    })
    .filter((entry) => entry.language && entry.quality > 0)
    .sort(
      (left, right) => right.quality - left.quality || left.index - right.index,
    );
  for (const entry of ranked) {
    if (entry.language === "ar") return "ar";
    if (entry.language === "en") return "en";
  }
  return "en";
}

/** Splits a pathname into its locale and the shared, unprefixed path. */
export function splitLocalePath(pathname: string): {
  locale: Locale;
  path: string;
} {
  if (pathname === "/en" || pathname.startsWith("/en/")) {
    return { locale: "en", path: pathname.slice(3) || "/" };
  }
  return { locale: "ar", path: pathname };
}

export function localizePath(locale: Locale, path: string): string {
  if (locale === "ar" || !path.startsWith("/") || path.startsWith("//")) {
    return path;
  }
  if (path === "/en" || path.startsWith("/en/")) return path;
  // The home page with a query or hash stays /en?q=… rather than /en/?q=….
  if (path === "/" || path.startsWith("/?") || path.startsWith("/#")) {
    return `/en${path.slice(1)}`;
  }
  return `/en${path}`;
}
