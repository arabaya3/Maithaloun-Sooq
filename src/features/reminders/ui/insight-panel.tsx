"use client";

import { Sparkles } from "lucide-react";
import { useState, useTransition } from "react";

import { generateInsightAction } from "@/features/reminders/application/reminder-actions";
import type { ReportPeriod } from "@/features/reports/domain/report-calculation";
import type { BusinessInsight } from "@/server/ai/insight-generator";

export function InsightView({ insight }: { insight: BusinessInsight }) {
  return (
    <div className="admin-insight">
      <p className="admin-insight-label">
        <Sparkles size={16} aria-hidden="true" />
        ملخص آلي — اقتراحات فقط، والأرقام المعتمدة هي أرقام التقرير
      </p>
      <h3>ماذا حدث</h3>
      <p>{insight.whatHappened}</p>
      <h3>لماذا يهم</h3>
      <p>{insight.whyItMatters}</p>
      {insight.needsAttention.length ? (
        <>
          <h3>يحتاج انتباهاً</h3>
          <ul>
            {insight.needsAttention.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </>
      ) : null}
      {insight.suggestions.length ? (
        <>
          <h3>اقتراحات</h3>
          <ul>
            {insight.suggestions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

export function InsightPanel({ period }: { period: ReportPeriod }) {
  const [insight, setInsight] = useState<BusinessInsight | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <section className="admin-panel" aria-labelledby="insight-title">
      <h2 id="insight-title">ملخص ذكي</h2>
      {insight ? (
        <InsightView insight={insight} />
      ) : (
        <>
          <p className="admin-muted">
            شرح مبسّط للأرقام أعلاه مع اقتراحات. لا يغيّر أي رقم ولا يحفظ شيئاً.
          </p>
          <button
            type="button"
            className="admin-btn admin-btn-secondary"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setMessage(null);
                const response = await generateInsightAction(period);
                if (response.ok) setInsight(response.insight);
                else setMessage(response.message);
              })
            }
          >
            <Sparkles size={18} aria-hidden="true" />
            {pending ? "جارٍ إعداد الملخص…" : "اشرحي لي هذه الفترة"}
          </button>
          {message ? (
            <p className="admin-form-warning" role="status">
              {message}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
