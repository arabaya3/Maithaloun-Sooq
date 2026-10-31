import { localizePath, type Locale } from "@/i18n/config";

export const OLD_STORE_HOST = "maithaloun-sooq.vercel.app";
export const NEW_STORE_ORIGIN = "https://www.maytha.app";

const CART_HASH = "#moved-cart=";

/** The cart travels in the hash, which browsers never send to a server. */
export function domainMoveLink(locale: Locale, cart: string | null) {
  const hash = cart ? `${CART_HASH}${encodeURIComponent(cart)}` : "";
  return `${NEW_STORE_ORIGIN}${localizePath(locale, "/")}${hash}`;
}

export function readMovedCart(hash: string) {
  if (!hash.startsWith(CART_HASH)) return null;
  try {
    return decodeURIComponent(hash.slice(CART_HASH.length));
  } catch {
    return null;
  }
}
