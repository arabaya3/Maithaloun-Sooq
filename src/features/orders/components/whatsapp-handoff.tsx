"use client";

import { useState } from "react";

export function WhatsAppHandoff({
  message,
  appHref,
  webHref,
}: {
  message: string;
  appHref: string;
  webHref: string;
}) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");

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
      <h2 id="whatsapp-title">أرسل الطلب على واتساب لتأكيده</h2>
      <p>
        حُفظ طلبك. يؤكده المتجر بعد وصول رسالتك على واتساب، ولا يُحجز شيء قبل
        التأكيد.
      </p>
      <div className="whatsapp-handoff-actions">
        <a href={appHref} target="_blank" rel="noopener noreferrer">
          فتح واتساب
        </a>
        <a href={webHref} target="_blank" rel="noopener noreferrer">
          واتساب ويب
        </a>
        <button type="button" onClick={copy}>
          نسخ الرسالة
        </button>
      </div>
      <p className="whatsapp-handoff-status" role="status">
        {copied === "done"
          ? "نُسخت الرسالة. الصقها في محادثة المتجر."
          : copied === "failed"
            ? "تعذّر النسخ تلقائياً. انسخ النص أدناه يدوياً."
            : ""}
      </p>
      <label htmlFor="whatsapp-message">نص الرسالة</label>
      <textarea id="whatsapp-message" readOnly value={message} rows={6} />
    </section>
  );
}
