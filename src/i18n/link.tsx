"use client";

import NextLink from "next/link";
import type { ComponentProps } from "react";

import { localizePath } from "./config";
import { useLocale } from "./i18n-provider";

/** next/link that keeps the visitor in their language: internal paths gain /en in English. */
export function Link({ href, ...props }: ComponentProps<typeof NextLink>) {
  const locale = useLocale();
  const localized =
    typeof href === "string" ? localizePath(locale, href) : href;
  return <NextLink href={localized} {...props} />;
}
