"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  galleryImageAction,
  valueSharedImageAction,
} from "@/features/admin/application/product-media-actions";
import type { ProductMatrix } from "@/features/admin/application/product-options-service";
import {
  GALLERY_UPLOAD_TYPES,
  galleryFileProblem,
} from "@/features/admin/domain/gallery-upload-limits";
import { imageTargetValue } from "@/features/admin/domain/image-target";
import { VISUAL_OPTION_KINDS } from "@/features/catalog/domain/product-media-validation";

import { postGalleryImage } from "./product-media-editor";

type Upload = { name: string; file: File; error: string | null };

export function ImageMappingCards({ matrix }: { matrix: ProductMatrix }) {
  const router = useRouter();
  const domainId = matrix.product.domainId;
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [failed, setFailed] = useState<Upload[]>([]);
  const options = matrix.options.filter((option) => !option.archived);
  const visualValues = options
    .filter((option) => VISUAL_OPTION_KINDS.has(option.kind))
    .flatMap((option) =>
      option.values.map((value) => ({ option: option.nameAr, ...value })),
    );
  const images = matrix.images.filter((image) => !image.archived);
  const variants = matrix.variants.filter((variant) => !variant.archived);
  const withPicture = new Set(
    images
      .filter((image) => image.scope === "option_value")
      .map((image) => image.optionValueId),
  );

  function report(ok: boolean, text: string) {
    setMessage({ ok, text });
    router.refresh();
  }

  function upload(files: File[]) {
    startTransition(async () => {
      const failures: Upload[] = [];
      for (const file of files) {
        const problem = galleryFileProblem(file);
        const result = problem
          ? { ok: false as const, message: problem }
          : await postGalleryImage(domainId, file, "", "unassigned");
        if (!result.ok)
          failures.push({ name: file.name, file, error: result.message });
      }
      setFailed(failures);
      report(
        !failures.length,
        failures.length
          ? `لم تُرفع ${failures.length} من ${files.length} صور. أعيدي المحاولة لها.`
          : "رُفعت الصور. اربطي كل صورة بما تُظهره.",
      );
    });
  }

  function map(imageId: string, target: string) {
    startTransition(async () => {
      const result = await galleryImageAction({
        productDomainId: domainId,
        imageId,
        action: "scope",
        target,
      });
      report(result.ok, result.ok ? "حُفظ ربط الصورة." : result.message);
    });
  }

  function shared(valueId: string, usesSharedImage: boolean) {
    startTransition(async () => {
      const result = await valueSharedImageAction({
        productDomainId: domainId,
        valueId,
        usesSharedImage,
      });
      report(result.ok, result.ok ? "حُفظ الاختيار." : result.message);
    });
  }

  return (
    <section
      id="wizard-images"
      className="admin-image-mapping"
      aria-labelledby="image-mapping"
    >
      <h2 id="image-mapping" className="admin-workspace-section-title">
        صور المنتج وربطها
      </h2>
      <div className="admin-image-mapping-upload">
        <label className="admin-button-primary">
          التقاط صورة
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            disabled={pending}
            onChange={(event) =>
              upload(Array.from(event.currentTarget.files ?? []))
            }
          />
        </label>
        <label className="admin-button-secondary">
          اختيار من المعرض
          <input
            type="file"
            multiple
            accept={GALLERY_UPLOAD_TYPES.join(",")}
            className="sr-only"
            disabled={pending}
            onChange={(event) =>
              upload(Array.from(event.currentTarget.files ?? []))
            }
          />
        </label>
      </div>
      {failed.length ? (
        <ul className="admin-image-mapping-failed">
          {failed.map((item) => (
            <li key={item.name}>
              <bdi>{item.name}</bdi>: {item.error}
            </li>
          ))}
          <li>
            <button
              type="button"
              className="admin-button-primary"
              disabled={pending}
              onClick={() => upload(failed.map((item) => item.file))}
            >
              إعادة المحاولة
            </button>
          </li>
        </ul>
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

      {images.length ? (
        <ul className="admin-image-mapping-list">
          {images.map((image, index) => (
            <li key={image.id} className="admin-image-mapping-card">
              <Image
                src={image.src}
                alt={image.alt || `صورة ${index + 1}`}
                width={image.width}
                height={image.height}
                sizes="160px"
              />
              <label htmlFor={`map-${image.id}`}>هذه الصورة تُظهر</label>
              <select
                id={`map-${image.id}`}
                value={imageTargetValue(image)}
                disabled={pending}
                onChange={(event) => map(image.id, event.target.value)}
              >
                <option value="unassigned">لم تُربط بعد</option>
                <option value="product">المنتج كله</option>
                {options.map((option) => (
                  <optgroup key={option.id} label={option.nameAr}>
                    {option.values.map((value) => (
                      <option key={value.id} value={`value:${value.id}`}>
                        {value.valueAr}
                      </option>
                    ))}
                  </optgroup>
                ))}
                {variants.length > 1 ? (
                  <optgroup label="صنف محدد">
                    {variants.map((variant) => (
                      <option key={variant.id} value={`variant:${variant.id}`}>
                        {variant.label}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
            </li>
          ))}
        </ul>
      ) : (
        <p className="admin-muted">لا توجد صور بعد.</p>
      )}

      {visualValues.length ? (
        <fieldset className="admin-image-mapping-shared">
          <legend>قيم بلا صورة خاصة</legend>
          {visualValues
            .filter((value) => !withPicture.has(value.id))
            .map((value) => (
              <label
                key={`${value.id}-${value.usesSharedImage}`}
                className="admin-choice"
              >
                <input
                  type="checkbox"
                  defaultChecked={value.usesSharedImage}
                  disabled={pending}
                  onChange={(event) => shared(value.id, event.target.checked)}
                />
                {value.option}: {value.valueAr} — أوافق على عرض صورة المنتج
                العامة لها
              </label>
            ))}
        </fieldset>
      ) : null}
    </section>
  );
}
