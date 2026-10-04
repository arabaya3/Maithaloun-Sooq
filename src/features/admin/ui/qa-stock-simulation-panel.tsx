"use client";

import { useState, useTransition } from "react";

import {
  createQaProbeAction,
  runQaStockSimulationAction,
  type QaSimulationActionResult,
} from "@/features/admin/application/qa-stock-simulation-actions";

const units = (milli: number) => String(milli / 1000);

export function QaStockSimulationPanel({
  probes,
}: {
  probes: Array<{ variantId: string; label: string }>;
}) {
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<QaSimulationActionResult | null>(null);
  const [chosen, setVariant] = useState<string | null>(null);
  // The probe list can arrive after the first render (it is created from this panel).
  const variant =
    probes.find((probe) => probe.variantId === chosen)?.variantId ??
    probes[0]?.variantId ??
    "";

  if (!probes.length) {
    return (
      <form
        action={() =>
          startTransition(async () => {
            const result = await createQaProbeAction();
            if (!result.ok) setOutcome(result);
          })
        }
      >
        <p className="admin-muted">
          لا يوجد صنف فحص QA بعد. يُنشأ منتج مخفي لا يراه الزبائن ولا يقبله
          الدفع العام.
        </p>
        <button type="submit" className="admin-btn" disabled={pending}>
          إنشاء صنف فحص QA
        </button>
        {outcome && !outcome.ok ? (
          <p className="admin-form-error" role="alert">
            {outcome.message}
          </p>
        ) : null}
      </form>
    );
  }

  const result = outcome?.ok ? outcome.result : null;
  const checks = result?.checkpoints
    ? [
        [
          "المخزون المتوفر قبل المحاكاة",
          units(result.checkpoints.initialAvailableMilli),
        ],
        [
          "رصيد مؤقت أُضيف داخل المحاكاة",
          units(result.checkpoints.seededMilli),
        ],
        [
          "المتوفر بعد تأكيد الطلب",
          units(result.checkpoints.availableAfterOrderMilli),
        ],
        [
          "المتوفر بعد الإلغاء",
          units(result.checkpoints.availableAfterCancelMilli),
        ],
        [
          "الكمية في المحل بعد التسليم",
          units(result.checkpoints.onHandAfterDeliveryMilli),
        ],
        ["الصنف المطلوب نفسه", result.checkpoints.exactVariant ? "نعم" : "لا"],
        ["سعر الصنف صحيح", result.checkpoints.exactPrice ? "نعم" : "لا"],
        [
          "تكرار الطلب أعاد الطلب نفسه",
          result.checkpoints.duplicateOrderReplayed ? "نعم" : "لا",
        ],
        [
          "رُفض الإلغاء المكرر",
          result.checkpoints.repeatedCancelRejected ? "نعم" : "لا",
        ],
      ]
    : [];

  return (
    <form
      className="admin-form"
      aria-label="محاكاة مسار المخزون"
      action={() =>
        startTransition(async () => {
          setOutcome(null);
          setOutcome(await runQaStockSimulationAction(variant));
        })
      }
    >
      <label>
        <span>صنف الفحص</span>
        <select
          value={variant}
          onChange={(event) => setVariant(event.target.value)}
        >
          {probes.map((probe) => (
            <option key={probe.variantId} value={probe.variantId}>
              {probe.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        className="admin-btn admin-btn-primary"
        disabled={pending}
      >
        {pending ? "جارٍ تشغيل المحاكاة…" : "تشغيل محاكاة المخزون"}
      </button>
      {outcome && !outcome.ok ? (
        <p className="admin-form-error" role="alert">
          {outcome.message}
        </p>
      ) : null}
      {result ? (
        <section role="status" aria-label="نتيجة المحاكاة">
          <p>
            <strong>{result.passed ? "نجحت المحاكاة" : "فشلت المحاكاة"}</strong>
            {result.failedStep ? ` عند الخطوة: ${result.failedStep}` : ""} ·
            التراجع الكامل:{" "}
            {result.rollbackVerified ? "تم التحقق" : "لم يُتحقق"} ·{" "}
            {result.durationMs} مللي ثانية · المرجع{" "}
            <bdi dir="ltr">{result.supportReference}</bdi>
          </p>
          {checks.length ? (
            <dl className="admin-detail-list">
              {checks.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </section>
      ) : null}
    </form>
  );
}
