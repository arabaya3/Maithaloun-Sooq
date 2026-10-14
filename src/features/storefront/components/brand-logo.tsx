"use client";

import { useI18n } from "@/i18n/i18n-provider";
import { Link } from "@/i18n/link";

export const STORE_NAME = "MAYTHA MARKET";
export const STORE_SUBTITLE = "HOME & CARE";

/** The MAYTHA MARKET monogram: an M whose central valley grows a leaf. Same geometry as tools/brand. */
export function BrandMonogram({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`brand-monogram ${className}`.trim()}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M13.5 51V18.2c0-2 2.5-2.9 3.7-1.3L32 36.6l14.8-19.7c1.2-1.6 3.7-.7 3.7 1.3V51"
        fill="none"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        className="brand-monogram-leaf"
        d="M32 31.2c-6.4-3.7-7.6-11.4-.1-19.7 7.6 8.3 6.4 16 .1 19.7Z"
      />
      <path
        className="brand-monogram-rib"
        d="M32 29.2V15.4"
        fill="none"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function BrandWordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`brand-wordmark ${className}`.trim()} dir="ltr">
      <span className="brand-name">{STORE_NAME}</span>
      <span className="brand-subtitle">{STORE_SUBTITLE}</span>
    </span>
  );
}

/** Monogram and wordmark side by side; the wordmark stays real text for search and screen readers. */
export function BrandLockup({ className = "" }: { className?: string }) {
  return (
    <span className={`brand-lockup ${className}`.trim()} dir="ltr">
      <BrandMonogram />
      <BrandWordmark />
    </span>
  );
}

export function BrandLogo() {
  const { m } = useI18n();
  return (
    <Link className="brand" href="/" aria-label={m.store.homeAriaLabel}>
      <BrandLockup />
    </Link>
  );
}
