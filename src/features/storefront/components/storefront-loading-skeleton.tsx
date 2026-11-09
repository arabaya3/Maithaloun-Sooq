"use client";

import Image from "next/image";

import { useI18n } from "@/i18n/i18n-provider";

import { MobileNavigation } from "./mobile-navigation";
import { SiteHeader } from "./site-header";

export function StorefrontLoadingSkeleton() {
  const { misc } = useI18n().m;
  return (
    <>
      <SiteHeader />
      <main
        className="page-shell storefront-main storefront-skeleton"
        aria-busy="true"
      >
        <p className="sr-only" role="status">
          {misc.loadingProducts}
        </p>
        <div className="grid min-h-[42vh] place-items-center" aria-hidden="true">
          <div className="relative motion-safe:animate-pulse">
            <Image
              src="/brand/logo/meetho-header.svg"
              alt=""
              width={160}
              height={117}
              unoptimized
              className="rounded-xl"
            />
            <span className="absolute -end-4 -top-2 text-xl text-[#40865a]">
              ✦
            </span>
          </div>
        </div>
      </main>
      <MobileNavigation />
    </>
  );
}
