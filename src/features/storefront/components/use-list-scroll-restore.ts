"use client";

import { useEffect } from "react";

const PREFIX = "maytha:list-scroll:";
// Back and forward only: a fresh visit to the same list starts at the top.
let poppedAt = 0;
if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    poppedAt = Date.now();
  });
}

function currentKey(): string {
  return `${PREFIX}${window.location.pathname}${window.location.search}`;
}

function cameBack(): boolean {
  if (Date.now() - poppedAt < 5_000) return true;
  const [entry] = performance.getEntriesByType?.("navigation") ?? [];
  return (
    (entry as PerformanceNavigationTiming | undefined)?.type === "back_forward"
  );
}

/** Opening a product remembers where the list was; coming back puts the shopper there again. */
export function saveListScroll(): void {
  try {
    window.sessionStorage.setItem(currentKey(), String(window.scrollY));
  } catch {
    // Storage can be blocked; coming back then simply starts at the top.
  }
}

/**
 * Keeps a product list's scroll position across «open a product, press back». The filters, sort and
 * the number of products shown live in the address, so `ready` turns true once they are applied and
 * the list has its full height again.
 */
export function useListScrollRestore(ready: boolean): void {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const link = target?.closest?.("a[href]");
      if (link?.getAttribute("href")?.includes("/products/")) saveListScroll();
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener("pagehide", saveListScroll);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("pagehide", saveListScroll);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    let saved: string | null = null;
    try {
      saved = window.sessionStorage.getItem(currentKey());
      window.sessionStorage.removeItem(currentKey());
    } catch {
      return;
    }
    const top = Number(saved);
    if (saved === null || !Number.isFinite(top) || !cameBack()) return;
    const frame = window.requestAnimationFrame(() =>
      window.scrollTo({ top, behavior: "instant" }),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [ready]);
}
