"use client";

import Link from "next/link";
import { LoaderCircle } from "lucide-react";
import { useActionState, useState } from "react";

import {
  bulkPublicationAction,
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
}: {
  rows: ProductListRow[];
  canManage: boolean;
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
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

  return (
    <>
      <BulkResult state={state} names={names} />

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
              <th>الأصناف</th>
              <th>الحالة</th>
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
                  <Link href={`/admin/products/${row.id}`} prefetch={false}>
                    <bdi>{row.name}</bdi>
                  </Link>
                </td>
                <td>{row.category}</td>
                <td className="admin-num">{row.price}</td>
                <td className="admin-num">{row.variantCount}</td>
                <td>
                  <Chips row={row} />
                </td>
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
                <Link
                  href={`/admin/products/${row.id}`}
                  prefetch={false}
                  className="admin-product-item-title"
                >
                  <bdi>{row.name}</bdi>
                </Link>
                <p className="admin-muted">
                  {row.category} ·{" "}
                  {row.variantCount > 1
                    ? `${row.variantCount} أصناف`
                    : "صنف واحد"}
                </p>
                <Chips row={row} />
              </div>
              <div className="admin-product-item-side">
                <strong className="admin-num">{row.price}</strong>
                {canManage ? (
                  <QuickState row={row} action={action} pending={pending} />
                ) : null}
              </div>
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
