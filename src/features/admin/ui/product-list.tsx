"use client";

import Link from "next/link";
import { ImageOff, LoaderCircle, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";

import { quickEditProductAction } from "@/features/admin/application/simple-product-actions";

import {
  bulkPublicationAction,
  moveProductsAction,
  restoreProductAction,
  type BulkPublicationResult,
  type CatalogActionResult,
} from "@/features/admin/application/catalog-management-actions";

export type ProductTone = "success" | "warning" | "danger" | "neutral";

export interface ProductListRow {
  id: string;
  name: string;
  category: string;
  price: string;
  variantCount: number;
  publication: "draft" | "published" | "hidden";
  available: boolean;
  flags: Array<{ id: string; label: string; tone: ProductTone }>;
  imageSrc?: string | null;
  /** Pieces on hand across all types; null when stock is not tracked, undefined when not shown. */
  stockPieces?: number | null;
  variants?: Array<{
    id: string;
    label: string;
    priceIls: string;
    onHand: number | null;
  }>;
}

function Thumb({ row }: { row: ProductListRow }) {
  return (
    <span className="admin-product-thumb" aria-hidden="true">
      {row.imageSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={row.imageSrc} alt="" loading="lazy" />
      ) : (
        <ImageOff size={18} />
      )}
    </span>
  );
}

const typesLabel = (count: number) =>
  count > 1 ? (count <= 10 ? `${count} أنواع` : `${count} نوعاً`) : "نوع واحد";

const stockLabel = (row: ProductListRow) =>
  row.stockPieces === undefined
    ? null
    : row.stockPieces === null
      ? "—"
      : `${row.stockPieces} قطعة`;

/** Price and stock of every type, edited in place without opening the product. */
function QuickEdit({
  row,
  canStock,
  onClose,
}: {
  row: ProductListRow;
  canStock: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [values, setValues] = useState(() =>
    (row.variants ?? []).map((variant) => ({
      ...variant,
      stock: variant.onHand === null ? "" : String(variant.onHand),
    })),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <form
      className="admin-quick-edit"
      aria-label={`تعديل سريع: ${row.name}`}
      onSubmit={(event) => {
        event.preventDefault();
        setMessage(null);
        start(async () => {
          const result = await quickEditProductAction({
            productId: row.id,
            variants: values.map((value) => ({
              variantId: value.id,
              priceIls: value.priceIls,
              stockPieces: canStock && value.onHand !== null ? value.stock : "",
            })),
          });
          if (!result.ok) {
            setMessage(result.message);
            return;
          }
          onClose();
          router.refresh();
        });
      }}
    >
      <ul>
        {values.map((value, index) => (
          <li key={value.id}>
            <span className="admin-quick-edit-label">
              <bdi>{value.label || "السعر"}</bdi>
            </span>
            <label>
              <span>السعر ₪</span>
              <input
                value={value.priceIls}
                inputMode="decimal"
                dir="ltr"
                onChange={(event) =>
                  setValues((current) =>
                    current.map((item, at) =>
                      at === index
                        ? { ...item, priceIls: event.target.value }
                        : item,
                    ),
                  )
                }
              />
            </label>
            {canStock && value.onHand !== null ? (
              <label>
                <span>الكمية</span>
                <input
                  value={value.stock}
                  inputMode="numeric"
                  dir="ltr"
                  onChange={(event) =>
                    setValues((current) =>
                      current.map((item, at) =>
                        at === index
                          ? { ...item, stock: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
              </label>
            ) : null}
          </li>
        ))}
      </ul>
      {message ? (
        <p className="admin-form-error" role="alert">
          {message}
        </p>
      ) : null}
      <div className="admin-quick-edit-actions">
        <button
          type="submit"
          className="admin-btn admin-btn-primary admin-btn-sm"
          disabled={busy}
        >
          {busy ? "جارٍ الحفظ…" : "حفظ"}
        </button>
        <button
          type="button"
          className="admin-btn admin-btn-ghost admin-btn-sm"
          onClick={onClose}
          disabled={busy}
        >
          إلغاء
        </button>
      </div>
    </form>
  );
}

const publicationLabels: Record<ProductListRow["publication"], string> = {
  published: "منشور",
  draft: "مسودة",
  hidden: "مخفي",
};
const publicationTones: Record<ProductListRow["publication"], ProductTone> = {
  published: "success",
  draft: "neutral",
  hidden: "warning",
};

function Chips({ row }: { row: ProductListRow }) {
  return (
    <span className="admin-chip-row">
      <span
        className="admin-chip"
        data-tone={publicationTones[row.publication]}
      >
        {publicationLabels[row.publication]}
      </span>
      {row.available ? null : (
        <span className="admin-chip" data-tone="warning">
          غير متاح
        </span>
      )}
      {row.flags.map((flag) => (
        <span key={flag.id} className="admin-chip" data-tone={flag.tone}>
          {flag.label}
        </span>
      ))}
    </span>
  );
}

function BulkResult({
  state,
  names,
}: {
  state: BulkPublicationResult;
  names: Map<string, string>;
}) {
  if (!state) return null;
  if (!state.ok) {
    return (
      <p className="admin-media-message" data-tone="error" role="alert">
        {state.message}
      </p>
    );
  }
  return (
    <div
      className="admin-media-message"
      data-tone={state.failed.length ? "warning" : "ok"}
      role="status"
    >
      {state.changed ? (
        <p>
          تم تحديث{" "}
          {state.changed === 1 ? "منتج واحد" : `${state.changed} منتجات`}.
        </p>
      ) : null}
      {state.failed.length ? (
        <>
          <p>
            لم يتغيّر{" "}
            {state.failed.length === 1
              ? "منتج واحد"
              : `${state.failed.length} منتجات`}
            :
          </p>
          <ul>
            {state.failed.map((item) => (
              <li key={item.domainId}>
                <Link
                  href={`/admin/products/${item.domainId}`}
                  prefetch={false}
                >
                  {names.get(item.domainId) ?? item.domainId}
                </Link>
                : {item.message}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

/** One tap on a phone card: hide a live product, or publish a hidden or draft one (the server re-checks). */
function QuickState({
  row,
  action,
  pending,
}: {
  row: ProductListRow;
  action: (formData: FormData) => void;
  pending: boolean;
}) {
  const next = row.publication === "published" ? "hidden" : "published";
  return (
    <form action={action} className="admin-quick-state">
      <input type="hidden" name="domainId" value={row.id} />
      <input type="hidden" name="publication" value={next} />
      <button
        type="submit"
        className="admin-btn admin-btn-secondary admin-btn-sm"
        disabled={pending}
        aria-label={`${next === "published" ? "نشر" : "إخفاء"} ${row.name}`}
      >
        {next === "published" ? "نشر" : "إخفاء"}
      </button>
    </form>
  );
}

export function ProductList({
  rows,
  canManage,
  canStock = false,
  categories = [],
}: {
  rows: ProductListRow[];
  canManage: boolean;
  canStock?: boolean;
  categories?: Array<{ code: string; nameAr: string }>;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const [moveMessage, setMoveMessage] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const [moving, startMove] = useTransition();
  const [state, action, pending] = useActionState(
    async (previous: BulkPublicationResult, formData: FormData) => {
      const result = await bulkPublicationAction(previous, formData);
      if (result?.ok) setSelected(new Set());
      return result;
    },
    null,
  );
  const names = new Map(rows.map((row) => [row.id, row.name]));
  const visibleSelected = rows.filter((row) => selected.has(row.id));
  const allSelected = rows.length > 0 && visibleSelected.length === rows.length;

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function moveSelected() {
    if (!target) return;
    setMoveMessage(null);
    startMove(async () => {
      const result = await moveProductsAction({
        productDomainIds: visibleSelected.map((row) => row.id),
        targetCode: target,
      });
      if (!result || !result.ok) {
        setMoveMessage({
          ok: false,
          text: result?.message ?? "تعذّر النقل.",
        });
        return;
      }
      setMoveMessage({
        ok: true,
        text:
          result.moved === 1
            ? "تم نقل منتج واحد."
            : `تم نقل ${result.moved} منتجات.`,
      });
      setSelected(new Set());
      setTarget("");
      router.refresh();
    });
  }

  const showStock = rows.some((row) => row.stockPieces !== undefined);

  return (
    <>
      <BulkResult state={state} names={names} />
      {moveMessage ? (
        <p
          className="admin-media-message"
          data-tone={moveMessage.ok ? "ok" : "error"}
          role={moveMessage.ok ? "status" : "alert"}
        >
          {moveMessage.text}
        </p>
      ) : null}

      <div className="admin-table-wrap admin-table-desktop">
        <table className="admin-data-table admin-product-table">
          <thead>
            <tr>
              {canManage ? (
                <th className="admin-select-cell">
                  <label className="admin-check">
                    <input
                      type="checkbox"
                      aria-label="تحديد كل المنتجات المعروضة"
                      checked={allSelected}
                      onChange={() =>
                        setSelected(
                          allSelected
                            ? new Set()
                            : new Set(rows.map((row) => row.id)),
                        )
                      }
                    />
                  </label>
                </th>
              ) : null}
              <th>المنتج</th>
              <th>القسم</th>
              <th>السعر</th>
              <th>الأنواع</th>
              {showStock ? <th>المخزون</th> : null}
              <th>الحالة</th>
              {canManage ? (
                <th>
                  <span className="sr-only">تعديل سريع</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                data-selected={selected.has(row.id) || undefined}
              >
                {canManage ? (
                  <td className="admin-select-cell">
                    <label className="admin-check">
                      <input
                        type="checkbox"
                        aria-label={`تحديد ${row.name}`}
                        checked={selected.has(row.id)}
                        onChange={() => toggle(row.id)}
                      />
                    </label>
                  </td>
                ) : null}
                <td>
                  <span className="admin-product-name-cell">
                    <Thumb row={row} />
                    <Link href={`/admin/products/${row.id}`} prefetch={false}>
                      <bdi>{row.name}</bdi>
                    </Link>
                  </span>
                  {editing === row.id ? (
                    <QuickEdit
                      row={row}
                      canStock={canStock}
                      onClose={() => setEditing(null)}
                    />
                  ) : null}
                </td>
                <td>{row.category}</td>
                <td className="admin-num">{row.price}</td>
                <td>{typesLabel(row.variantCount)}</td>
                {showStock ? (
                  <td className="admin-num">{stockLabel(row)}</td>
                ) : null}
                <td>
                  <Chips row={row} />
                </td>
                {canManage ? (
                  <td>
                    <button
                      type="button"
                      className="admin-btn admin-btn-ghost admin-btn-sm admin-quick-btn"
                      aria-label={`تعديل سريع: ${row.name}`}
                      aria-expanded={editing === row.id}
                      onClick={() =>
                        setEditing(editing === row.id ? null : row.id)
                      }
                    >
                      <Pencil size={16} aria-hidden="true" />
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="admin-product-cards">
        {rows.map((row) => (
          <li key={row.id}>
            <article
              className="admin-product-item"
              data-selected={selected.has(row.id) || undefined}
            >
              {canManage ? (
                <label className="admin-check">
                  <input
                    type="checkbox"
                    aria-label={`تحديد ${row.name}`}
                    checked={selected.has(row.id)}
                    onChange={() => toggle(row.id)}
                  />
                </label>
              ) : null}
              <div className="admin-product-item-main">
                <span className="admin-product-name-cell">
                  <Thumb row={row} />
                  <Link
                    href={`/admin/products/${row.id}`}
                    prefetch={false}
                    className="admin-product-item-title"
                  >
                    <bdi>{row.name}</bdi>
                  </Link>
                </span>
                <p className="admin-muted">
                  {row.category} · {typesLabel(row.variantCount)}
                  {stockLabel(row) && row.stockPieces !== null
                    ? ` · ${stockLabel(row)}`
                    : ""}
                </p>
                <Chips row={row} />
              </div>
              <div className="admin-product-item-side">
                <strong className="admin-num">{row.price}</strong>
                {canManage ? (
                  <>
                    <button
                      type="button"
                      className="admin-btn admin-btn-secondary admin-btn-sm admin-quick-btn"
                      aria-label={`تعديل سريع: ${row.name}`}
                      aria-expanded={editing === row.id}
                      onClick={() =>
                        setEditing(editing === row.id ? null : row.id)
                      }
                    >
                      <Pencil size={16} aria-hidden="true" />
                    </button>
                    <QuickState row={row} action={action} pending={pending} />
                  </>
                ) : null}
              </div>
              {editing === row.id ? (
                <QuickEdit
                  row={row}
                  canStock={canStock}
                  onClose={() => setEditing(null)}
                />
              ) : null}
            </article>
          </li>
        ))}
      </ul>

      {canManage && visibleSelected.length ? (
        <form
          action={action}
          className="admin-bulk-bar"
          aria-label="إجراءات جماعية"
        >
          {visibleSelected.map((row) => (
            <input key={row.id} type="hidden" name="domainId" value={row.id} />
          ))}
          <p role="status">
            {visibleSelected.length === 1
              ? "منتج واحد محدد"
              : `${visibleSelected.length} منتجات محددة`}
          </p>
          <div className="admin-bulk-actions">
            <button
              type="submit"
              name="publication"
              value="published"
              className="admin-btn admin-btn-primary admin-btn-sm"
              disabled={pending}
            >
              {pending ? (
                <LoaderCircle
                  size={16}
                  className="admin-spin"
                  aria-hidden="true"
                />
              ) : null}
              نشر
            </button>
            <button
              type="submit"
              name="publication"
              value="hidden"
              className="admin-btn admin-btn-secondary admin-btn-sm"
              disabled={pending}
            >
              إخفاء
            </button>
            <button
              type="submit"
              name="publication"
              value="draft"
              className="admin-btn admin-btn-secondary admin-btn-sm"
              disabled={pending}
            >
              مسودة
            </button>
            {categories.length ? (
              <span className="admin-bulk-move">
                <label className="sr-only" htmlFor="bulk-move-category">
                  نقل إلى قسم
                </label>
                <select
                  id="bulk-move-category"
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                >
                  <option value="">نقل إلى قسم…</option>
                  {categories.map((category) => (
                    <option key={category.code} value={category.code}>
                      {category.nameAr}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="admin-btn admin-btn-secondary admin-btn-sm"
                  disabled={!target || moving}
                  onClick={moveSelected}
                >
                  نقل
                </button>
              </span>
            ) : null}
            <button
              type="button"
              className="admin-btn admin-btn-ghost admin-btn-sm"
              onClick={() => setSelected(new Set())}
            >
              إلغاء التحديد
            </button>
          </div>
        </form>
      ) : null}
    </>
  );
}

export function ArchivedProductList({
  rows,
  canManage,
}: {
  rows: Array<{ id: string; name: string; category: string }>;
  canManage: boolean;
}) {
  const [state, action, pending] = useActionState<
    CatalogActionResult,
    FormData
  >(restoreProductAction, null);
  return (
    <>
      {state && !state.ok ? (
        <p className="admin-media-message" data-tone="error" role="alert">
          {state.message}
        </p>
      ) : null}
      <ul className="admin-product-cards is-always">
        {rows.map((row) => (
          <li key={row.id}>
            <article className="admin-product-item">
              <div className="admin-product-item-main">
                <Link
                  href={`/admin/products/${row.id}`}
                  prefetch={false}
                  className="admin-product-item-title"
                >
                  <bdi>{row.name}</bdi>
                </Link>
                <p className="admin-muted">{row.category} · مؤرشف</p>
              </div>
              {canManage ? (
                <form action={action}>
                  <input type="hidden" name="domainId" value={row.id} />
                  <button
                    type="submit"
                    className="admin-btn admin-btn-secondary admin-btn-sm"
                    disabled={pending}
                    aria-label={`استعادة ${row.name}`}
                  >
                    استعادة
                  </button>
                </form>
              ) : null}
            </article>
          </li>
        ))}
      </ul>
    </>
  );
}
