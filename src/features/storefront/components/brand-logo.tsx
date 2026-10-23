"use client";

import Image from "next/image";

import { useI18n } from "@/i18n/i18n-provider";
import { Link } from "@/i18n/link";

export const STORE_NAME = "MAYTHA MARKET";
// The lockup keeps the short wordmark; "MARKET" sits on the small line under it so the
// header still fits beside the cart at 320px. Titles and metadata use the full STORE_NAME.
export const BRAND_WORDMARK = "MAYTHA";
export const STORE_SUBTITLE = "MARKET";

// Generated from the approved original logo by tools/brand/render-brand-assets.mjs.
export const BRAND_SYMBOL_SRC = "/brand/logo/maytha-mark-v5.png";
export const BRAND_LOGO_SRC = "/brand/logo/maytha-logo-512-v5.png";

/** The roof-and-cart mark from the official logo, its light background keyed out, for light surfaces. */
export function BrandSymbol({ className = "" }: { className?: string }) {
  return (
    <Image
      className={`brand-symbol ${className}`.trim()}
      src={BRAND_SYMBOL_SRC}
      width={356}
      height={216}
      alt=""
      aria-hidden="true"
      unoptimized
      priority
    />
  );
}

/** The full official logo tile: the mark and the MAYTHA MARKET wordmark on the logo's own light square. */
export function BrandLogoTile({
  className = "",
  decorative = false,
}: {
  className?: string;
  decorative?: boolean;
}) {
  return (
    <Image
      className={`brand-logo-tile ${className}`.trim()}
      src={BRAND_LOGO_SRC}
      width={512}
      height={512}
      alt={decorative ? "" : STORE_NAME}
      aria-hidden={decorative ? "true" : undefined}
      unoptimized
    />
  );
}

export function BrandWordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`brand-wordmark ${className}`.trim()} dir="ltr">
      <span className="brand-name">{BRAND_WORDMARK}</span>
      <span className="brand-subtitle">{STORE_SUBTITLE}</span>
    </span>
  );
}

/** Logo mark and wordmark side by side; the wordmark stays real text for search and screen readers. */
export function BrandLockup({ className = "" }: { className?: string }) {
  return (
    <span className={`brand-lockup ${className}`.trim()} dir="ltr">
      <BrandSymbol />
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
