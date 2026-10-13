import type { Locale } from "../config";

import { account } from "./account";
import { cart } from "./cart";
import { catalog } from "./catalog";
import { checkout } from "./checkout";
import { common } from "./common";
import { meta } from "./meta";
import { misc } from "./misc";
import { orders } from "./orders";
import { info } from "./info";
import { pwa } from "./pwa";
import { store } from "./store";

// One file per area keeps each Arabic text next to its English one.
const namespaces = {
  account,
  cart,
  catalog,
  checkout,
  common,
  info,
  meta,
  misc,
  orders,
  pwa,
  store,
};

type Namespaces = typeof namespaces;
export type Messages = { [K in keyof Namespaces]: Namespaces[K]["ar"] };

function build(locale: Locale): Messages {
  return Object.fromEntries(
    Object.entries(namespaces).map(([key, value]) => [key, value[locale]]),
  ) as Messages;
}

const dictionaries: Record<Locale, Messages> = {
  ar: build("ar"),
  en: build("en"),
};

export function messagesFor(locale: Locale): Messages {
  return dictionaries[locale];
}
