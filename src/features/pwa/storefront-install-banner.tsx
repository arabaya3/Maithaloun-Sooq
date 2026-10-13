"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { splitLocalePath } from "@/i18n/config";
import { useI18n } from "@/i18n/i18n-provider";

import { appIcons } from "./app-icons";
import { InstallInstructions } from "./install-instructions";
import { useInstallPrompt } from "./use-install-prompt";

export function StorefrontInstallBanner() {
  const pathname = usePathname();
  const t = useI18n().m.pwa;
  const { status, dismissed, promptInstall, dismiss } =
    useInstallPrompt("storefront");
  const [showSteps, setShowSteps] = useState(false);

  // Shopping and checkout stay unobstructed: the banner lives on the home page only.
  const visible =
    splitLocalePath(pathname).path === "/" &&
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
            src={appIcons.icon192}
            alt=""
            width={192}
            height={192}
            sizes="56px"
          />
          <div className="install-banner-copy">
            <p id="install-title" className="install-banner-title">
              {t.bannerTitle}
            </p>
            <p className="install-banner-text">{t.bannerText}</p>
            <div className="install-banner-actions">
              <button
                type="button"
                className="install-banner-action"
                onClick={install}
              >
                {t.install}
              </button>
              <button
                type="button"
                className="install-banner-later"
                onClick={dismiss}
              >
                {t.later}
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
