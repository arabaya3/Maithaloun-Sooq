import "server-only";

import type { Metadata } from "next";
import { headers } from "next/headers";
import { locale as localeParam } from "next/root-params";

import {
  defaultLocale,
  isLocale,
  LOCALE_HEADER,
  localizePath,
  type Locale,
} from "./config";
import { messagesFor } from "./messages";

/**
 * The storefront language comes from the route itself (`app/[locale]`), so pages stay
 * statically renderable: reading request headers here would make every page dynamic.
 * Outside the storefront (admin) there is no locale segment and Arabic applies.
 */
export async function getLocale(): Promise<Locale> {
  const value = await localeParam();
  return isLocale(value) ? value : defaultLocale;
}

export async function getMessages() {
  return messagesFor(await getLocale());
}

/**
 * Server Actions cannot read root params; they post to the page address, where the proxy
 * names the language in a request header.
 */
export async function getActionLocale(): Promise<Locale> {
  const value = (await headers()).get(LOCALE_HEADER);
  return isLocale(value) ? value : defaultLocale;
}

export async function getActionMessages() {
  return messagesFor(await getActionLocale());
}

/** Canonical and alternate links for one unprefixed storefront path. */
export async function localizedAlternates(
  path: string,
): Promise<NonNullable<Metadata["alternates"]>> {
  const locale = await getLocale();
  return {
    canonical: localizePath(locale, path),
    languages: {
      ar: path,
      en: localizePath("en", path),
      "x-default": path,
    },
  };
}
