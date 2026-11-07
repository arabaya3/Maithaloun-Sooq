import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { notFound } from "next/navigation";

import { directionOf, isLocale, locales } from "@/i18n/config";
import { I18nProvider } from "@/i18n/i18n-provider";
import { getLocale, getMessages } from "@/i18n/server";
import { canPrerenderWithData } from "@/server/env/env";

import { baseMetadata } from "../base-metadata";

import "../globals.css";

// Only the two storefront languages exist: the layout 404s anything else, and the proxy rewrites every
// Arabic address to /ar, so other first segments only arrive for file-like scanner paths.
// With server env (Production) both languages are prerendered at build. Without it (Preview builds
// have no secrets) nothing is prerendered and pages render on first request, then stay cached.
export function generateStaticParams() {
  return canPrerenderWithData() ? locales.map((locale) => ({ locale })) : [];
}

export async function generateMetadata(): Promise<Metadata> {
  const [locale, m] = await Promise.all([getLocale(), getMessages()]);
  return {
    ...baseMetadata,
    title: { default: "MAYTHA MARKET", template: "%s | MAYTHA MARKET" },
    description: m.meta.siteDescription,
    openGraph: {
      siteName: "MAYTHA MARKET",
      locale: locale === "ar" ? "ar_PS" : "en_US",
      alternateLocale: locale === "ar" ? "en_US" : "ar_PS",
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#0E5A2F",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  // Dynamic child segments (products, brands, categories) reopen params, so check the language here.
  if (!isLocale((await params).locale)) notFound();
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
