"use client";

import { Smartphone } from "lucide-react";
import { useState } from "react";

import { InstallInstructions } from "./install-instructions";
import { useInstallPrompt } from "./use-install-prompt";

export function InstallHelpEntry() {
  const { status, promptInstall } = useInstallPrompt("storefront");
  const [showSteps, setShowSteps] = useState(false);

  if (status === "installed") {
    return (
      <p className="install-help-installed">التطبيق مثبّت على هذا الجهاز.</p>
    );
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
        تثبيت التطبيق على الهاتف
      </button>
      <InstallInstructions
        scope="storefront"
        open={showSteps}
        onClose={() => setShowSteps(false)}
      />
    </>
  );
}
