"use client";

import { Download, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState } from "react";

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
        <aside className="install-banner" aria-label="تثبيت التطبيق">
          <button
            type="button"
            className="install-banner-action"
            onClick={install}
          >
            <Download size={18} aria-hidden="true" />
            <span>أضف سوق ميثلون إلى الشاشة الرئيسية</span>
          </button>
          <button
            type="button"
            className="install-banner-dismiss"
            aria-label="ليس الآن"
            onClick={dismiss}
          >
            <X size={18} aria-hidden="true" />
          </button>
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
