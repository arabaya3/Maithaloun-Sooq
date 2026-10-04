"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

import {
  createOptionAction,
  galleryImageAction,
  generateMissingVariantsAction,
  optionAction,
  optionValueAction,
  reorderGalleryAction,
  variantOptionsAction,
  type MediaActionResult,
} from "@/features/admin/application/product-media-actions";
import type { ProductMatrix } from "@/features/admin/application/product-options-service";
import {
  optionKindLabels,
  optionKinds,
  selectionLabel,
} from "@/features/catalog/domain/product-options";
import {
  GALLERY_UPLOAD_TYPES,
  galleryFileProblem,
  galleryUploadMessages,
} from "@/features/admin/domain/gallery-upload-limits";
import { formatIls } from "@/shared/lib/format-currency";

async function postGalleryImage(
  productDomainId: string,
  file: File,
  alt: string,
): Promise<MediaActionResult> {
  try {
    const response = await fetch(
      `/admin/api/products/${encodeURIComponent(productDomainId)}/images?alt=${encodeURIComponent(alt)}`,
      { method: "POST", body: file, headers: { "Content-Type": file.type } },
    );
    const body = (await response.json().catch(() => null)) as {
      ok?: boolean;
      message?: string;
    } | null;
    if (response.ok && body?.ok) return { ok: true };
    return {
      ok: false,
      message: body?.message ?? galleryUploadMessages.failed,
    };
  } catch {
    return { ok: false, message: galleryUploadMessages.failed };
  }
}

export function ProductMediaEditor({
  matrix,
  storefrontHref,
}: {
  matrix: ProductMatrix;
  storefrontHref: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);
  const domainId = matrix.product.domainId;
  const activeImages = matrix.images.filter((image) => !image.archived);
  const archivedImages = matrix.images.filter((image) => image.archived);
  const liveOptions = matrix.options.filter((option) => !option.archived);
  const activeVariants = matrix.variants.filter((variant) => !variant.archived);

  function act(task: () => Promise<MediaActionResult>, success: string) {
    startTransition(async () => {
      // A thrown action must never reach the admin error boundary and replace the page.
      const result = await task().catch((): MediaActionResult => ({
        ok: false,
        message: "تعذّر الحفظ. حاول مرة أخرى.",
      }));
      setMessage(
        result.ok
          ? { tone: "ok", text: success }
          : { tone: "error", text: result.message },
      );
      if (result.ok) router.refresh();
    });
  }

  function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const files = data
      .getAll("images")
      .filter((item): item is File => item instanceof File && item.size > 0)
      .slice(0, 8 - activeImages.length);
    if (!files.length) {
      setMessage({ tone: "error", text: "اختر صورة واحدة على الأقل." });
      return;
    }
    for (const file of files) {
      const problem = galleryFileProblem(file);
      if (problem) {
        setMessage({ tone: "error", text: `${file.name}: ${problem}` });
        return;
      }
    }
    const alt = String(data.get("alt") ?? "");
    act(
      async () => {
        for (const file of files) {
          const result = await postGalleryImage(domainId, file, alt);
          if (!result.ok) {
            router.refresh();
            return { ok: false, message: `${file.name}: ${result.message}` };
          }
        }
        form.reset();
        return { ok: true };
      },
      files.length === 1 ? "تمت إضافة الصورة." : "تمت إضافة الصور.",
    );
  }

  function move(index: number, delta: number) {
    const ids = activeImages.map((image) => image.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    act(() => reorderGalleryAction(domainId, ids), "تم تغيير ترتيب الصور.");
  }

  function addOption(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    act(async () => {
      const result = await createOptionAction({
        productDomainId: domainId,
        nameAr: String(data.get("nameAr") ?? ""),
        kind: String(data.get("kind") ?? "other"),
        values: String(data.get("values") ?? ""),
      });
      if (result.ok) form.reset();
      return result;
    }, "تمت إضافة الخيار.");
  }

  return (
    <section
      className="admin-media-editor"
      aria-labelledby="media-editor-title"
    >
      <h2 id="media-editor-title">الصور والخيارات والأصناف</h2>
      <p className="admin-muted">
        <a href={storefrontHref} target="_blank" rel="noreferrer">
          معاينة صفحة المنتج في المتجر
        </a>
      </p>
      {message ? (
        <p
          className="admin-media-message"
          data-tone={message.tone}
          role={message.tone === "error" ? "alert" : "status"}
        >
          {message.text}
        </p>
      ) : null}

      <details className="admin-media-section" open>
        <summary>الصور ({activeImages.length} من 8)</summary>
        <ol className="admin-gallery-list">
          {activeImages.map((image, index) => (
            <li key={image.id} className="admin-gallery-item">
              {/* eslint-disable-next-line @next/next/no-img-element -- admin thumbnail of a public catalog image */}
              <img src={image.src} alt={image.alt} width={72} height={72} />
              <div className="admin-gallery-fields">
                {image.isPrimary ? (
                  <span className="admin-badge">الصورة الرئيسية</span>
                ) : null}
                <label>
                  <span>الوصف البديل</span>
                  <input
                    defaultValue={image.alt}
                    maxLength={250}
                    onBlur={(event) => {
                      if (
                        event.target.value.trim() &&
                        event.target.value !== image.alt
                      ) {
                        act(
                          () =>
                            galleryImageAction({
                              productDomainId: domainId,
                              imageId: image.id,
                              action: "alt",
                              alt: event.target.value,
                            }),
                          "تم حفظ الوصف.",
                        );
                      }
                    }}
                  />
                </label>
                <label>
                  <span>تخص الصنف</span>
                  <select
                    value={image.variantId ?? ""}
                    onChange={(event) =>
                      act(
                        () =>
                          galleryImageAction({
                            productDomainId: domainId,
                            imageId: image.id,
                            action: "assign",
                            variantDomainId: event.target.value || null,
                          }),
                        "تم ربط الصورة.",
                      )
                    }
                  >
                    <option value="">كل الأصناف</option>
                    {activeVariants.map((variant) => (
                      <option key={variant.id} value={variant.id}>
                        {variant.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="admin-row-actions">
                  <button
                    type="button"
                    disabled={pending || index === 0}
                    onClick={() => move(index, -1)}
                  >
                    تقديم
                  </button>
                  <button
                    type="button"
                    disabled={pending || index === activeImages.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    تأخير
                  </button>
                  {image.isPrimary ? null : (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        act(
                          () =>
                            galleryImageAction({
                              productDomainId: domainId,
                              imageId: image.id,
                              action: "primary",
                            }),
                          "أصبحت الصورة رئيسية.",
                        )
                      }
                    >
                      اجعلها رئيسية
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      act(
                        () =>
                          galleryImageAction({
                            productDomainId: domainId,
                            imageId: image.id,
                            action: "archive",
                          }),
                        "تمت أرشفة الصورة.",
                      )
                    }
                  >
                    أرشفة
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ol>
        {activeImages.length < 8 ? (
          <form className="admin-form admin-media-form" onSubmit={upload}>
            <label>
              <span>إضافة صور (JPEG أو PNG أو WebP)</span>
              <input
                type="file"
                name="images"
                accept={GALLERY_UPLOAD_TYPES.join(",")}
                multiple
                required
                aria-describedby="gallery-upload-limit"
              />
              <small id="gallery-upload-limit" className="admin-muted">
                حتى 8 ميغابايت للصورة.
              </small>
            </label>
            <label>
              <span>وصف بديل للصور الجديدة</span>
              <input
                name="alt"
                maxLength={250}
                defaultValue={matrix.product.nameAr}
              />
            </label>
            <button type="submit" className="admin-btn" disabled={pending}>
              رفع الصور
            </button>
          </form>
        ) : null}
        {archivedImages.length ? (
          <details>
            <summary>صور مؤرشفة ({archivedImages.length})</summary>
            <ul className="admin-gallery-list">
              {archivedImages.map((image) => (
                <li key={image.id} className="admin-gallery-item">
                  {/* eslint-disable-next-line @next/next/no-img-element -- admin thumbnail of a public catalog image */}
                  <img src={image.src} alt={image.alt} width={56} height={56} />
                  <div className="admin-row-actions">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        act(
                          () =>
                            galleryImageAction({
                              productDomainId: domainId,
                              imageId: image.id,
                              action: "restore",
                            }),
                          "تمت استعادة الصورة.",
                        )
                      }
                    >
                      استعادة
                    </button>
                    <button
                      type="button"
                      className="admin-danger-link"
                      disabled={pending}
                      onClick={() => {
                        if (
                          window.confirm("حذف الصورة نهائياً؟ لا يمكن التراجع.")
                        ) {
                          act(
                            () =>
                              galleryImageAction({
                                productDomainId: domainId,
                                imageId: image.id,
                                action: "delete",
                              }),
                            "تم حذف الصورة نهائياً.",
                          );
                        }
                      }}
                    >
                      حذف نهائي
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </details>

      <details className="admin-media-section" open={liveOptions.length > 0}>
        <summary>الخيارات ({liveOptions.length})</summary>
        <ul className="admin-option-list">
          {matrix.options.map((option) => (
            <li
              key={option.id}
              className="admin-option-card"
              data-archived={option.archived}
            >
              <div className="admin-option-head">
                <strong>{option.nameAr}</strong>
                <span className="admin-muted">
                  {optionKindLabels[option.kind]}
                </span>
                {option.archived ? (
                  <span className="admin-badge">مؤرشف</span>
                ) : null}
              </div>
              <ul className="admin-chip-list">
                {option.values.map((value) => (
                  <li key={value.id}>
                    <span>{value.valueAr}</span>
                    <button
                      type="button"
                      aria-label={`أرشفة ${value.valueAr}`}
                      disabled={pending}
                      onClick={() =>
                        act(
                          () =>
                            optionValueAction({
                              productDomainId: domainId,
                              valueId: value.id,
                              action: "archive",
                            }),
                          "تمت أرشفة القيمة.",
                        )
                      }
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
              {option.archivedValues.length ? (
                <p className="admin-muted">
                  قيم مؤرشفة: {option.archivedValues.length}
                </p>
              ) : null}
              <form
                className="admin-inline-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  const text = String(new FormData(form).get("value") ?? "");
                  act(async () => {
                    const result = await optionAction({
                      productDomainId: domainId,
                      optionId: option.id,
                      action: "addValue",
                      text,
                    });
                    if (result.ok) form.reset();
                    return result;
                  }, "تمت إضافة القيمة.");
                }}
              >
                <label>
                  <span className="sr-only">قيمة جديدة لـ {option.nameAr}</span>
                  <input
                    name="value"
                    maxLength={60}
                    placeholder={`قيمة جديدة لـ ${option.nameAr}`}
                    required
                  />
                </label>
                <button type="submit" disabled={pending}>
                  إضافة
                </button>
              </form>
              <div className="admin-row-actions">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    act(
                      () =>
                        optionAction({
                          productDomainId: domainId,
                          optionId: option.id,
                          action: option.archived ? "restore" : "archive",
                        }),
                      option.archived
                        ? "تمت استعادة الخيار."
                        : "تمت أرشفة الخيار.",
                    )
                  }
                >
                  {option.archived ? "استعادة الخيار" : "أرشفة الخيار"}
                </button>
              </div>
            </li>
          ))}
        </ul>
        <form className="admin-form admin-media-form" onSubmit={addOption}>
          <label>
            <span>اسم الخيار</span>
            <input
              name="nameAr"
              maxLength={40}
              placeholder="الرائحة"
              required
            />
          </label>
          <label>
            <span>نوعه</span>
            <select name="kind" defaultValue="fragrance">
              {optionKinds.map((kind) => (
                <option key={kind} value={kind}>
                  {optionKindLabels[kind]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>القيم، مفصولة بفاصلة</span>
            <input name="values" placeholder="لافندر، ورد أبيض، مسك" />
          </label>
          <button type="submit" className="admin-btn" disabled={pending}>
            إضافة خيار
          </button>
        </form>
      </details>

      {liveOptions.length ? (
        <details className="admin-media-section" open>
          <summary>الأصناف حسب الخيارات ({activeVariants.length})</summary>
          {matrix.duplicates.length ? (
            <p className="admin-media-message" data-tone="error" role="alert">
              أصناف مكررة بنفس الاختيارات: {matrix.duplicates.length}
            </p>
          ) : null}
          {matrix.incomplete.length ? (
            <p className="admin-media-message" data-tone="error">
              أصناف ينقصها اختيار: {matrix.incomplete.length}. اختر قيمة لكل
              خيار ثم احفظ.
            </p>
          ) : null}
          <ul className="admin-variant-cards">
            {activeVariants.map((variant) => (
              <li key={variant.id} className="admin-variant-card">
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const data = new FormData(event.currentTarget);
                    const selection = Object.fromEntries(
                      liveOptions
                        .map((option) => [
                          option.id,
                          String(data.get(`option-${option.id}`) ?? ""),
                        ])
                        .filter(([, value]) => value),
                    );
                    act(
                      () =>
                        variantOptionsAction({
                          productDomainId: domainId,
                          variantDomainId: variant.id,
                          selection,
                          packCount: String(data.get("packCount") ?? ""),
                        }),
                      "تم حفظ اختيارات الصنف.",
                    );
                  }}
                >
                  <p className="admin-variant-title">
                    <strong>{variant.label}</strong>
                    {variant.isDefault ? (
                      <span className="admin-badge">الافتراضي</span>
                    ) : null}
                  </p>
                  <p className="admin-muted">
                    {formatIls(variant.priceAgorot)} ·{" "}
                    {variant.availability === "available"
                      ? "متوفر"
                      : "غير متوفر"}{" "}
                    · المخزون {variant.onHandMilli / 1000}
                  </p>
                  {liveOptions.map((option) => (
                    <label key={option.id}>
                      <span>{option.nameAr}</span>
                      <select
                        name={`option-${option.id}`}
                        defaultValue={variant.optionValues[option.id] ?? ""}
                      >
                        <option value="">— اختر —</option>
                        {option.values.map((value) => (
                          <option key={value.id} value={value.id}>
                            {value.valueAr}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                  <label>
                    <span>عدد القطع في العبوة (اختياري)</span>
                    <input
                      name="packCount"
                      inputMode="numeric"
                      defaultValue={variant.packCount ?? ""}
                    />
                  </label>
                  <button type="submit" disabled={pending}>
                    حفظ الصنف
                  </button>
                </form>
              </li>
            ))}
          </ul>
          {matrix.missing === null ? (
            <p className="admin-muted">
              عدد التركيبات الممكنة كبير جداً؛ أضف الأصناف واحداً واحداً.
            </p>
          ) : matrix.missing.length ? (
            <form
              className="admin-form admin-media-form"
              onSubmit={(event) => {
                event.preventDefault();
                const priceIls = String(
                  new FormData(event.currentTarget).get("priceIls") ?? "",
                );
                act(
                  () =>
                    generateMissingVariantsAction({
                      productDomainId: domainId,
                      combinations: matrix.missing!.map((row) => ({ ...row })),
                      priceIls,
                    }),
                  "تمت إضافة الأصناف الناقصة.",
                );
              }}
            >
              <p>
                تركيبات غير موجودة ({matrix.missing.length}):{" "}
                {matrix.missing
                  .map((row) => selectionLabel(liveOptions, row))
                  .join("، ")}
              </p>
              <label>
                <span>سعر الأصناف الجديدة</span>
                <input name="priceIls" placeholder="10 شيكل" required />
              </label>
              <button type="submit" className="admin-btn" disabled={pending}>
                إنشاء الأصناف الناقصة
              </button>
            </form>
          ) : (
            <p className="admin-muted">كل التركيبات موجودة.</p>
          )}
        </details>
      ) : null}
    </section>
  );
}
