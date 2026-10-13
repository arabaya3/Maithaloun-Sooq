"use client";

import { AlertTriangle } from "lucide-react";

import { useI18n } from "@/i18n/i18n-provider";

export default function ErrorPage({ reset }: { reset: () => void }) {
  const { misc } = useI18n().m;
  return (
    <main className="placeholder-page page-shell">
      <div className="placeholder-panel" role="alert">
        <AlertTriangle className="status-icon" aria-hidden="true" />
        <h1>{misc.errorHeading}</h1>
        <p>{misc.errorText}</p>
        <button type="button" className="retry-button" onClick={reset}>
          {misc.retry}
        </button>
      </div>
    </main>
  );
}
