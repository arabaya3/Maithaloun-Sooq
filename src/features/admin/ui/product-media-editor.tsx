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
  valueSharedImageAction,
  variantOptionsAction,
  defaultVariantAction,
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
import { imageTargetValue } from "@/features/admin/domain/image-target";
import {
  VISUAL_OPTION_KINDS,
  mappingMessages,
} from "@/features/catalog/domain/product-media-validation";
import { formatIls } from "@/shared/lib/format-currency";

async function postGalleryImage(
  productDomainId: string,
  file: File,
  alt: string,
  target: string,
): Promise<MediaActionResult> {
  try {
    const response = await fetch(
      `/admin/api/products/${encodeURIComponent(productDomainId)}/images?alt=${encodeURIComponent(alt)}&target=${encodeURIComponent(target)}`,
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
  const unassigned = activeImages.filter(
    (image) => image.scope === "unassigned",
  );
  const choices: MappingChoices = {
    options: liveOptions,
    variants: activeVariants,
  };

  const visualValues =
    activeVariants.length > 1
      ? liveOptions
          .filter((option) => VISUAL_OPTION_KINDS.has(option.kind))
          .flatMap((option) =>
            option.values
              .filter((value) =>
                activeVariants.some(
                  (variant) => variant.optionValues[option.id] === value.id,
                ),
              )
              .map((value) => ({ option, value })),
          )
      : [];
  const defaultUploadTarget = visualValues.length ? "unassigned" : "product";

  function valueDependents(valueId: string, valueAr: string): string | null {
    const variants = activeVariants.filter((variant) =>
      Object.values(variant.optionValues).includes(valueId),
    ).length;
    const pictures = activeImages.filter(
      (image) => image.optionValueId === valueId,
    ).length;
    if (!variants && !pictures) return null;
    return `لا يمكن إزالة «${valueAr}» الآن: مرتبطة بـ ${variants} أصناف و${pictures} صور. انقلها أولاً؛ الملفات لا تُحذف.`;
  }

  function saveTarget(imageId: string, target: string) {
    return new Promise<MediaActionResult>((resolve) => {
      startTransition(async () => {
        const result = await galleryImageAction({
          productDomainId: domainId,
          imageId,
          action: "scope",
          target,
        }).catch((): MediaActionResult => ({
          ok: false,
          message: "تعذّر الحفظ. حاول مرة أخرى.",
        }));
        setMessage(
          result.ok
            ? { tone: "ok", text: "تم ربط الصورة." }
            : { tone: "error", text: result.message },
        );
        if (result.ok) router.refresh();
        resolve(result);
      });
    });
  }

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
    const target = String(data.get("target") ?? defaultUploadTarget);
    act(
      async () => {
        for (const file of files) {
          const result = await postGalleryImage(domainId, file, alt, target);
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

      <details className="admin-media-section" open={liveOptions.length > 0}>
        <summary>١. الخيارات ({liveOptions.length})</summary>
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
                      onClick={() => {
                        const blocker = valueDependents(
                          value.id,
                          value.valueAr,
                        );
                        if (blocker) {
                          setMessage({ tone: "error", text: blocker });
                          return;
                        }
                        act(
                          () =>
                            optionValueAction({
                              productDomainId: domainId,
                              valueId: value.id,
                              action: "archive",
                            }),
                          "تمت أرشفة القيمة.",
                        );
                      }}
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
          <summary>٢. الأصناف حسب الخيارات ({activeVariants.length})</summary>
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
                    ) : (
                      <button
                        type="button"
                        className="admin-variant-default"
                        disabled={pending}
                        onClick={() =>
                          act(
                            () =>
                              defaultVariantAction({
                                productDomainId: domainId,
                                variantDomainId: variant.id,
                              }),
                            "أصبح هذا الصنف هو الذي يظهر أولاً للزبون.",
                          )
                        }
                      >
                        اجعليه الافتراضي
                      </button>
                    )}
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

      <details className="admin-media-section" open>
        <summary>٣. الصور ({activeImages.length} من 8)</summary>
        {unassigned.length ? (
          <section
            className="admin-unassigned"
            aria-labelledby="unassigned-title"
          >
            <h3 id="unassigned-title">غير مربوط ({unassigned.length})</h3>
            <p className="admin-muted">{mappingMessages.unassigned}</p>
            <ul className="admin-unassigned-list">
              {unassigned.map((image) => (
                <li key={image.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- admin thumbnail of a public catalog image */}
                  <img src={image.src} alt={image.alt} width={56} height={56} />
                  <ImageMappingField
                    key={`${image.id}:${imageTargetValue(image)}`}
                    image={image}
                    choices={choices}
                    pending={pending}
                    onSave={(target) => saveTarget(image.id, target)}
                  />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
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
                <ImageMappingField
                  key={`${image.id}:${imageTargetValue(image)}`}
                  image={image}
                  choices={choices}
                  pending={pending}
                  onSave={(target) => saveTarget(image.id, target)}
                />
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
                  {image.isPrimary || image.scope !== "product" ? null : (
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
              <span>الصور الجديدة تخص</span>
              <select
                key={defaultUploadTarget}
                name="target"
                defaultValue={defaultUploadTarget}
              >
                <TargetOptions choices={choices} />
              </select>
              <small className="admin-muted">
                يمكنك تغيير الربط لاحقاً بدون رفع الصورة من جديد.
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

      {visualValues.length || matrix.mapping.length ? (
        <details className="admin-media-section" open>
          <summary>٤. ملخص ربط الصور</summary>
          {matrix.mapping.length ? (
            <div
              className="admin-media-message admin-mapping-status"
              data-tone="error"
              role="note"
            >
              <p>
                <strong>{mappingMessages.blocked}</strong>
              </p>
              <p>يمكن حفظ المسودة الآن، لكن النشر يحتاج:</p>
              <ul>
                {[
                  ...new Set(matrix.mapping.map((problem) => problem.message)),
                ].map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p
              className="admin-media-message admin-mapping-status"
              data-tone="ok"
              role="note"
            >
              كل الصور مربوطة، ويمكن نشر المنتج.
            </p>
          )}
          <ul className="admin-mapping-summary">
            {visualValues.map(({ option, value }) => {
              const pictured = activeImages.filter(
                (image) =>
                  (image.scope === "option_value" &&
                    image.optionValueId === value.id) ||
                  (image.scope === "variant" &&
                    activeVariants.some(
                      (variant) =>
                        variant.id === image.variantId &&
                        variant.optionValues[option.id] === value.id,
                    )),
              );
              return (
                <li
                  key={value.id}
                  data-complete={pictured.length > 0 || value.usesSharedImage}
                >
                  <strong>
                    {option.nameAr}: {value.valueAr}
                  </strong>
                  {pictured.length ? (
                    <span className="admin-mapping-thumbs">
                      {pictured.map((image) => (
                        // eslint-disable-next-line @next/next/no-img-element -- admin thumbnail of a public catalog image
                        <img
                          key={image.id}
                          src={image.src}
                          alt={image.alt}
                          width={40}
                          height={40}
                        />
                      ))}
                    </span>
                  ) : (
                    <label className="admin-checkbox">
                      <input
                        type="checkbox"
                        checked={value.usesSharedImage}
                        disabled={pending}
                        onChange={(event) =>
                          act(
                            () =>
                              valueSharedImageAction({
                                productDomainId: domainId,
                                valueId: value.id,
                                usesSharedImage: event.target.checked,
                              }),
                            event.target.checked
                              ? "ستظهر الصورة العامة لهذه القيمة."
                              : "أُلغي استخدام الصورة العامة.",
                          )
                        }
                      />
                      <span>استخدام الصورة العامة للمنتج</span>
                    </label>
                  )}
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

type MappingChoices = {
  options: ProductMatrix["options"];
  variants: ProductMatrix["variants"];
};

function TargetOptions({ choices }: { choices: MappingChoices }) {
  return (
    <>
      <option value="unassigned">غير مربوط — اختر</option>
      <option value="product">صورة عامة للمنتج</option>
      {choices.options.map((option) => (
        <optgroup key={option.id} label={option.nameAr}>
          {option.values.map((value) => (
            <option key={value.id} value={`value:${value.id}`}>
              {option.nameAr}: {value.valueAr}
            </option>
          ))}
        </optgroup>
      ))}
      {choices.variants.length > 1 ? (
        <optgroup label="صنف محدد">
          {choices.variants.map((variant) => (
            <option key={variant.id} value={`variant:${variant.id}`}>
              {variant.label}
            </option>
          ))}
        </optgroup>
      ) : null}
    </>
  );
}

// The choice stays on screen when saving fails, so nothing has to be picked again.
function ImageMappingField({
  image,
  choices,
  pending,
  onSave,
}: {
  image: ProductMatrix["images"][number];
  choices: MappingChoices;
  pending: boolean;
  onSave: (target: string) => Promise<MediaActionResult>;
}) {
  const saved = imageTargetValue(image);
  const [choice, setChoice] = useState(saved);
  const [failed, setFailed] = useState(false);
  const known =
    saved === "product" ||
    saved === "unassigned" ||
    choices.options.some((option) =>
      option.values.some((value) => saved === `value:${value.id}`),
    ) ||
    choices.variants.some((variant) => saved === `variant:${variant.id}`);
  return (
    <label className="admin-mapping-field" data-state={saved}>
      <span>الصورة تخص</span>
      <select
        value={choice}
        disabled={pending}
        aria-invalid={failed || !known || saved === "unassigned"}
        onChange={async (event) => {
          const next = event.target.value;
          setChoice(next);
          const result = await onSave(next);
          setFailed(!result.ok);
        }}
      >
        {known ? null : <option value={saved}>{mappingMessages.stale}</option>}
        <TargetOptions choices={choices} />
      </select>
      {!known ? (
        <small className="admin-field-error">{mappingMessages.stale}</small>
      ) : saved === "unassigned" ? (
        <small className="admin-field-error">
          {mappingMessages.unassigned}
        </small>
      ) : null}
    </label>
  );
}
