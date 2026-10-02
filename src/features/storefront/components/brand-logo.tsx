import Image from "next/image";
import Link from "next/link";

import { LOGO_SIZES } from "@/features/storefront/brand-logo-asset";

export function BrandLogo() {
  return (
    <Link className="brand" href="/">
      <Image
        className="brand-mark"
        src="/brand/maithaloun-symbol.png"
        alt=""
        width={360}
        height={285}
        sizes={LOGO_SIZES}
        loading="eager"
      />
      <span className="brand-text">
        <span className="brand-word">
          <span className="brand-word-soq">سوق</span>{" "}
          <span className="brand-word-name">ميثلون</span>
          <span className="sr-only">، الرئيسية</span>
        </span>
        <span className="brand-tagline" aria-hidden="true">
          منظفات ومعطرات جو
        </span>
      </span>
    </Link>
  );
}
