"use client";

import { usePathname } from "next/navigation";

import {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  localizePath,
  splitLocalePath,
} from "./config";
import { useI18n } from "./i18n-provider";

/**
 * A plain link, so the browser loads the same page in the other language with the
 * document's lang and direction; the click saves the choice first. The cart lives in
 * local storage and is kept.
 */
export function LanguageSwitcher({ className = "" }: { className?: string }) {
  const { locale, m } = useI18n();
  const pathname = usePathname() ?? "/";
  const next = locale === "ar" ? "en" : "ar";
  const target = localizePath(next, splitLocalePath(pathname).path);

  return (
    <a
      href={target}
      hrefLang={next}
      lang={next}
      className={`language-switcher ${className}`.trim()}
      aria-label={m.common.languageSwitchLabel}
      onClick={(event) => {
        document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
        // Keep the current search and section, e.g. a category filter.
        event.currentTarget.href = `${target}${window.location.search}${window.location.hash}`;
      }}
    >
      {m.common.languageSwitch}
    </a>
  );
}
