"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import Link from "next/link";
import {
  ImagePlus,
  LoaderCircle,
  Mic,
  RotateCcw,
  Send,
  Square,
  SquarePen,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { AssistantUIMessage } from "@/server/ai/assistant-agent";

import { voiceStatusLabels } from "../domain/voice-state";
import { ConfirmationCard } from "./confirmation-card";
import { prepareAttachment } from "./prepare-attachment";
import { useVoiceRecorder } from "./use-voice-recorder";

// Only the new message travels; the server rebuilds the conversation from its own records.
const transport = new DefaultChatTransport<AssistantUIMessage>({
  api: "/admin/api/assistant/chat",
  prepareSendMessagesRequest: ({ messages, body }) => ({
    body: {
      conversationId:
        (body as { conversationId?: string | null } | undefined)
          ?.conversationId ?? null,
      message: messages[messages.length - 1],
    },
  }),
});

interface PendingAttachment {
  key: string;
  name: string;
  previewUrl: string | null;
  status: "uploading" | "ready" | "failed";
  id: string | null;
  error: string | null;
  file: File;
}

const toolLabels: Record<string, string> = {
  searchProducts: "البحث في المنتجات",
  getProductDetails: "قراءة بيانات المنتج",
  getInventoryItem: "قراءة المخزون",
  getInventorySummary: "حساب قيمة المخزون",
  getLowStockItems: "فحص النواقص",
  searchOrders: "البحث في الطلبات",
  getOrderDetails: "قراءة الطلب",
  searchCustomers: "البحث في الزبائن",
  getCustomerBalance: "قراءة رصيد الزبون",
  getDebtors: "قراءة الديون",
  getPurchaseInvoice: "قراءة فواتير الشراء",
  getSalesSummary: "حساب المبيعات",
  getProfitSummary: "حساب الربح",
};

const ATTACHMENT_NOTE = /\n?\[مرفقات: [^\]]*\]$/;

function displayText(text: string) {
  return text.replace(ATTACHMENT_NOTE, "");
}

type ToolPart = {
  type: string;
  toolCallId: string;
  state: string;
  output?: unknown;
  errorText?: string;
};

function ToolPartView({
  part,
  onChoose,
  busy,
}: {
  part: ToolPart;
  onChoose: (text: string) => void;
  busy: boolean;
}) {
  const name = part.type.slice(5);
  if (part.state === "input-streaming" || part.state === "input-available") {
    return (
      <p className="assistant-tool-progress" role="status">
        <LoaderCircle className="admin-spin" size={16} aria-hidden="true" />
        {name.startsWith("prepare")
          ? "جارٍ تجهيز بطاقة التأكيد…"
          : `${toolLabels[name] ?? "جارٍ العمل"}…`}
      </p>
    );
  }
  if (part.state === "output-error") {
    return <p className="assistant-tool-error">تعذّر تنفيذ الخطوة.</p>;
  }
  const output = (part.output ?? {}) as {
    status?: string;
    confirmationId?: string;
    message?: string;
    question?: string;
    options?: Array<{ id: string; label: string }>;
    field?: string;
    results?: Array<{
      label: string;
      price: string;
      stock: string;
      href: string;
    }>;
    href?: string;
  };
  if (output.status === "awaiting_confirmation" && output.confirmationId) {
    return <ConfirmationCard confirmationId={output.confirmationId} />;
  }
  if (output.status === "needs_selection" && output.options?.length) {
    return (
      <div
        className="assistant-choices"
        role="group"
        aria-label={output.question ?? "اختاري"}
      >
        <p>{output.question}</p>
        {output.options.map((option) => (
          <button
            key={option.id}
            type="button"
            className="admin-btn admin-btn-secondary"
            disabled={busy}
            onClick={() =>
              onChoose(`اخترت: ${option.label} (المعرّف ${option.id})`)
            }
          >
            {option.label}
          </button>
        ))}
      </div>
    );
  }
  if (
    output.status === "rejected" ||
    output.status === "error" ||
    output.status === "forbidden"
  ) {
    return <p className="assistant-tool-error">{output.message}</p>;
  }
  if (name === "searchProducts" && output.results?.length) {
    return (
      <ul className="assistant-results" aria-label="نتائج البحث">
        {output.results.map((row) => (
          <li key={row.href + row.label}>
            <Link href={row.href} prefetch={false}>
              {row.label}
            </Link>
            <span>
              {row.price} · {row.stock}
            </span>
          </li>
        ))}
      </ul>
    );
  }
  if (output.href) {
    return (
      <Link className="assistant-tool-link" href={output.href} prefetch={false}>
        عرض التفاصيل
      </Link>
    );
  }
  return null;
}

export function AssistantPanel({
  onClose,
  onActivity,
}: {
  onClose: () => void;
  onActivity: (active: boolean) => void;
}) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const conversationRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const appendTranscript = useCallback((transcript: string) => {
    setInput((current) => (current ? `${current} ${transcript}` : transcript));
    inputRef.current?.focus();
  }, []);
  const voice = useVoiceRecorder(appendTranscript);

  const {
    messages,
    sendMessage,
    status,
    stop,
    error,
    regenerate,
    setMessages,
  } = useChat<AssistantUIMessage>({ transport });

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/admin/api/assistant/conversation", {
          cache: "no-store",
        });
        const body = (await response.json()) as {
          ok: boolean;
          conversationId: string | null;
          messages: AssistantUIMessage[];
          message?: string;
        };
        if (!active) return;
        if (!body.ok) {
          setLoadError(body.message ?? "المساعد غير متاح.");
        } else {
          conversationRef.current = body.conversationId;
          setConversationId(body.conversationId);
          setMessages(body.messages);
        }
      } catch {
        if (active) setLoadError("تعذّر تحميل المحادثة. تحققي من الاتصال.");
      }
      if (active) setLoaded(true);
    })();
    return () => {
      active = false;
    };
  }, [setMessages]);

  useEffect(() => {
    const last = messages.at(-1);
    const id = (last?.metadata as { conversationId?: string } | undefined)
      ?.conversationId;
    if (id && id !== conversationRef.current) {
      conversationRef.current = id;
      setConversationId(id);
    }
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => {
    onActivity(status === "streaming" || status === "submitted");
  }, [status, onActivity]);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(
    () => () => {
      for (const item of attachments) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
    },
    // Object URLs are released once, when the panel unmounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const busy = status === "streaming" || status === "submitted";
  const uploading = attachments.some((item) => item.status === "uploading");

  async function upload(item: PendingAttachment) {
    setAttachments((current) =>
      current.map((entry) =>
        entry.key === item.key
          ? { ...entry, status: "uploading", error: null }
          : entry,
      ),
    );
    try {
      const blob = await prepareAttachment(item.file);
      const response = await fetch("/admin/api/assistant/attachments", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: blob,
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        attachment?: { id: string };
        message?: string;
      };
      if (!response.ok || !body.ok || !body.attachment) {
        throw new Error(
          body.message ??
            (response.status === 413 ? "الملف كبير جداً." : "تعذّر رفع الملف."),
        );
      }
      const id = body.attachment.id;
      setAttachments((current) =>
        current.map((entry) =>
          entry.key === item.key ? { ...entry, status: "ready", id } : entry,
        ),
      );
    } catch (failure) {
      const message =
        failure instanceof Error && failure.message === "too_large"
          ? "الملف كبير جداً حتى بعد ضغطه."
          : failure instanceof Error && failure.message === "unsupported"
            ? "نوع الملف غير مدعوم."
            : failure instanceof Error
              ? failure.message
              : "تعذّر رفع الملف.";
      setAttachments((current) =>
        current.map((entry) =>
          entry.key === item.key
            ? { ...entry, status: "failed", error: message }
            : entry,
        ),
      );
    }
  }

  function addFiles(list: FileList | null) {
    if (!list) return;
    const room = 6 - attachments.length;
    const added = [...list].slice(0, Math.max(room, 0)).map((file) => ({
      key: crypto.randomUUID(),
      name: file.name,
      previewUrl: file.type.startsWith("image/")
        ? URL.createObjectURL(file)
        : null,
      status: "uploading" as const,
      id: null,
      error: null,
      file,
    }));
    setAttachments((current) => [...current, ...added]);
    for (const item of added) void upload(item);
  }

  function removeAttachment(key: string) {
    setAttachments((current) => {
      const target = current.find((item) => item.key === key);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return current.filter((item) => item.key !== key);
    });
  }

  function send(text: string) {
    const ready = attachments.filter(
      (item) => item.status === "ready" && item.id,
    );
    const value = text.trim();
    if ((!value && !ready.length) || busy || uploading) return;
    void sendMessage(
      {
        text: value || "أرفقت ملفات.",
        metadata: ready.length
          ? { attachmentIds: ready.map((item) => item.id!) }
          : undefined,
      } as Parameters<typeof sendMessage>[0],
      { body: { conversationId: conversationRef.current } },
    );
    setInput("");
    for (const item of ready)
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    setAttachments((current) =>
      current.filter((item) => item.status !== "ready"),
    );
  }

  async function newConversation() {
    if (busy) return;
    const id = conversationRef.current;
    conversationRef.current = null;
    setConversationId(null);
    setMessages([]);
    if (id) {
      await fetch(`/admin/api/assistant/conversation?id=${id}`, {
        method: "DELETE",
      }).catch(() => undefined);
    }
  }

  const voiceLabel =
    voice.state.name === "failed"
      ? voice.state.message
      : voiceStatusLabels[voice.state.name];
  const statusLabel = voiceLabel
    ? voiceLabel
    : status === "submitted"
      ? "جارٍ التحليل…"
      : status === "streaming"
        ? "يكتب الرد…"
        : uploading
          ? "جارٍ رفع المرفقات…"
          : "";

  return (
    <section
      className="assistant-panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby="assistant-title"
      data-conversation={conversationId ?? undefined}
    >
      <header className="assistant-head">
        <h2 id="assistant-title">المساعد</h2>
        <div className="assistant-head-actions">
          <button
            type="button"
            className="assistant-icon-btn"
            aria-label="محادثة جديدة"
            disabled={busy}
            onClick={() => void newConversation()}
          >
            <SquarePen size={20} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="assistant-icon-btn"
            aria-label="إغلاق المساعد"
            onClick={onClose}
          >
            <X size={22} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="assistant-messages" ref={listRef} aria-live="polite">
        {!loaded ? (
          <p className="assistant-empty">
            <LoaderCircle className="admin-spin" size={18} aria-hidden="true" />{" "}
            جارٍ التحميل…
          </p>
        ) : loadError ? (
          <p className="assistant-tool-error">{loadError}</p>
        ) : !messages.length ? (
          <div className="assistant-empty">
            <p>
              اسألي عن المخزون أو المبيعات، أو اطلبي تعديلاً وسأجهّز لك بطاقة
              تأكيد.
            </p>
            <div className="assistant-suggestions">
              {[
                "شو المنتجات اللي قربت تخلص؟",
                "كم ربحت هذا الأسبوع؟",
                "مين عليه ديون؟",
              ].map((text) => (
                <button
                  key={text}
                  type="button"
                  className="admin-btn admin-btn-secondary"
                  onClick={() => send(text)}
                >
                  {text}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <article
              key={message.id}
              className="assistant-message"
              data-role={message.role}
              aria-label={message.role === "user" ? "رسالتك" : "رد المساعد"}
            >
              {message.parts.map((part, index) => {
                if (part.type === "text") {
                  const value =
                    message.role === "user"
                      ? displayText(part.text)
                      : part.text;
                  return value ? (
                    <p key={index} className="assistant-text" dir="auto">
                      {value}
                    </p>
                  ) : null;
                }
                if (part.type.startsWith("tool-")) {
                  return (
                    <ToolPartView
                      key={(part as ToolPart).toolCallId}
                      part={part as ToolPart}
                      busy={busy}
                      onChoose={send}
                    />
                  );
                }
                return null;
              })}
              {message.role === "user" &&
              (message.metadata as { attachmentIds?: string[] } | undefined)
                ?.attachmentIds?.length ? (
                <div className="assistant-thumbs">
                  {(
                    message.metadata as { attachmentIds: string[] }
                  ).attachmentIds.map((id) => (
                    // eslint-disable-next-line @next/next/no-img-element -- private attachment preview
                    <img
                      key={id}
                      src={`/admin/api/assistant/attachments/${id}`}
                      alt="مرفق"
                    />
                  ))}
                </div>
              ) : null}
            </article>
          ))
        )}
        {error ? (
          <div className="assistant-tool-error" role="alert">
            <p>
              {error.message.startsWith("{")
                ? "تعذّر الرد الآن."
                : error.message || "تعذّر الرد الآن."}
            </p>
            <button
              type="button"
              className="admin-btn admin-btn-secondary"
              onClick={() =>
                void regenerate({
                  body: { conversationId: conversationRef.current },
                })
              }
            >
              <RotateCcw size={16} aria-hidden="true" /> إعادة المحاولة
            </button>
          </div>
        ) : null}
      </div>

      <form
        className="assistant-composer"
        onSubmit={(event) => {
          event.preventDefault();
          send(input);
        }}
      >
        {statusLabel ? (
          <p className="assistant-status" role="status">
            {statusLabel}
          </p>
        ) : null}
        {attachments.length ? (
          <ul className="assistant-attachments" aria-label="المرفقات">
            {attachments.map((item) => (
              <li key={item.key} data-status={item.status}>
                {item.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
                  <img src={item.previewUrl} alt={`معاينة ${item.name}`} />
                ) : (
                  <span className="assistant-attachment-file">PDF</span>
                )}
                {item.status === "uploading" ? (
                  <LoaderCircle
                    className="admin-spin"
                    size={16}
                    aria-label="جارٍ الرفع"
                  />
                ) : null}
                {item.status === "failed" ? (
                  <button
                    type="button"
                    className="assistant-attachment-retry"
                    onClick={() => void upload(item)}
                  >
                    إعادة الرفع
                  </button>
                ) : null}
                <button
                  type="button"
                  className="assistant-attachment-remove"
                  aria-label={`حذف المرفق ${item.name}`}
                  onClick={() => removeAttachment(item.key)}
                >
                  <X size={14} aria-hidden="true" />
                </button>
                {item.error ? (
                  <span className="assistant-attachment-error">
                    {item.error}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="assistant-composer-row">
          <button
            type="button"
            className="assistant-icon-btn"
            aria-label="إرفاق صورة أو ملف"
            disabled={attachments.length >= 6}
            onClick={() => fileRef.current?.click()}
          >
            <ImagePlus size={22} aria-hidden="true" />
          </button>
          <input
            ref={fileRef}
            className="sr-only"
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            multiple
            aria-label="اختيار مرفقات"
            onChange={(event) => {
              addFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <label className="sr-only" htmlFor="assistant-input">
            رسالتك للمساعد
          </label>
          <textarea
            id="assistant-input"
            ref={inputRef}
            value={input}
            rows={1}
            maxLength={2_000}
            dir="auto"
            placeholder="اكتبي أو سجّلي طلبك…"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                send(input);
              }
            }}
          />
          <button
            type="button"
            className="assistant-icon-btn"
            data-listening={voice.state.name === "listening" || undefined}
            aria-pressed={voice.state.name === "listening"}
            aria-label={
              voice.state.name === "listening" ? "إيقاف التسجيل" : "تسجيل صوتي"
            }
            disabled={
              voice.state.name === "requesting" ||
              voice.state.name === "transcribing"
            }
            onClick={() =>
              voice.state.name === "listening"
                ? voice.stop()
                : void voice.start()
            }
          >
            {voice.state.name === "transcribing" ? (
              <LoaderCircle
                className="admin-spin"
                size={22}
                aria-hidden="true"
              />
            ) : voice.state.name === "listening" ? (
              <Square size={20} aria-hidden="true" />
            ) : (
              <Mic size={22} aria-hidden="true" />
            )}
          </button>
          {busy ? (
            <button
              type="button"
              className="assistant-send"
              aria-label="إيقاف الرد"
              onClick={() => void stop()}
            >
              <Square size={18} aria-hidden="true" />
            </button>
          ) : (
            <button
              type="submit"
              className="assistant-send"
              aria-label="إرسال"
              disabled={
                uploading ||
                (!input.trim() &&
                  !attachments.some((item) => item.status === "ready"))
              }
            >
              <Send size={20} aria-hidden="true" />
            </button>
          )}
        </div>
        {voice.state.name === "listening" ? (
          <button
            type="button"
            className="assistant-voice-cancel"
            onClick={voice.cancel}
          >
            إلغاء التسجيل
          </button>
        ) : null}
      </form>
    </section>
  );
}
