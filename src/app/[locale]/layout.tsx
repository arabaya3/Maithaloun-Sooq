import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { directionOf, locales } from "@/i18n/config";
import { I18nProvider } from "@/i18n/i18n-provider";
import { getLocale, getMessages } from "@/i18n/server";

import { baseMetadata } from "../base-metadata";

import "../globals.css";

// Only the two storefront languages exist; any other first segment is a static 404, never a render.
export const dynamicParams = false;

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
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
