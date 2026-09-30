"use client";

import Link from "next/link";
import {
  Camera,
  FileText,
  ImagePlus,
  LoaderCircle,
  RotateCw,
  Sparkles,
  Trash2,
  WifiOff,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { useUnsavedChanges } from "@/shared/ui/use-unsaved-changes";

const MAX_PAGES = 6;
const IMAGE_TYPES = "image/jpeg,image/png,image/webp";

interface Page {
  id: string;
  file: File;
  previewUrl: string | null;
}

type Phase =
  | { name: "idle" }
  | { name: "uploading"; percent: number }
  | { name: "reading" }
  | { name: "failed"; message: string };

function subscribeOnline(listener: () => void) {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

async function reencode(file: File, quarterTurns: number): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2_200 / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const swap = quarterTurns % 2 === 1;
  const canvas = document.createElement("canvas");
  canvas.width = swap ? height : width;
  canvas.height = swap ? width : height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas");
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((quarterTurns * Math.PI) / 2);
  context.drawImage(bitmap, -width / 2, -height / 2, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.88),
  );
  if (!blob) throw new Error("encode");
  return new File([blob], "invoice.jpg", { type: "image/jpeg" });
}

function send(
  pages: Page[],
  idempotencyKey: string,
  onProgress: (percent: number) => void,
  onUploaded: () => void,
): Promise<
  | { ok: true; jobId: string }
  | { ok: false; message: string; retrySameKey: boolean }
> {
  return new Promise((resolve) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/admin/api/invoices");
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });
    request.upload.addEventListener("load", onUploaded);
    request.addEventListener("error", () =>
      resolve({
        ok: false,
        message: "انقطع الاتصال. الصور ما زالت هنا — أعيدي المحاولة.",
        retrySameKey: true,
      }),
    );
    request.addEventListener("load", () => {
      try {
        const body = JSON.parse(request.responseText) as {
          ok: boolean;
          jobId?: string;
          message?: string;
        };
        if (body.ok && body.jobId) resolve({ ok: true, jobId: body.jobId });
        else {
          resolve({
            ok: false,
            message: body.message ?? "تعذّرت قراءة الفاتورة.",
            retrySameKey: false,
          });
        }
      } catch {
        resolve({
          ok: false,
          message: "انتهت الجلسة أو تعذّر الإرسال. حدّثي الصفحة وحاولي مجدداً.",
          retrySameKey: false,
        });
      }
    });
    const body = new FormData();
    for (const page of pages) body.append("files", page.file);
    body.set("idempotencyKey", idempotencyKey);
    request.send(body);
  });
}

export function InvoiceCaptureWizard() {
  const router = useRouter();
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [notice, setNotice] = useState<string | null>(null);
  // The same key is reused when the network drops, so one capture never becomes two reviews.
  const [retryKey, setRetryKey] = useState<string | null>(null);
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
  const pagesRef = useRef(pages);
  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);
  useEffect(
    () => () => {
      for (const page of pagesRef.current) {
        if (page.previewUrl) URL.revokeObjectURL(page.previewUrl);
      }
    },
    [],
  );
  const busy = phase.name === "uploading" || phase.name === "reading";
  useUnsavedChanges(pages.length > 0 && phase.name !== "reading");

  const hasPdf = pages.some((page) => page.file.type === "application/pdf");

  function add(files: FileList | null) {
    if (!files?.length) return;
    setNotice(null);
    setRetryKey(null);
    const incoming = [...files];
    const pdf = incoming.find((file) => file.type === "application/pdf");
    if (pdf) {
      for (const page of pages) {
        if (page.previewUrl) URL.revokeObjectURL(page.previewUrl);
      }
      setPages([{ id: crypto.randomUUID(), file: pdf, previewUrl: null }]);
      return;
    }
    const room = MAX_PAGES - (hasPdf ? 0 : pages.length);
    if (incoming.length > room) {
      setNotice(`الحد الأقصى ${MAX_PAGES} صور للفاتورة الواحدة.`);
    }
    const added = incoming.slice(0, Math.max(room, 0)).map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setPages((current) => [...(hasPdf ? [] : current), ...added]);
  }

  function remove(id: string) {
    setRetryKey(null);
    setPages((current) => {
      const target = current.find((page) => page.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return current.filter((page) => page.id !== id);
    });
  }

  async function rotate(id: string) {
    const target = pages.find((page) => page.id === id);
    if (!target) return;
    try {
      const file = await reencode(target.file, 1);
      const previewUrl = URL.createObjectURL(file);
      if (target.previewUrl) URL.revokeObjectURL(target.previewUrl);
      setPages((current) =>
        current.map((page) =>
          page.id === id ? { ...page, file, previewUrl } : page,
        ),
      );
    } catch {
      setNotice("تعذّر تدوير الصورة على هذا الجهاز.");
    }
  }

  async function submit() {
    if (!pages.length || busy) return;
    setNotice(null);
    setPhase({ name: "uploading", percent: 0 });
    let prepared = pages;
    try {
      // Large camera photos are downscaled on the device to save mobile data.
      prepared = await Promise.all(
        pages.map(async (page) =>
          page.file.type !== "application/pdf" && page.file.size > 3_000_000
            ? { ...page, file: await reencode(page.file, 0) }
            : page,
        ),
      );
    } catch {
      prepared = pages;
    }
    const idempotencyKey = retryKey ?? crypto.randomUUID();
    const result = await send(
      prepared,
      idempotencyKey,
      (percent) => setPhase({ name: "uploading", percent }),
      () => setPhase({ name: "reading" }),
    );
    if (!result.ok) {
      setRetryKey(result.retrySameKey ? idempotencyKey : null);
      setPhase({ name: "failed", message: result.message });
      return;
    }
    setPhase({ name: "reading" });
    router.push(`/admin/inventory/review/${result.jobId}`);
  }

  return (
    <section className="admin-capture" aria-labelledby="invoice-capture-title">
      <header className="admin-capture-heading">
        <span>1 من 2</span>
        <div>
          <h1 id="invoice-capture-title">تصوير فاتورة شراء</h1>
          <p>صوّري كل صفحات الفاتورة بوضوح. تراجعين القراءة قبل أي حفظ.</p>
        </div>
      </header>

      {pages.length ? (
        <ul className="admin-capture-pages" aria-label="صفحات الفاتورة">
          {pages.map((page, index) => (
            <li key={page.id}>
              {page.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
                <img src={page.previewUrl} alt={`الصفحة ${index + 1}`} />
              ) : (
                <span className="admin-capture-pdf">
                  <FileText size={28} aria-hidden="true" />
                  <bdi>{page.file.name}</bdi>
                </span>
              )}
              <div className="admin-capture-page-actions">
                {page.previewUrl ? (
                  <button
                    type="button"
                    className="admin-btn admin-btn-secondary admin-btn-icon"
                    aria-label={`تدوير الصفحة ${index + 1}`}
                    disabled={busy}
                    onClick={() => void rotate(page.id)}
                  >
                    <RotateCw size={18} aria-hidden="true" />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="admin-btn admin-btn-secondary admin-btn-icon"
                  aria-label={`حذف الصفحة ${index + 1}`}
                  disabled={busy}
                  onClick={() => remove(page.id)}
                >
                  <Trash2 size={18} aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <button
          className="admin-camera-frame"
          type="button"
          onClick={() => cameraRef.current?.click()}
        >
          <span>
            <Camera size={42} aria-hidden="true" />
            ضعي الفاتورة كاملة داخل الإطار
          </span>
        </button>
      )}

      <input
        ref={cameraRef}
        className="sr-only"
        type="file"
        accept={IMAGE_TYPES}
        capture="environment"
        aria-label="التقاط صورة الفاتورة"
        onChange={(event) => {
          add(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        ref={galleryRef}
        className="sr-only"
        type="file"
        accept={IMAGE_TYPES}
        multiple
        aria-label="اختيار صور الفاتورة"
        onChange={(event) => {
          add(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        ref={pdfRef}
        className="sr-only"
        type="file"
        accept="application/pdf"
        aria-label="اختيار ملف PDF"
        onChange={(event) => {
          add(event.target.files);
          event.target.value = "";
        }}
      />

      <div className="admin-capture-actions">
        <button
          className="admin-btn admin-btn-primary"
          type="button"
          disabled={busy}
          onClick={() => cameraRef.current?.click()}
        >
          <Camera size={20} aria-hidden="true" />
          {pages.length ? "صفحة أخرى" : "التقاط صورة"}
        </button>
        <button
          className="admin-btn admin-btn-secondary"
          type="button"
          disabled={busy}
          onClick={() => galleryRef.current?.click()}
        >
          <ImagePlus size={20} aria-hidden="true" />
          من الصور
        </button>
        <button
          className="admin-btn admin-btn-secondary"
          type="button"
          disabled={busy}
          onClick={() => pdfRef.current?.click()}
        >
          <FileText size={20} aria-hidden="true" />
          ملف PDF
        </button>
      </div>

      <p className="admin-capture-trust">
        <Sparkles size={18} aria-hidden="true" />
        القراءة آلية وقد تخطئ — لا يُحفظ شيء قبل مراجعتك وتأكيدك.
      </p>

      {!online ? (
        <p className="admin-form-warning" role="status">
          <WifiOff size={16} aria-hidden="true" />
          لا يوجد اتصال بالإنترنت. الصور محفوظة في هذه الصفحة؛ أرسليها عند عودة
          الاتصال.
        </p>
      ) : null}
      {notice ? (
        <p className="admin-form-warning" role="status">
          {notice}
        </p>
      ) : null}
      {phase.name === "uploading" ? (
        <div role="status">
          <progress
            className="admin-progress"
            max={100}
            value={phase.percent}
            aria-label="تقدّم رفع الصور"
          />
          <p>
            جارٍ رفع الصور… <bdi dir="ltr">{phase.percent}%</bdi>
          </p>
        </div>
      ) : null}
      {phase.name === "failed" ? (
        <p className="admin-form-error" role="alert">
          {phase.message}
        </p>
      ) : null}

      <button
        className="admin-btn admin-btn-primary admin-capture-submit"
        type="button"
        disabled={!pages.length || busy || !online}
        onClick={() => void submit()}
      >
        {phase.name === "reading" ? (
          <LoaderCircle className="admin-spin" size={20} aria-hidden="true" />
        ) : (
          <Sparkles size={20} aria-hidden="true" />
        )}
        {phase.name === "reading"
          ? "جارٍ قراءة الفاتورة…"
          : phase.name === "failed"
            ? "إعادة المحاولة"
            : "قراءة الفاتورة"}
      </button>
      <Link
        className="admin-capture-manual"
        href="/admin/inventory/purchases/new"
      >
        إدخال الفاتورة يدوياً
      </Link>
    </section>
  );
}
