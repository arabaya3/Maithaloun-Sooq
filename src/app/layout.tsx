import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { directionOf, localizePath } from "@/i18n/config";
import { I18nProvider } from "@/i18n/i18n-provider";
import { getLocale, getMessages, getRequestPath } from "@/i18n/server";

import { baseMetadata } from "./base-metadata";

import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const [locale, m, path] = await Promise.all([
    getLocale(),
    getMessages(),
    getRequestPath(),
  ]);
  return {
    ...baseMetadata,
    title: { default: "MAYTHA MARKET", template: "%s | MAYTHA MARKET" },
    description: m.meta.siteDescription,
    // Each page names both languages; Arabic is the default for everyone else.
    alternates: {
      canonical: localizePath(locale, path),
      languages: {
        ar: path,
        en: localizePath("en", path),
        "x-default": path,
      },
    },
    openGraph: {
      siteName: "MAYTHA MARKET",
      locale: locale === "ar" ? "ar_PS" : "en_US",
      alternateLocale: locale === "ar" ? "en_US" : "ar_PS",
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#183D32",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const locale = await getLocale();
  return (
    <html
      lang={locale}
      dir={directionOf(locale)}
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <body className="storefront-font-scope">
        <I18nProvider locale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
