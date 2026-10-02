"use client";

import { useSyncExternalStore } from "react";

import {
  FAVORITES_SNAPSHOT_KEY,
  readFavoritesSnapshot,
} from "./favorites-snapshot";

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(FAVORITES_SNAPSHOT_KEY);
  } catch {
    return null;
  }
}

export function OfflineFavorites() {
  const raw = useSyncExternalStore(
    () => () => undefined,
    readRaw,
    () => null,
  );
  const saved = readFavoritesSnapshot(raw);
  if (!saved.length) return null;
  return (
    <section className="offline-favorites" aria-labelledby="offline-favorites">
      <h2 id="offline-favorites">مفضلتك المحفوظة على هذا الجهاز</h2>
      <ul>
        {saved.map((item) => (
          <li key={item.id}>{item.name}</li>
        ))}
      </ul>
      <p>الأسعار والتوفر تظهر عند عودة الاتصال.</p>
    </section>
  );
}
