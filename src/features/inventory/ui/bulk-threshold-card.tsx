"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { setActiveThresholdsAction } from "../application/inventory-actions";

export function BulkThresholdCard({
  eligible,
  changing,
}: {
  eligible: number;
  changing: number;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  if (!eligible) return null;
  return (
    <section className="admin-panel" aria-labelledby="bulk-threshold-title">
      <h2 id="bulk-threshold-title">حد التنبيه لكل الأصناف</h2>
      <p className="admin-muted">
        {changing
          ? `${changing} من ${eligible} صنف متتبَّع حدّه ليس 2 قطع.`
          : `كل الأصناف المتتبَّعة (${eligible}) تنبّه عند 2 قطع.`}
      </p>
      {confirming ? (
        <div className="admin-note" role="alert">
          <p>
            ضبط حد التنبيه على 2 قطع لـ{changing} صنف؟ لا تتغير الكميات ولا
            التكاليف، ويبقى بإمكانك تغيير حد أي صنف وحده.
          </p>
          <button
            type="button"
            className="admin-button-primary"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await setActiveThresholdsAction(2);
                setMessage({ ok: result.ok, text: result.message });
                setConfirming(false);
                if (result.ok) router.refresh();
              })
            }
          >
            {pending ? "جارٍ الحفظ…" : "تأكيد"}
          </button>{" "}
          <button
            type="button"
            className="admin-button-secondary"
            disabled={pending}
            onClick={() => setConfirming(false)}
          >
            إلغاء
          </button>
        </div>
      ) : changing ? (
        <button
          type="button"
          className="admin-button-secondary"
          onClick={() => {
            setMessage(null);
            setConfirming(true);
          }}
        >
          اجعل حد التنبيه 2 لكل الأصناف
        </button>
      ) : null}
      {message ? (
        <p
          className="admin-media-message"
          data-tone={message.ok ? "ok" : "error"}
          role={message.ok ? "status" : "alert"}
        >
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
