"use client";

import { Camera, Plus, Star, Trash2, Undo2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import {
  removeSimpleImageAction,
  reorderSimpleImagesAction,
  saveSimpleProductAction,
  setSimplePublicationAction,
} from "@/features/admin/application/simple-product-actions";
import {
  galleryFileProblem,
  galleryUploadMessages,
} from "@/features/admin/domain/gallery-upload-limits";
import {
  simpleKindLabels,
  type SimpleKind,
} from "@/features/admin/domain/simple-product";
import { CategoryOptions } from "@/features/admin/ui/admin-categories";
import { MAX_PRODUCT_IMAGES } from "@/features/catalog/domain/product-gallery";

export interface SimpleImage {
  id: string;
  src: string;
  alt: string;
}

export interface SimpleRow {
  key: string;
  variantId: string | null;
  valueId: string | null;
  label: string;
  priceIls: string;
  available: boolean;
  /** Pieces on hand now, or null when stock was never recorded. */
  onHand: number | null;
  images: SimpleImage[];
}

export interface SimpleProductInitial {
  productId: string | null;
  nameAr: string;
  categoryId: string;
  description: string;
  kind: SimpleKind;
  optionName: string;
  rows: SimpleRow[];
  generalImages: SimpleImage[];
  published: boolean;
}

type EditRow = SimpleRow & {
  stock: string;
  cost: string;
  pending: File[];
};

let keySeed = 0;
const newKey = () => `new-${Date.now().toString(36)}-${keySeed++}`;

const emptyRow = (priceIls = ""): EditRow => ({
  key: newKey(),
  variantId: null,
  valueId: null,
  label: "",
  priceIls,
  available: true,
  onHand: null,
  images: [],
  stock: "",
  cost: "",
  pending: [],
});

const toEdit = (row: SimpleRow): EditRow => ({
  ...row,
  stock: "",
  cost: "",
  pending: [],
});

async function uploadImage(productId: string, file: File, target: string) {
  try {
    const response = await fetch(
      `/admin/api/products/${encodeURIComponent(productId)}/images?alt=${encodeURIComponent(file.name.replace(/\.[^.]+$/, "").slice(0, 200))}&target=${encodeURIComponent(target)}`,
      { method: "POST", body: file, headers: { "Content-Type": file.type } },
    );
    const body = (await response.json().catch(() => null)) as {
      ok?: boolean;
      message?: string;
    } | null;
    return response.ok && body?.ok
      ? null
      : (body?.message ?? galleryUploadMessages.failed);
  } catch {
    return galleryUploadMessages.failed;
  }
}

function PendingPhoto({
  file,
  onRemove,
  disabled,
}: {
  file: File;
  onRemove: () => void;
  disabled: boolean;
}) {
  const image = useRef<HTMLImageElement>(null);
  // Created and revoked by the same effect, so a remount never shows a revoked address.
  useEffect(() => {
    const url = URL.createObjectURL(file);
    if (image.current) image.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (
    <figure className="sp-photo" data-pending="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={image} alt="صورة جديدة لم تُحفظ بعد" />
      <button
        type="button"
        className="sp-photo-remove"
        aria-label="إزالة الصورة الجديدة"
        onClick={onRemove}
        disabled={disabled}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </figure>
  );
}

/** A row of small photos with an "add photo" button; new photos wait in the browser until saving. */
function PhotoStrip({
  label,
  images,
  pending,
  onAdd,
  onRemovePending,
  onDelete,
  onMakeFirst,
  disabled,
}: {
  label: string;
  images: SimpleImage[];
  pending: File[];
  onAdd: (files: File[]) => void;
  onRemovePending: (index: number) => void;
  onDelete: (image: SimpleImage) => void;
  onMakeFirst: (image: SimpleImage) => void;
  disabled: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);

  return (
    <div className="sp-photos">
      {images.map((image, index) => (
        <figure
          key={image.id}
          className="sp-photo"
          data-first={index === 0 ? "true" : undefined}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image.src} alt={image.alt} />
          {index > 0 ? (
            <button
              type="button"
              className="sp-photo-first"
              aria-label={`اجعلها الصورة الأولى لـ ${label}`}
              title="اجعلها الصورة الأولى"
              onClick={() => onMakeFirst(image)}
              disabled={disabled}
            >
              <Star size={14} aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            className="sp-photo-remove"
            aria-label={`حذف صورة ${label}`}
            onClick={() => onDelete(image)}
            disabled={disabled}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </figure>
      ))}
      {pending.map((file, index) => (
        <PendingPhoto
          key={`${file.name}-${file.lastModified}-${index}`}
          file={file}
          onRemove={() => onRemovePending(index)}
          disabled={disabled}
        />
      ))}
      <button
        type="button"
        className="sp-photo-add"
        onClick={() => input.current?.click()}
        disabled={disabled}
      >
        <Camera size={20} aria-hidden="true" />
        <span>صورة</span>
      </button>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        hidden
        aria-label={`صور ${label}`}
        onChange={(event) => {
          onAdd(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
    </div>
  );
}

export function SimpleProductEditor({
  initial,
  canStock,
  lockedMessage,
}: {
  initial: SimpleProductInitial;
  canStock: boolean;
  /** Set when the product's setup is too advanced for this editor's list of types. */
  lockedMessage?: string;
}) {
  const router = useRouter();
  const [nameAr, setNameAr] = useState(initial.nameAr);
  const [categoryId, setCategoryId] = useState(initial.categoryId);
  const [description, setDescription] = useState(initial.description);
  const [kind, setKind] = useState<SimpleKind>(initial.kind);
  const [optionName, setOptionName] = useState(initial.optionName);
  const [rows, setRows] = useState<EditRow[]>(() =>
    initial.rows.length ? initial.rows.map(toEdit) : [emptyRow()],
  );
  const [general, setGeneral] = useState(initial.generalImages);
  const [generalPending, setGeneralPending] = useState<File[]>([]);
  const [message, setMessage] = useState<{
    tone: "ok" | "error" | "warning";
    text: string;
  } | null>(null);
  const [badRow, setBadRow] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, startBusy] = useTransition();
  const [step, setStep] = useState("");

  useEffect(() => {
    if (!dirty || busy) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy]);

  const multi = kind !== "single";
  const visibleRows = multi ? rows : rows.slice(0, 1);
  const words = multi ? simpleKindLabels[kind] : null;
  const imageCount =
    general.length +
    generalPending.length +
    visibleRows.reduce(
      (sum, row) => sum + row.images.length + row.pending.length,
      0,
    );

  function change(update: () => void) {
    update();
    setDirty(true);
    setMessage(null);
  }

  function updateRow(key: string, patch: Partial<EditRow>) {
    change(() =>
      setRows((current) =>
        current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
      ),
    );
  }

  function addFiles(files: File[], apply: (accepted: File[]) => void) {
    const accepted: File[] = [];
    for (const file of files) {
      const problem = galleryFileProblem(file);
      if (problem) {
        setMessage({ tone: "error", text: problem });
        continue;
      }
      accepted.push(file);
    }
    const room = MAX_PRODUCT_IMAGES - imageCount;
    if (accepted.length > room) {
      setMessage({
        tone: "error",
        text: `المنتج الواحد يحمل ${MAX_PRODUCT_IMAGES} صور كحد أقصى.`,
      });
    }
    if (room > 0 && accepted.length) {
      apply(accepted.slice(0, room));
      setDirty(true);
    }
  }

  function deleteSaved(image: SimpleImage, after: () => void) {
    if (!initial.productId) return;
    if (!window.confirm("حذف هذه الصورة نهائياً؟")) return;
    startBusy(async () => {
      const result = await removeSimpleImageAction({
        productId: initial.productId!,
        imageId: image.id,
      });
      if (result.ok) after();
      else setMessage({ tone: "error", text: result.message });
    });
  }

  /** Moves one saved photo to the front of its own list, then saves the whole gallery order. */
  function makeFirst(image: SimpleImage, rowKey: string | null) {
    if (!initial.productId) return;
    const front = (list: SimpleImage[]) => [
      image,
      ...list.filter((item) => item.id !== image.id),
    ];
    const nextGeneral = rowKey === null ? front(general) : general;
    const nextRows = rows.map((row) =>
      row.key === rowKey ? { ...row, images: front(row.images) } : row,
    );
    const order = [
      ...nextGeneral,
      ...nextRows.flatMap((row) => row.images),
    ].map((item) => item.id);
    startBusy(async () => {
      const result = await reorderSimpleImagesAction({
        productId: initial.productId!,
        imageIds: order,
      });
      if (!result.ok) {
        setMessage({ tone: "error", text: result.message });
        return;
      }
      setGeneral(nextGeneral);
      setRows(nextRows);
    });
  }

  function discard() {
    if (!window.confirm("تجاهل كل التغييرات غير المحفوظة؟")) return;
    setNameAr(initial.nameAr);
    setCategoryId(initial.categoryId);
    setDescription(initial.description);
    setKind(initial.kind);
    setOptionName(initial.optionName);
    setRows(initial.rows.length ? initial.rows.map(toEdit) : [emptyRow()]);
    setGeneralPending([]);
    setMessage(null);
    setBadRow(null);
    setDirty(false);
  }

  function save(publish: boolean | null) {
    setMessage(null);
    setBadRow(null);
    startBusy(async () => {
      setStep("جارٍ الحفظ…");
      const result = await saveSimpleProductAction({
        productId: initial.productId,
        nameAr,
        categoryId,
        description,
        kind,
        optionName,
        rows: visibleRows.map((row) => ({
          key: row.key,
          variantId: row.variantId,
          valueId: row.valueId,
          label: row.label,
          priceIls: row.priceIls,
          stockPieces: canStock ? row.stock : "",
          costIls: row.cost,
          available: row.available,
          hasPhotos: row.images.length + row.pending.length > 0,
        })),
      });
      if (!result.ok) {
        setStep("");
        setBadRow(result.rowKey ?? null);
        setMessage({ tone: "error", text: result.message });
        if (result.productId && !initial.productId)
          router.replace(`/admin/products/${result.productId}?saved=partial`);
        return;
      }
      const productId = result.productId;
      const problems: string[] = [];
      const uploads: Array<[File, string]> = [];
      for (const row of visibleRows) {
        const saved = result.rows.find((item) => item.key === row.key);
        const target = saved?.valueId ? `value:${saved.valueId}` : "product";
        for (const file of row.pending) uploads.push([file, target]);
      }
      for (const file of generalPending) uploads.push([file, "product"]);
      for (const [index, [file, target]] of uploads.entries()) {
        setStep(`جارٍ رفع الصور ${index + 1} من ${uploads.length}…`);
        const problem = await uploadImage(productId, file, target);
        if (problem) problems.push(problem);
      }
      if (result.warning) problems.push(result.warning);
      if (publish !== null && !problems.length) {
        setStep(publish ? "جارٍ النشر…" : "جارٍ الإخفاء…");
        const published = await setSimplePublicationAction({
          productId,
          publish,
        });
        if (!published.ok) problems.push(published.message);
      }
      setStep("");
      setDirty(false);
      if (!initial.productId) {
        const note = problems.length ? "&saved=partial" : "&saved=ok";
        router.replace(`/admin/products/${productId}?${note.slice(1)}`);
        return;
      }
      setRows((current) => current.map((row) => ({ ...row, pending: [] })));
      setGeneralPending([]);
      setMessage(
        problems.length
          ? { tone: "warning", text: problems.join(" ") }
          : {
              tone: "ok",
              text:
                publish === true
                  ? "تم الحفظ والنشر. المنتج ظاهر للزبائن الآن."
                  : publish === false
                    ? "تم الحفظ، والمنتج مخفي عن الزبائن."
                    : "تم الحفظ.",
            },
      );
      router.refresh();
    });
  }

  return (
    <form
      className="sp-editor"
      onSubmit={(event) => {
        event.preventDefault();
        save(null);
      }}
      noValidate
    >
      {/* 1 — Name and category */}
      <section className="sp-card" aria-labelledby="sp-basic">
        <h2 id="sp-basic" className="sp-card-title">
          <span className="sp-num" aria-hidden="true">
            1
          </span>
          اسم المنتج
        </h2>
        <label className="sp-field">
          <span>الاسم</span>
          <input
            value={nameAr}
            onChange={(event) => change(() => setNameAr(event.target.value))}
            maxLength={160}
            placeholder="مثل: معطّر أرضيات"
            autoComplete="off"
            required
          />
        </label>
        <label className="sp-field">
          <span>القسم</span>
          <select
            value={categoryId}
            onChange={(event) =>
              change(() => setCategoryId(event.target.value))
            }
            required
          >
            <option value="" disabled>
              اختاري القسم
            </option>
            <CategoryOptions />
          </select>
        </label>
        <details className="sp-more" open={Boolean(initial.description)}>
          <summary>وصف قصير (اختياري)</summary>
          <textarea
            value={description}
            onChange={(event) =>
              change(() => setDescription(event.target.value))
            }
            rows={3}
            maxLength={4000}
            aria-label="وصف المنتج"
          />
        </details>
      </section>

      {/* 2 — Types, each with its own photos, price and quantity */}
      <section className="sp-card" aria-labelledby="sp-types">
        <h2 id="sp-types" className="sp-card-title">
          <span className="sp-num" aria-hidden="true">
            2
          </span>
          الأنواع والصور والأسعار
        </h2>
        {lockedMessage ? (
          <p className="sp-note" data-tone="warning">
            {lockedMessage}
          </p>
        ) : (
          <>
            <fieldset className="sp-kind">
              <legend>هل للمنتج أكثر من نوع؟</legend>
              <div className="sp-kind-options">
                {(
                  [
                    ["single", "نوع واحد"],
                    ["fragrance", "روائح"],
                    ["size", "أحجام"],
                    ["color", "ألوان"],
                    ["other", "غير ذلك"],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value} className="sp-chip">
                    <input
                      type="radio"
                      name="sp-kind"
                      value={value}
                      checked={kind === value}
                      onChange={() =>
                        change(() => {
                          setKind(value);
                          if (
                            value !== "single" &&
                            rows.length === 1 &&
                            !rows[0]!.label
                          ) {
                            setRows([rows[0]!, emptyRow(rows[0]!.priceIls)]);
                          }
                        })
                      }
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              {kind === "other" ? (
                <label className="sp-field sp-field-inline">
                  <span>ما الذي يختلف؟</span>
                  <input
                    value={optionName}
                    onChange={(event) =>
                      change(() => setOptionName(event.target.value))
                    }
                    maxLength={40}
                    placeholder="مثل: الشكل"
                  />
                </label>
              ) : null}
            </fieldset>

            {multi ? (
              <p className="sp-hint">
                اكتبي كل {words!.one} في سطر، وأضيفي صورته وسعره. الزبون يختار{" "}
                {words!.one} فتظهر صورته.
              </p>
            ) : null}

            <ol className="sp-rows">
              {visibleRows.map((row, index) => (
                <li
                  key={row.key}
                  className="sp-row"
                  data-invalid={badRow === row.key ? "true" : undefined}
                >
                  {multi ? (
                    <div className="sp-row-head">
                      <label className="sp-field sp-row-name">
                        <span>
                          {words!.one} {index + 1}
                        </span>
                        <input
                          value={row.label}
                          onChange={(event) =>
                            updateRow(row.key, { label: event.target.value })
                          }
                          maxLength={60}
                          placeholder={words!.example}
                          autoComplete="off"
                        />
                      </label>
                      {visibleRows.length > 1 ? (
                        <button
                          type="button"
                          className="sp-icon-btn"
                          aria-label={`حذف ${row.label || words!.one}`}
                          disabled={busy}
                          onClick={() => {
                            if (
                              row.variantId &&
                              !window.confirm(
                                `حذف «${row.label}» من المنتج؟ يُطبَّق عند الحفظ.`,
                              )
                            )
                              return;
                            change(() =>
                              setRows((current) =>
                                current.filter((item) => item.key !== row.key),
                              ),
                            );
                          }}
                        >
                          <Trash2 size={18} aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  ) : null}

                  <PhotoStrip
                    label={row.label || nameAr || "المنتج"}
                    images={row.images}
                    pending={row.pending}
                    disabled={busy}
                    onAdd={(files) =>
                      addFiles(files, (accepted) =>
                        setRows((current) =>
                          current.map((item) =>
                            item.key === row.key
                              ? {
                                  ...item,
                                  pending: [...item.pending, ...accepted],
                                }
                              : item,
                          ),
                        ),
                      )
                    }
                    onRemovePending={(at) =>
                      updateRow(row.key, {
                        pending: row.pending.filter((_, i) => i !== at),
                      })
                    }
                    onMakeFirst={(image) => makeFirst(image, row.key)}
                    onDelete={(image) =>
                      deleteSaved(image, () =>
                        setRows((current) =>
                          current.map((item) =>
                            item.key === row.key
                              ? {
                                  ...item,
                                  images: item.images.filter(
                                    (saved) => saved.id !== image.id,
                                  ),
                                }
                              : item,
                          ),
                        ),
                      )
                    }
                  />

                  <div className="sp-row-numbers">
                    <label className="sp-field">
                      <span>السعر ₪</span>
                      <input
                        value={row.priceIls}
                        onChange={(event) =>
                          updateRow(row.key, { priceIls: event.target.value })
                        }
                        inputMode="decimal"
                        dir="ltr"
                        placeholder="12.50"
                      />
                    </label>
                    {canStock ? (
                      <label className="sp-field">
                        <span>
                          {row.onHand === null
                            ? "الكمية (اختياري)"
                            : `الكمية (الآن ${row.onHand})`}
                        </span>
                        <input
                          value={row.stock}
                          onChange={(event) =>
                            updateRow(row.key, { stock: event.target.value })
                          }
                          inputMode="numeric"
                          dir="ltr"
                          placeholder={
                            row.onHand === null ? "0" : String(row.onHand)
                          }
                        />
                      </label>
                    ) : null}
                    {canStock &&
                    row.onHand === null &&
                    Number(row.stock) > 0 ? (
                      <label className="sp-field">
                        <span>تكلفة القطعة ₪</span>
                        <input
                          value={row.cost}
                          onChange={(event) =>
                            updateRow(row.key, { cost: event.target.value })
                          }
                          inputMode="decimal"
                          dir="ltr"
                          placeholder="8"
                        />
                      </label>
                    ) : null}
                  </div>
                  <label className="sp-switch">
                    <input
                      type="checkbox"
                      checked={row.available}
                      onChange={(event) =>
                        updateRow(row.key, { available: event.target.checked })
                      }
                    />
                    <span>متوفر للبيع</span>
                  </label>
                </li>
              ))}
            </ol>

            {multi ? (
              <button
                type="button"
                className="admin-btn admin-btn-secondary sp-add"
                disabled={busy || rows.length >= 20}
                onClick={() =>
                  change(() =>
                    setRows((current) => [
                      ...current,
                      emptyRow(current.at(-1)?.priceIls ?? ""),
                    ]),
                  )
                }
              >
                <Plus size={18} aria-hidden="true" />
                {words!.add}
              </button>
            ) : null}
          </>
        )}

        {multi || general.length || generalPending.length ? (
          <details
            className="sp-more"
            open={Boolean(general.length || generalPending.length)}
          >
            <summary>صورة وحدة لكل الأنواع (اختياري)</summary>
            <p className="sp-muted">
              إذا العبوة نفسها لكل الأنواع، ارفعي صورتها هون مرة وحدة. أي نوع ما
              إله صورة خاصة بيظهر بهالصورة.
            </p>
            <PhotoStrip
              label="المنتج"
              images={general}
              pending={generalPending}
              disabled={busy}
              onAdd={(files) =>
                addFiles(files, (accepted) =>
                  setGeneralPending((current) => [...current, ...accepted]),
                )
              }
              onRemovePending={(at) =>
                change(() =>
                  setGeneralPending((current) =>
                    current.filter((_, i) => i !== at),
                  ),
                )
              }
              onMakeFirst={(image) => makeFirst(image, null)}
              onDelete={(image) =>
                deleteSaved(image, () =>
                  setGeneral((current) =>
                    current.filter((saved) => saved.id !== image.id),
                  ),
                )
              }
            />
          </details>
        ) : null}
        <p className="sp-muted">
          {imageCount} من {MAX_PRODUCT_IMAGES} صور
        </p>
      </section>

      {/* 3 — Save */}
      {message ? (
        <p
          className="sp-note"
          data-tone={message.tone}
          role={message.tone === "ok" ? "status" : "alert"}
        >
          {message.text}
        </p>
      ) : null}
      {step ? (
        <p className="sp-muted" role="status">
          {step}
        </p>
      ) : null}
      <div
        className="sp-actions admin-sticky-action"
        data-dirty={dirty ? "true" : undefined}
      >
        {dirty && !busy ? (
          <div className="sp-unsaved">
            <span className="sp-unsaved-dot" aria-hidden="true" />
            <span>تغييرات غير محفوظة</span>
            <button type="button" className="sp-unsaved-undo" onClick={discard}>
              <Undo2 size={16} aria-hidden="true" />
              تراجع
            </button>
          </div>
        ) : null}
        <div className="sp-actions-buttons">
          <button
            type="button"
            className="admin-btn admin-btn-primary"
            disabled={busy}
            onClick={() => save(initial.published ? null : true)}
          >
            {initial.published ? "حفظ" : "حفظ ونشر في المتجر"}
          </button>
          {initial.published ? (
            <button
              type="button"
              className="admin-btn admin-btn-ghost"
              disabled={busy}
              onClick={() => save(false)}
            >
              حفظ وإخفاء من المتجر
            </button>
          ) : (
            <button
              type="submit"
              className="admin-btn admin-btn-secondary"
              disabled={busy}
            >
              حفظ كمسودة
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
