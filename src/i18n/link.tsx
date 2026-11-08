"use client";

import NextLink from "next/link";
import type { ComponentProps } from "react";

import { localizePath } from "./config";
import { useLocale } from "./i18n-provider";

/** next/link that keeps the visitor in their language: internal paths gain /en in English. */
export function Link({ href, onNavigate, ...props }: ComponentProps<typeof NextLink>) {
  const locale = useLocale();
  const localized =
    typeof href === "string" ? localizePath(locale, href) : href;
  return (
    <NextLink
      href={localized}
      {...props}
      onNavigate={(event) => {
        onNavigate?.(event);
        if (typeof localized !== "string" || !/^\/(?:en\/)?products\/[^/?#]+/.test(localized)) return;
        const destination = new URL(localized, window.location.href);
        if (destination.pathname !== window.location.pathname) {
          sessionStorage.setItem("maytha:product-navigation", destination.pathname);
        }
      }}
    />
  );
}
