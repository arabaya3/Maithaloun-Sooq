"use client";

import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

import { CART_STORAGE_KEY } from "@/features/cart/cart-store";
import { splitLocalePath } from "@/i18n/config";
import { useI18n } from "@/i18n/i18n-provider";

import { domainMoveLink, OLD_STORE_HOST } from "./domain-move";

const noSubscription = () => () => {};

export function useOnOldStoreHost() {
  return useSyncExternalStore(
    noSubscription,
    () => window.location.hostname === OLD_STORE_HOST,
    () => false,
  );
}

export function DomainMoveNotice() {
  const pathname = usePathname();
  const { locale, m } = useI18n();
  const t = m.pwa;
  const onOldHost = useOnOldStoreHost();
  const [dismissed, setDismissed] = useState(false);

  // Dismissing lasts until the next visit, and checkout stays unobstructed.
  if (
    !onOldHost ||
    dismissed ||
    splitLocalePath(pathname).path === "/checkout"
  ) {
    return null;
  }

  function move() {
    let cart: string | null = null;
    try {
      cart = window.localStorage.getItem(CART_STORAGE_KEY);
    } catch {
      // The new site still opens, only without the cart.
    }
    window.location.assign(domainMoveLink(locale, cart));
  }

  return (
    <aside className="install-banner" aria-labelledby="domain-move-title">
      <div className="install-banner-copy">
        <p id="domain-move-title" className="install-banner-title">
          {t.moveTitle}
        </p>
        <p className="install-banner-text">{t.moveText}</p>
        <div className="install-banner-actions">
          <button
            type="button"
            className="install-banner-action"
            onClick={move}
          >
            {t.moveAction}
          </button>
          <button
            type="button"
            className="install-banner-later"
            onClick={() => setDismissed(true)}
          >
            {t.later}
          </button>
        </div>
      </div>
    </aside>
  );
}
