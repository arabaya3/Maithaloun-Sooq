"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { LOGO_SIZES } from "@/features/storefront/brand-logo-asset";

import { InstallInstructions } from "./install-instructions";
import { useInstallPrompt } from "./use-install-prompt";

export function StorefrontInstallBanner() {
  const pathname = usePathname();
  const { status, dismissed, promptInstall, dismiss } =
    useInstallPrompt("storefront");
  const [showSteps, setShowSteps] = useState(false);

  // Shopping and checkout stay unobstructed: the banner lives on the home page only.
  const visible =
    pathname === "/" &&
    !dismissed &&
    (status === "available" || status === "ios");

  async function install() {
    if (status === "ios") {
      setShowSteps(true);
      return;
    }
    const outcome = await promptInstall();
    if (outcome !== "accepted") dismiss();
  }

  return (
    <>
      {visible ? (
        <aside className="install-banner" aria-labelledby="install-title">
          <Image
            className="install-banner-logo"
            src="/brand/maithaloun-symbol.png"
            alt=""
            width={360}
            height={285}
            sizes={LOGO_SIZES}
          />
          <div className="install-banner-copy">
            <p id="install-title" className="install-banner-title">
              ثبّت سوق ميثلون
            </p>
            <p className="install-banner-text">
              أضف المتجر إلى الشاشة الرئيسية للوصول إليه بسرعة. التثبيت اختياري.
            </p>
            <div className="install-banner-actions">
              <button
                type="button"
                className="install-banner-action"
                onClick={install}
              >
                تثبيت التطبيق
              </button>
              <button
                type="button"
                className="install-banner-later"
                onClick={dismiss}
              >
                لاحقاً
              </button>
            </div>
          </div>
        </aside>
      ) : null}
      <InstallInstructions
        scope="storefront"
        open={showSteps}
        onClose={() => setShowSteps(false)}
      />
    </>
  );
}
