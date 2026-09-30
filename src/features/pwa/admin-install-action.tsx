"use client";

import { Smartphone } from "lucide-react";
import { useState } from "react";

import { InstallInstructions } from "./install-instructions";
import { useInstallPrompt } from "./use-install-prompt";

export function AdminInstallAction() {
  const { status, promptInstall } = useInstallPrompt("admin");
  const [showSteps, setShowSteps] = useState(false);

  if (status === "installed") return null;

  async function install() {
    if (status === "available") {
      const outcome = await promptInstall();
      if (outcome !== "unavailable") return;
    }
    setShowSteps(true);
  }

  return (
    <>
      <button type="button" className="admin-install-action" onClick={install}>
        <Smartphone size={20} aria-hidden="true" />
        <span>
          <strong>ثبّتي تطبيق الإدارة على الجهاز</strong>
          <small>يفتح مباشرة على الطلبات والمخزون</small>
        </span>
      </button>
      <InstallInstructions
        scope="admin"
        open={showSteps}
        onClose={() => setShowSteps(false)}
      />
    </>
  );
}
