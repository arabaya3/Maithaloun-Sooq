"use client";

import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  LoaderCircle,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { ConfirmationView } from "../application/confirmation-service";

// Any card that runs may change the records other open cards were prepared against.
const SETTLED_EVENT = "assistant:confirmation-settled";

type Phase =
  | { name: "loading" }
  | { name: "ready"; view: ConfirmationView }
  | { name: "executing"; view: ConfirmationView }
  | {
      name: "done";
      view: ConfirmationView;
      message: string;
      href: string | null;
    }
  | {
      name: "failed";
      view: ConfirmationView | null;
      message: string;
      href: string | null;
    };

export function ConfirmationCard({
  confirmationId,
  onSettled,
}: {
  confirmationId: string;
  onSettled?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ name: "loading" });
  const [acknowledged, setAcknowledged] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(
        `/admin/api/assistant/confirmations/${confirmationId}`,
        { cache: "no-store" },
      );
      const body = (await response.json()) as {
        ok: boolean;
        confirmation?: ConfirmationView;
        message?: string;
      };
      if (!body.ok || !body.confirmation) {
        setPhase({
          name: "failed",
          view: null,
          message: body.message ?? "تعذّر تحميل البطاقة.",
          href: null,
        });
        return;
      }
      const view = body.confirmation;
      if (view.status === "completed" && view.result) {
        setPhase({
          name: "done",
          view,
          message: view.result.message,
          href: view.result.href,
        });
      } else if (view.status === "pending") {
        setPhase({ name: "ready", view });
      } else {
        setPhase({
          name: "failed",
          view,
          message:
            view.status === "expired"
              ? "انتهت مدة هذه البطاقة. اطلبي العملية من جديد."
              : view.status === "cancelled" && view.reason === "stale"
                ? "تغيّرت البيانات بعد تجهيز هذه البطاقة (غالباً بتنفيذ بطاقة أخرى)، فلم تعد صالحة. اطلبي العملية من جديد لتجهيز بطاقة محدّثة."
                : view.status === "cancelled"
                  ? "أُلغيت هذه العملية."
                  : view.status === "executing"
                    ? "نتيجة هذه العملية غير مؤكدة. تحققي من السجل."
                    : "لم تتم هذه العملية.",
          href: view.card.target.href,
        });
      }
    } catch {
      setPhase({
        name: "failed",
        view: null,
        message: "تعذّر تحميل البطاقة. تحققي من الاتصال.",
        href: null,
      });
    }
  }, [confirmationId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // Re-read the server state when another card runs or the tab comes back, so status never lingers.
  const waiting = phase.name === "ready";
  useEffect(() => {
    if (!waiting) return;
    // The acting card has already left "ready"; copies of the same card elsewhere refresh too.
    const refresh = () => void load();
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener(SETTLED_EVENT, refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(SETTLED_EVENT, refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [waiting, load]);

  async function act(action: "confirm" | "cancel") {
    if (phase.name !== "ready" || !phase.view.token) return;
    const { view } = phase;
    setPhase({ name: "executing", view });
    try {
      const response = await fetch(
        `/admin/api/assistant/confirmations/${confirmationId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            operation: view.operation,
            token: view.token,
            ...(view.riskLevel >= 4 ? { acknowledged } : {}),
          }),
        },
      );
      const body = (await response.json()) as {
        ok: boolean;
        message?: string;
        href?: string | null;
        status?: string;
      };
      if (action === "cancel") {
        setPhase({
          name: "failed",
          view,
          message: "أُلغيت العملية ولم يتغيّر شيء.",
          href: null,
        });
      } else if (body.ok) {
        setPhase({
          name: "done",
          view,
          message: body.message ?? "تمت العملية.",
          href: body.href ?? null,
        });
      } else {
        setPhase({
          name: "failed",
          view,
          message: body.message ?? "لم تتم العملية.",
          href: body.href ?? view.card.target.href,
        });
      }
    } catch {
      // The outcome is unknown, so the card is reloaded from the server instead of retried.
      setPhase({
        name: "failed",
        view,
        message:
          "انقطع الاتصال أثناء التنفيذ. النتيجة غير مؤكدة؛ تحققي من السجل قبل المحاولة مرة أخرى.",
        href: view.card.target.href,
      });
    }
    window.dispatchEvent(
      new CustomEvent(SETTLED_EVENT, { detail: confirmationId }),
    );
    onSettled?.();
  }

  if (phase.name === "loading") {
    return (
      <div className="assistant-card" aria-busy="true">
        <LoaderCircle className="admin-spin" size={18} aria-hidden="true" />{" "}
        جارٍ تجهيز البطاقة…
      </div>
    );
  }
  const view = "view" in phase ? phase.view : null;
  const card = view?.card;
  const permanent = Boolean(view && view.riskLevel >= 4);
  const expiresAt = view
    ? new Date(view.expiresAt).toLocaleTimeString("ar", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <section
      className="assistant-card"
      data-destructive={card?.destructive || undefined}
      data-permanent={permanent || undefined}
      aria-label={card ? `${card.title}: ${card.target.label}` : "بطاقة تأكيد"}
    >
      {card ? (
        <>
          <header className="assistant-card-head">
            <span className="assistant-card-badge" data-phase={phase.name}>
              {phase.name === "done"
                ? "تمت"
                : phase.name === "failed"
                  ? "لم تتم"
                  : phase.name === "executing"
                    ? "جارٍ التنفيذ"
                    : "بانتظار تأكيدك"}
            </span>
            {permanent ? (
              <p className="assistant-card-permanent" role="note">
                <AlertTriangle size={16} aria-hidden="true" /> حذف نهائي — لا
                يمكن التراجع
              </p>
            ) : null}
            <h3>{card.title}</h3>
            {card.target.href ? (
              <Link href={card.target.href} prefetch={false}>
                {card.target.label}
              </Link>
            ) : (
              <p>{card.target.label}</p>
            )}
          </header>
          {card.images ? (
            <div className="assistant-card-images">
              <figure>
                {card.images.before ? (
                  // eslint-disable-next-line @next/next/no-img-element -- remote or private preview at its stored size
                  <img src={card.images.before} alt="الصورة الحالية" />
                ) : (
                  <span className="assistant-card-noimage">بدون صورة</span>
                )}
                <figcaption>الحالية</figcaption>
              </figure>
              <figure>
                {/* eslint-disable-next-line @next/next/no-img-element -- private attachment preview */}
                <img src={card.images.after} alt="الصورة الجديدة" />
                <figcaption>الجديدة</figcaption>
              </figure>
            </div>
          ) : null}
          {card.rows.length ? (
            <dl className="assistant-card-rows">
              {card.rows.map((row, index) => (
                <div key={`${index}-${row.label}`}>
                  <dt>{row.label}</dt>
                  <dd>
                    {row.before !== null ? (
                      <>
                        <del>{row.before}</del>
                        <span aria-hidden="true"> ← </span>
                        <span className="sr-only">يصبح</span>
                      </>
                    ) : null}
                    <ins>{row.after}</ins>
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
          {card.impact.length ? (
            <ul className="assistant-card-notes">
              {card.impact.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
          {card.dependencies?.length ? (
            <div className="assistant-card-dependencies">
              <p>السجلات المرتبطة التي تم فحصها:</p>
              <ul>
                {card.dependencies.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {card.warnings.length ? (
            <ul className="assistant-card-warnings">
              {card.warnings.map((item) => (
                <li key={item}>
                  <AlertTriangle size={16} aria-hidden="true" /> {item}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}

      {card && (phase.name === "ready" || phase.name === "executing") ? (
        <p className="assistant-card-meta">
          {card.reversible === false
            ? "لا يمكن التراجع عن هذه العملية."
            : card.reversible
              ? "يمكن التراجع عن هذه العملية لاحقاً."
              : null}{" "}
          {expiresAt ? `تنتهي صلاحية البطاقة الساعة ${expiresAt}.` : null}
        </p>
      ) : null}
      {permanent && phase.name === "ready" ? (
        <label className="assistant-card-acknowledge">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          فهمت أن «{card?.target.label}» سيُحذف نهائياً ولا يمكن استرجاعه.
        </label>
      ) : null}
      {phase.name === "ready" || phase.name === "executing" ? (
        <div className="assistant-card-actions">
          <button
            type="button"
            className={
              card?.destructive
                ? "admin-btn admin-btn-danger"
                : "admin-btn admin-btn-primary"
            }
            disabled={
              phase.name === "executing" || (permanent && !acknowledged)
            }
            onClick={() => void act("confirm")}
          >
            {phase.name === "executing" ? (
              <LoaderCircle
                className="admin-spin"
                size={18}
                aria-hidden="true"
              />
            ) : null}
            {phase.name === "executing"
              ? "جارٍ التنفيذ…"
              : (card?.confirmLabel ?? "تأكيد")}
          </button>
          <button
            type="button"
            className="admin-btn admin-btn-secondary"
            disabled={phase.name === "executing"}
            onClick={() => void act("cancel")}
          >
            إلغاء
          </button>
        </div>
      ) : null}

      {phase.name === "done" ? (
        <p className="assistant-card-result" role="status">
          <CheckCircle2 size={18} aria-hidden="true" /> {phase.message}
          {phase.href ? (
            <Link href={phase.href} prefetch={false}>
              فتح السجل
            </Link>
          ) : null}
        </p>
      ) : null}
      {phase.name === "failed" ? (
        <p className="assistant-card-error" role="alert">
          <XCircle size={18} aria-hidden="true" /> {phase.message}
          {phase.href ? (
            <Link href={phase.href} prefetch={false}>
              فتح السجل
            </Link>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}
