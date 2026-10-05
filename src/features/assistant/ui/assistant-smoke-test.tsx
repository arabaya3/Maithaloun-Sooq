"use client";

import { useState } from "react";

import type { SmokeAnswer } from "@/features/assistant/application/smoke-test-service";

type State =
  | { phase: "idle" }
  | { phase: "running" }
  | { phase: "done"; answers: SmokeAnswer[]; totalMs: number }
  | { phase: "error"; message: string };

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} ث`;

export function AssistantSmokeTest({ questions }: { questions: string[] }) {
  const [state, setState] = useState<State>({ phase: "idle" });

  async function run() {
    setState({ phase: "running" });
    const started = performance.now();
    try {
      const response = await fetch("/admin/api/assistant/smoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = (await response.json()) as {
        ok: boolean;
        message?: string;
        answers?: SmokeAnswer[];
      };
      if (!response.ok || !body.ok || !body.answers) {
        setState({
          phase: "error",
          message: body.message ?? "تعذّر تشغيل الفحص.",
        });
        return;
      }
      setState({
        phase: "done",
        answers: body.answers,
        totalMs: performance.now() - started,
      });
    } catch {
      setState({ phase: "error", message: "تعذّر الاتصال بالخادم." });
    }
  }

  return (
    <section className="admin-panel" aria-labelledby="smoke-title">
      <h2 id="smoke-title">الأسئلة</h2>
      <ol className="admin-smoke-questions">
        {questions.map((question) => (
          <li key={question}>{question}</li>
        ))}
      </ol>
      <button
        type="button"
        className="admin-btn"
        onClick={run}
        disabled={state.phase === "running"}
      >
        {state.phase === "running" ? "جارٍ الفحص…" : "تشغيل الفحص"}
      </button>
      {state.phase === "error" ? (
        <p className="admin-media-message" data-tone="error" role="alert">
          {state.message}
        </p>
      ) : null}
      {state.phase === "done" ? (
        <div role="status" className="admin-smoke-results">
          <p>
            نجح {state.answers.filter((row) => row.ok).length} من{" "}
            {state.answers.length} · المدة الكلية {seconds(state.totalMs)}
          </p>
          <ul className="admin-smoke-list">
            {state.answers.map((row) => (
              <li
                key={row.id}
                className="admin-smoke-item"
                data-ok={row.ok}
                aria-label={row.question}
              >
                <p className="admin-smoke-question">
                  <span>{row.ok ? "✓" : "✗"}</span> {row.question}
                </p>
                <p className="admin-smoke-answer">{row.answer}</p>
                <p className="admin-muted">
                  الأدوات: {row.tools.length ? row.tools.join("، ") : "—"} ·{" "}
                  {seconds(row.durationMs)}
                  {row.firstResponseMs !== null
                    ? ` · أول رد ${seconds(row.firstResponseMs)}`
                    : ""}{" "}
                  · رموز: {row.inputTokens} دخل / {row.outputTokens} خرج /{" "}
                  {row.cachedTokens} مخزّن
                  {row.reference ? ` · المرجع ${row.reference}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
