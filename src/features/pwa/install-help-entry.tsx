"use client";

import { Smartphone } from "lucide-react";
import { useState } from "react";

import { useI18n } from "@/i18n/i18n-provider";

import { InstallInstructions } from "./install-instructions";
import { useInstallPrompt } from "./use-install-prompt";

export function InstallHelpEntry() {
  const t = useI18n().m.pwa;
  const { status, promptInstall } = useInstallPrompt("storefront");
  const [showSteps, setShowSteps] = useState(false);

  if (status === "installed") {
    return <p className="install-help-installed">{t.installed}</p>;
  }

  async function open() {
    if (status === "available") {
      const outcome = await promptInstall();
      if (outcome !== "unavailable") return;
    }
    setShowSteps(true);
  }

  return (
    <>
      <button type="button" className="install-help-entry" onClick={open}>
        <Smartphone size={18} aria-hidden="true" />
        {t.installOnPhone}
      </button>
      <InstallInstructions
        scope="storefront"
        open={showSteps}
        onClose={() => setShowSteps(false)}
      />
    </>
  );
}
