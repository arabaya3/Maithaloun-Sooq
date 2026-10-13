"use client";

import { useI18n } from "@/i18n/i18n-provider";
import { Link } from "@/i18n/link";

export const STORE_NAME = "MAYTHA";
export const STORE_SUBTITLE = "HOME & CARE";

export function BrandWordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`brand-wordmark ${className}`.trim()} dir="ltr">
      <span className="brand-name">{STORE_NAME}</span>
      <span className="brand-subtitle">{STORE_SUBTITLE}</span>
    </span>
  );
}

export function BrandLogo() {
  const { m } = useI18n();
  return (
    <Link className="brand" href="/" aria-label={m.store.homeAriaLabel}>
      <BrandWordmark />
    </Link>
  );
}
