"use client";

import Image from "next/image";
import Link from "next/link";
import { Camera, ImagePlus, LoaderCircle, Sparkles } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";

import { createCapturedProductAction } from "@/features/admin/application/admin-actions";
import { CategoryOptions } from "@/features/admin/ui/admin-categories";

type Analysis = {
  draft: {
    nameAr: string;
    latinName: string;
    description: string;
    unit: string;
    categoryId: string;
    brand: string;
    sizeValue: string;
    sizeUnit: string;
    barcode: string;
    confidence: number;
  };
  image: { src: string; width: number; height: number };
};

async function preparePhotoForUpload(file: File): Promise<File> {
  if (file.size <= 3_000_000) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1_800 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("تعذّر تجهيز الصورة على هذا الجهاز.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.84),
  );
  if (!blob) throw new Error("تعذّر ضغط الصورة.");
  return new File([blob], "product.webp", { type: "image/webp" });
}

export function ProductCaptureWizard() {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [clean, setClean] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [actionState, formAction, saving] = useActionState(
    createCapturedProductAction,
    null,
  );

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  async function analyze() {
    if (!photo) {
      setMessage("صوّري المنتج أو اختاري صورة أولاً.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const body = new FormData();
      body.set("photo", await preparePhotoForUpload(photo));
      body.set("clean", String(clean));
      const response = await fetch("/api/admin/products/analyze", {
        method: "POST",
        body,
      });
      const payload = (await response.json()) as
        ({ ok: true } & Analysis) | { ok: false; message?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(
          "message" in payload && payload.message
            ? payload.message
            : "تعذّر قراءة الصورة.",
        );
      }
      setAnalysis(payload);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "تعذّر قراءة الصورة.",
      );
    } finally {
      setBusy(false);
    }
  }

  function selectPhoto(selected: File | null) {
    setPhoto(selected);
    setPreview((current) => {
      if (current) URL.revokeObjectURL(current);
      return selected ? URL.createObjectURL(selected) : null;
    });
    setAnalysis(null);
    setMessage(null);
  }

  if (!analysis) {
    return (
      <section className="admin-capture" aria-labelledby="capture-title">
        <header className="admin-capture-heading">
          <span>1 من 2</span>
          <div>
            <h1 id="capture-title">إضافة منتج</h1>
            <p>صوّري العبوة بوضوح وسنقرأ بياناتها تلقائياً.</p>
          </div>
        </header>

        <button
          className="admin-camera-frame"
          type="button"
          onClick={() => cameraRef.current?.click()}
        >
          {preview ? (
            <Image src={preview} alt="معاينة صورة المنتج" fill unoptimized />
          ) : (
            <span>
              <Camera size={42} aria-hidden="true" />
              ضعي المنتج داخل الإطار
            </span>
          )}
        </button>
        <input
          ref={cameraRef}
          className="sr-only"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          aria-label="التقاط صورة المنتج"
          onChange={(event) => selectPhoto(event.target.files?.[0] ?? null)}
        />
        <input
          ref={galleryRef}
          className="sr-only"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          aria-label="اختيار صورة المنتج من المعرض"
          onChange={(event) => selectPhoto(event.target.files?.[0] ?? null)}
        />

        <div className="admin-capture-actions">
          <button
            className="admin-btn admin-btn-primary"
            type="button"
            onClick={() => cameraRef.current?.click()}
          >
            <Camera size={20} aria-hidden="true" />
            التقاط صورة
          </button>
          <button
            className="admin-btn admin-btn-secondary"
            type="button"
            onClick={() => galleryRef.current?.click()}
          >
            <ImagePlus size={20} aria-hidden="true" />
            اختيار من الصور
          </button>
        </div>

        <label className="admin-capture-toggle">
          <input
            type="checkbox"
            checked={clean}
            onChange={(event) => setClean(event.target.checked)}
          />
          <span>
            <strong>تحسين خلفية الصورة</strong>
            <small>إزالة التشويش وتجهيز صورة واضحة للمتجر</small>
          </span>
        </label>

        <p className="admin-capture-trust">
          <Sparkles size={18} aria-hidden="true" />
          سنقرأ الاسم والحجم تلقائياً — راجعيهما قبل الحفظ.
        </p>
        {message ? (
          <p className="admin-form-error" role="alert">
            {message}
          </p>
        ) : null}
        <button
          className="admin-btn admin-btn-primary admin-capture-submit"
          type="button"
          disabled={!photo || busy}
          onClick={analyze}
        >
          {busy ? (
            <LoaderCircle className="admin-spin" size={20} />
          ) : (
            <Sparkles size={20} />
          )}
          {busy ? "جارٍ قراءة المنتج…" : "قراءة بيانات المنتج"}
        </button>
        <Link
          className="admin-capture-manual"
          href="/admin/products/new/manual"
        >
          إدخال المنتج يدوياً
        </Link>
      </section>
    );
  }

  const size = [analysis.draft.sizeValue, analysis.draft.sizeUnit]
    .filter(Boolean)
    .join(" ");

  return (
    <section
      className="admin-capture admin-capture-review"
      aria-labelledby="review-title"
    >
      <header className="admin-capture-heading">
        <span>2 من 2</span>
        <div>
          <h1 id="review-title">راجعي بيانات المنتج</h1>
          <p>الحقول مقترحة من الصورة. السعر يجب إدخاله يدوياً.</p>
        </div>
      </header>
      <div className="admin-review-image">
        <Image
          src={analysis.image.src}
          alt="صورة المنتج بعد التحسين"
          fill
          sizes="(max-width: 640px) 100vw, 360px"
        />
      </div>
      <form className="admin-form admin-capture-form" action={formAction}>
        <input type="hidden" name="imageSrc" value={analysis.image.src} />
        <input type="hidden" name="imageWidth" value={analysis.image.width} />
        <input type="hidden" name="imageHeight" value={analysis.image.height} />
        <label>
          اسم المنتج
          <input name="nameAr" required defaultValue={analysis.draft.nameAr} />
        </label>
        <div className="admin-field-grid">
          <label>
            السعر بالشيكل
            <input
              name="priceIls"
              required
              inputMode="decimal"
              dir="ltr"
              placeholder="0.00"
            />
          </label>
          <label>
            الفئة
            <select name="categoryId" defaultValue={analysis.draft.categoryId}>
              <CategoryOptions />
            </select>
          </label>
        </div>
        <label>
          وصف قصير
          <textarea
            name="description"
            rows={3}
            defaultValue={analysis.draft.description}
          />
        </label>
        <div className="admin-field-grid">
          <label>
            الحجم
            <input name="size" defaultValue={size} />
          </label>
          <label>
            الوحدة
            <input name="unit" defaultValue={analysis.draft.unit} />
          </label>
          <label>
            العلامة التجارية
            <input name="brand" defaultValue={analysis.draft.brand} />
          </label>
          <label>
            الباركود
            <input
              name="barcode"
              dir="ltr"
              defaultValue={analysis.draft.barcode}
            />
          </label>
        </div>
        <input
          type="hidden"
          name="latinName"
          value={analysis.draft.latinName}
        />
        <p className="admin-inline-note">
          سيُحفظ المنتج كغير متاح حتى تراجعيه وتنشريه.
        </p>
        {actionState?.message ? (
          <p className="admin-form-error" role="alert">
            {actionState.message}
          </p>
        ) : null}
        <div className="admin-capture-actions">
          <button
            className="admin-btn admin-btn-primary"
            type="submit"
            disabled={saving}
          >
            {saving ? "جارٍ الحفظ…" : "حفظ المنتج"}
          </button>
          <button
            className="admin-btn admin-btn-secondary"
            type="button"
            onClick={() => setAnalysis(null)}
          >
            إعادة التصوير
          </button>
        </div>
      </form>
    </section>
  );
}
