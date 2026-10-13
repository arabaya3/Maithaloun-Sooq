"use client";

import { useEffect, useState } from "react";

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
      <h2 id="whatsapp-title">أرسل الطلب على واتساب لتأكيده</h2>
      <p>
        حُفظ طلبك. إذا لم يفتح واتساب تلقائياً، استخدم أحد الأزرار التالية. يؤكد
        المتجر الطلب بعد وصول رسالتك.
      </p>
      <div className="whatsapp-handoff-actions">
        <a href={appHref}>فتح واتساب</a>
        <a href={webHref}>واتساب ويب</a>
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
