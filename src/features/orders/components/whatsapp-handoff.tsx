"use client";

import { useEffect, useState } from "react";

import { useI18n } from "@/i18n/i18n-provider";

export function WhatsAppHandoff({
  message,
  appHref,
  webHref,
  autoOpen = false,
}: {
  message: string;
  appHref: string;
  webHref: string;
  autoOpen?: boolean;
}) {
  const m = useI18n().m.orders;
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");

  useEffect(() => {
    if (!autoOpen) return;
    // Drop the flag first so coming back to this page shows the links instead of reopening WhatsApp.
    window.history.replaceState(null, "", window.location.pathname);
    window.location.assign(appHref);
  }, [autoOpen, appHref]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied("done");
    } catch {
      setCopied("failed");
    }
  }

  return (
    <section className="whatsapp-handoff" aria-labelledby="whatsapp-title">
      <h2 id="whatsapp-title">{m.handoffTitle}</h2>
      <p>{m.handoffText}</p>
      <div className="whatsapp-handoff-actions">
        <a href={appHref}>{m.openWhatsApp}</a>
        <a href={webHref}>{m.whatsAppWeb}</a>
        <button type="button" onClick={copy}>
          {m.copyMessage}
        </button>
      </div>
      <p className="whatsapp-handoff-status" role="status">
        {copied === "done" ? m.copied : copied === "failed" ? m.copyFailed : ""}
      </p>
      <label htmlFor="whatsapp-message">{m.messageText}</label>
      {/* The message goes to the store, so it stays Arabic. */}
      <textarea
        id="whatsapp-message"
        readOnly
        value={message}
        rows={6}
        dir="rtl"
        lang="ar"
      />
    </section>
  );
}
