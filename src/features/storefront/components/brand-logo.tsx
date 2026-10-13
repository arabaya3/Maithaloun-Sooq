import Link from "next/link";

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
  return (
    <Link className="brand" href="/" aria-label={`${STORE_NAME}، الرئيسية`}>
      <BrandWordmark />
    </Link>
  );
}
