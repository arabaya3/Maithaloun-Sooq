import Image from "next/image";

import { brandLogo } from "@/features/storefront/brand-logos";

/** The brand's verified logo, or its name set as a wordmark. */
export function BrandMark({
  name,
  decorative = false,
}: {
  name: string;
  decorative?: boolean;
}) {
  const logo = brandLogo(name);
  if (!logo) {
    return (
      <bdi dir="auto" className="brand-mark-text">
        {name}
      </bdi>
    );
  }
  return (
    <Image
      className="brand-mark-logo"
      src={logo.src}
      alt={decorative ? "" : name}
      width={logo.width}
      height={logo.height}
      unoptimized
    />
  );
}
