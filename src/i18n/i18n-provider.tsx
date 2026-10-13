"use client";

import { createContext, useContext, type ReactNode } from "react";

import { defaultLocale, localizePath, type Locale } from "./config";
import { messagesFor } from "./messages";

const LocaleContext = createContext<Locale>(defaultLocale);

export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  return (
    <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>
  );
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export function useI18n() {
  const locale = useLocale();
  return {
    locale,
    m: messagesFor(locale),
    href: (path: string) => localizePath(locale, path),
  };
}
