import "server-only";

import { headers } from "next/headers";

import {
  defaultLocale,
  isLocale,
  LOCALE_HEADER,
  PATH_HEADER,
  type Locale,
} from "./config";
import { messagesFor } from "./messages";

/** The locale the proxy chose for this request; Arabic outside the storefront. */
export async function getLocale(): Promise<Locale> {
  const value = (await headers()).get(LOCALE_HEADER);
  return isLocale(value) ? value : defaultLocale;
}

/** The unprefixed path of this request, for canonical and alternate links. */
export async function getRequestPath(): Promise<string> {
  return (await headers()).get(PATH_HEADER) ?? "/";
}

export async function getMessages() {
  return messagesFor(await getLocale());
}
