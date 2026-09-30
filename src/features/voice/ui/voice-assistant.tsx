"use client";

import Link from "next/link";
import {
  CheckCircle2,
  LoaderCircle,
  MessageCircleQuestion,
  Mic,
  Square,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Money, Quantity } from "@/features/admin/ui/kit";
import { postPurchaseAction } from "@/features/inventory/application/inventory-actions";
import {
  PurchaseForm,
  type PurchaseVariantOption,
} from "@/features/purchasing/ui/purchase-form";
import {
  SaleForm,
  type SaleVariantOption,
} from "@/features/sales/ui/sale-form";
import {
  answerVoiceClarificationAction,
  cancelVoiceCommandAction,
  confirmVoiceAdjustmentAction,
  confirmVoicePaymentAction,
  interpretVoiceAction,
  markVoiceConfirmedAction,
} from "@/features/voice/application/voice-actions";
import type { VoiceOutcome } from "@/features/voice/application/voice-service";
import type { VoiceTranscriptSource } from "@/features/voice/domain/voice-constants";

type Phase = "idle" | "listening" | "processing";

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult:
    | ((event: {
        results: ArrayLike<ArrayLike<{ transcript: string }>>;
      }) => void)
    | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

const MAX_RECORDING_MS = 30_000;

const examples = [
  "بعت لأحمد عبوتين جلي ودفع كامل",
  "كم ربحت هذا الأسبوع؟",
  "مين عليه ديون؟",
];

const statusText: Record<Phase, string> = {
  idle: "اضغطي الميكروفون وتكلّمي، أو اكتبي العملية.",
  listening: "أستمع الآن… اضغطي للإيقاف عند الانتهاء.",
  processing: "جارٍ فهم العملية…",
};

function recognitionConstructor(): (new () => RecognitionLike) | null {
  const scope = window as unknown as Record<string, unknown>;
  return (scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null) as
    (new () => RecognitionLike) | null;
}

export function VoiceAssistant({
  saleVariants,
  purchaseVariants,
  customers,
  suppliers,
}: {
  saleVariants: readonly SaleVariantOption[];
  purchaseVariants: readonly PurchaseVariantOption[];
  customers: readonly { id: string; name: string; balanceAgorot: number }[];
  suppliers: readonly { id: string; nameAr: string }[];
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [transcript, setTranscript] = useState("");
  const [outcome, setOutcome] = useState<VoiceOutcome | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [clarifyText, setClarifyText] = useState("");
  const [busy, setBusy] = useState(false);
  const recognitionRef = useRef<RecognitionLike | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const heardRef = useRef("");

  const releaseMicrophone = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    recorderRef.current = null;
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
  }, []);

  // The microphone never stays open in the background or after leaving the page.
  useEffect(() => {
    const onHidden = () => {
      if (document.hidden) {
        releaseMicrophone();
        setPhase((current) => (current === "listening" ? "idle" : current));
      }
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      releaseMicrophone();
    };
  }, [releaseMicrophone]);

  async function submit(text: string, source: VoiceTranscriptSource) {
    const value = text.trim();
    if (!value) {
      setPhase("idle");
      setNotice("لم ألتقط كلاماً. أعيدي المحاولة أو اكتبي العملية.");
      return;
    }
    setPhase("processing");
    setNotice(null);
    setOutcome(await interpretVoiceAction({ transcript: value, source }));
    setPhase("idle");
  }

  function startBrowserRecognition(Recognition: new () => RecognitionLike) {
    const recognition = new Recognition();
    recognition.lang = "ar";
    recognition.interimResults = true;
    recognition.continuous = false;
    heardRef.current = "";
    recognition.onresult = (event) => {
      heardRef.current = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? "")
        .join(" ");
      setTranscript(heardRef.current);
    };
    recognition.onerror = () => {
      recognitionRef.current = null;
      setPhase("idle");
      setNotice("تعذّر الاستماع. اكتبي العملية في الخانة.");
    };
    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return;
      recognitionRef.current = null;
      void submit(heardRef.current, "browser");
    };
    recognitionRef.current = recognition;
    recognition.start();
    setPhase("listening");
  }

  async function startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    recorder.onstop = async () => {
      for (const track of stream.getTracks()) track.stop();
      streamRef.current = null;
      setPhase("processing");
      try {
        const response = await fetch("/admin/api/voice/transcribe", {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: new Blob(chunks, { type: recorder.mimeType }),
        });
        const body = (await response.json()) as {
          ok: boolean;
          transcript?: string;
          message?: string;
        };
        if (!body.ok || !body.transcript) {
          throw new Error(body.message ?? "transcribe");
        }
        setTranscript(body.transcript);
        await submit(body.transcript, "server");
      } catch (error) {
        setPhase("idle");
        setNotice(
          error instanceof Error && error.message !== "transcribe"
            ? error.message
            : "تعذّر تحويل التسجيل إلى نص. اكتبي العملية.",
        );
      }
    };
    recorderRef.current = recorder;
    recorder.start();
    timerRef.current = window.setTimeout(stopListening, MAX_RECORDING_MS);
    setPhase("listening");
  }

  function stopListening() {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    recorderRef.current = null;
  }

  async function toggleMicrophone() {
    if (phase === "listening") {
      stopListening();
      return;
    }
    setNotice(null);
    setOutcome(null);
    setTranscript("");
    try {
      const Recognition = recognitionConstructor();
      if (Recognition) startBrowserRecognition(Recognition);
      else if (navigator.mediaDevices && "MediaRecorder" in window) {
        await startRecording();
      } else {
        setNotice("هذا المتصفح لا يدعم التسجيل. اكتبي العملية في الخانة.");
      }
    } catch {
      releaseMicrophone();
      setPhase("idle");
      setNotice("لم يُسمح باستخدام الميكروفون. اكتبي العملية في الخانة.");
    }
  }

  function reset() {
    if (outcome && "commandId" in outcome && outcome.kind !== "answer") {
      void cancelVoiceCommandAction(outcome.commandId);
    }
    setOutcome(null);
    setTranscript("");
    setClarifyText("");
    setNotice(null);
  }

  async function run(action: () => Promise<VoiceOutcome>) {
    setBusy(true);
    setOutcome(await action());
    setBusy(false);
  }

  const startOver = (
    <button
      type="button"
      className="admin-btn admin-btn-secondary"
      disabled={busy}
      onClick={reset}
    >
      عملية جديدة
    </button>
  );

  if (outcome?.kind === "sale") {
    const commandId = outcome.commandId;
    return (
      <div className="admin-stack">
        <p className="admin-voice-heard">
          سمعت: <bdi>{transcript}</bdi>
        </p>
        <SaleForm
          variants={saleVariants}
          customers={customers}
          initialDraft={outcome.draft}
          initialReview={{ preview: outcome.preview, payload: outcome.payload }}
          source="voice"
          onSaved={(result, edited) =>
            void markVoiceConfirmedAction({
              commandId,
              entityType: "customer_invoice",
              entityId: result.invoiceId,
              edited,
            })
          }
        />
        {startOver}
      </div>
    );
  }

  if (outcome?.kind === "purchase") {
    const commandId = outcome.commandId;
    return (
      <div className="admin-stack">
        <p className="admin-voice-heard">
          سمعت: <bdi>{transcript}</bdi> — أكملي سعر الشراء ثم راجعي وأكّدي.
        </p>
        <PurchaseForm
          variants={purchaseVariants}
          suppliers={suppliers}
          initialDraft={outcome.draft}
          source="voice"
          idempotencyKey={commandId}
          onPosted={async (payload) => {
            const response = await postPurchaseAction(payload);
            if (!response.ok) return { ok: false, message: response.message };
            await markVoiceConfirmedAction({
              commandId,
              entityType: "purchase_invoice",
              entityId: response.result.invoiceId,
              edited: true,
            });
            return { ok: true, result: response.result };
          }}
        />
        {startOver}
      </div>
    );
  }

  return (
    <div className="admin-stack">
      <section
        className="admin-panel admin-voice"
        aria-labelledby="voice-title"
      >
        <h2 id="voice-title" className="sr-only">
          الأمر الصوتي
        </h2>
        <button
          type="button"
          className="admin-voice-mic"
          data-listening={phase === "listening" || undefined}
          aria-pressed={phase === "listening"}
          aria-label={phase === "listening" ? "إيقاف الاستماع" : "بدء الاستماع"}
          disabled={phase === "processing" || busy}
          onClick={() => void toggleMicrophone()}
        >
          {phase === "processing" ? (
            <LoaderCircle className="admin-spin" size={36} aria-hidden="true" />
          ) : phase === "listening" ? (
            <Square size={32} aria-hidden="true" />
          ) : (
            <Mic size={36} aria-hidden="true" />
          )}
        </button>
        <p className="admin-voice-status" role="status" aria-live="polite">
          {statusText[phase]}
        </p>

        <form
          className="admin-form"
          onSubmit={(event) => {
            event.preventDefault();
            setOutcome(null);
            void submit(transcript, "typed");
          }}
        >
          <label>
            نص العملية
            <textarea
              value={transcript}
              rows={2}
              maxLength={600}
              placeholder="مثال: بعت لأحمد عبوتين جلي ودفع كامل"
              onChange={(event) => setTranscript(event.target.value)}
            />
          </label>
          <button
            type="submit"
            className="admin-btn admin-btn-primary"
            disabled={phase !== "idle" || busy || !transcript.trim()}
          >
            تنفيذ
          </button>
        </form>
        {notice ? (
          <p className="admin-form-warning" role="alert">
            {notice}
          </p>
        ) : null}
      </section>

      {outcome?.kind === "failed" ? (
        <section className="admin-panel" aria-label="لم تكتمل العملية">
          <p className="admin-form-error" role="alert">
            {outcome.message}
          </p>
          <div className="admin-form-actions">
            <Link
              className="admin-btn admin-btn-secondary"
              href="/admin/sales/new"
              prefetch={false}
            >
              إدخال بيع يدوي
            </Link>
          </div>
        </section>
      ) : null}

      {outcome?.kind === "clarify" ? (
        <section className="admin-panel" aria-labelledby="clarify-title">
          <h2 id="clarify-title" className="admin-voice-question">
            <MessageCircleQuestion size={20} aria-hidden="true" />
            {outcome.question}
          </h2>
          <div className="admin-suggestions-plain">
            {outcome.options.map((option) => (
              <button
                key={option.value}
                type="button"
                className="admin-suggestion"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    answerVoiceClarificationAction({
                      commandId: outcome.commandId,
                      field: outcome.field,
                      value: option.value,
                    }),
                  )
                }
              >
                {option.label}
              </button>
            ))}
          </div>
          {outcome.allowText ? (
            <form
              className="admin-form"
              onSubmit={(event) => {
                event.preventDefault();
                void run(() =>
                  answerVoiceClarificationAction({
                    commandId: outcome.commandId,
                    field: outcome.field,
                    value: clarifyText,
                  }),
                );
              }}
            >
              <label>
                الإجابة
                <input
                  value={clarifyText}
                  maxLength={100}
                  onChange={(event) => setClarifyText(event.target.value)}
                />
              </label>
              <button
                type="submit"
                className="admin-btn admin-btn-primary"
                disabled={busy || !clarifyText.trim()}
              >
                متابعة
              </button>
            </form>
          ) : null}
          {startOver}
        </section>
      ) : null}

      {outcome?.kind === "payment" ? (
        <section className="admin-panel" aria-labelledby="voice-payment-title">
          <h2 id="voice-payment-title">تأكيد تسجيل دفعة</h2>
          <dl className="admin-definition-list admin-totals">
            <dt>الزبون</dt>
            <dd>{outcome.customerName}</dd>
            <dt>المبلغ المستلم</dt>
            <dd>
              <Money agorot={outcome.amountAgorot} />
            </dd>
            <dt>الرصيد قبل</dt>
            <dd>
              <Money agorot={outcome.balanceBeforeAgorot} />
            </dd>
            <dt>الرصيد بعد</dt>
            <dd>
              <Money agorot={outcome.balanceAfterAgorot} />
            </dd>
          </dl>
          <div className="admin-form-actions">
            <button
              type="button"
              className="admin-btn admin-btn-primary"
              disabled={busy}
              onClick={() =>
                void run(() => confirmVoicePaymentAction(outcome.commandId))
              }
            >
              {busy ? "جارٍ الحفظ…" : "تأكيد وحفظ الدفعة"}
            </button>
            {startOver}
          </div>
        </section>
      ) : null}

      {outcome?.kind === "adjust" ? (
        <section className="admin-panel" aria-labelledby="voice-adjust-title">
          <h2 id="voice-adjust-title">تأكيد تعديل المخزون</h2>
          <dl className="admin-definition-list admin-totals">
            <dt>الصنف</dt>
            <dd>{outcome.name}</dd>
            <dt>السبب</dt>
            <dd>{outcome.reasonLabel}</dd>
            <dt>الكمية الآن</dt>
            <dd>
              <Quantity milli={outcome.onHandMilli} />
            </dd>
            <dt>الكمية بعد التعديل</dt>
            <dd>
              <Quantity milli={outcome.onHandAfterMilli} />
            </dd>
          </dl>
          <div className="admin-form-actions">
            <button
              type="button"
              className="admin-btn admin-btn-primary"
              disabled={busy}
              onClick={() =>
                void run(() => confirmVoiceAdjustmentAction(outcome.commandId))
              }
            >
              {busy ? "جارٍ الحفظ…" : "تأكيد وحفظ التعديل"}
            </button>
            {startOver}
          </div>
        </section>
      ) : null}

      {outcome?.kind === "answer" ? (
        <section className="admin-panel admin-voice-answer" aria-live="polite">
          <CheckCircle2 size={24} aria-hidden="true" />
          <p>{outcome.text}</p>
          <div className="admin-form-actions">
            {outcome.href ? (
              <Link
                className="admin-btn admin-btn-secondary"
                href={outcome.href}
                prefetch={false}
              >
                عرض التفاصيل
              </Link>
            ) : null}
            {startOver}
          </div>
        </section>
      ) : null}

      {!outcome ? (
        <section className="admin-panel" aria-labelledby="voice-examples-title">
          <h2 id="voice-examples-title">جرّبي أن تقولي</h2>
          <ul className="admin-voice-examples">
            {examples.map((example) => (
              <li key={example}>
                <button
                  type="button"
                  className="admin-suggestion"
                  onClick={() => setTranscript(example)}
                >
                  {example}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
