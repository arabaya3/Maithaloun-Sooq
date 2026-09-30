"use client";

import { ChevronDown, Search } from "lucide-react";
import { useMemo, useState, type KeyboardEvent } from "react";

import { normalizeArabicText } from "@/shared/lib/normalize-arabic";
import { Sheet } from "@/shared/ui/sheet";

export interface VariantOption {
  variantId: string;
  name: string;
  variantLabel: string | null;
  sku: string | null;
  barcode: string | null;
  hint?: string;
}

export type CreateVariant = (input: {
  nameAr: string;
  priceIls: string;
}) => Promise<{ ok: true; variantId: string } | { ok: false; message: string }>;

export function variantOptionLabel(option: VariantOption): string {
  return option.variantLabel
    ? `${option.name} — ${option.variantLabel}`
    : option.name;
}

// The picker lives inside larger forms; Enter must not submit them.
function blockSubmit(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key === "Enter") event.preventDefault();
}

export function VariantPicker({
  options,
  value,
  onChange,
  label,
  invalid,
  onCreate,
  createDefaultName = "",
}: {
  options: readonly VariantOption[];
  value: string;
  onChange: (variantId: string) => void;
  label: string;
  invalid?: boolean;
  onCreate?: CreateVariant;
  createDefaultName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [newName, setNewName] = useState(createDefaultName);
  const [newPrice, setNewPrice] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const selected = options.find((option) => option.variantId === value);
  const filtered = useMemo(() => {
    const needle = normalizeArabicText(query);
    if (!needle) return options;
    return options.filter((option) =>
      normalizeArabicText(
        `${variantOptionLabel(option)} ${option.sku ?? ""} ${option.barcode ?? ""}`,
      ).includes(needle),
    );
  }, [options, query]);

  function close() {
    setOpen(false);
    setQuery("");
  }

  async function create() {
    if (!onCreate) return;
    if (newName.trim().length < 2) {
      setCreateError("اكتبي اسم المنتج.");
      return;
    }
    setCreating(true);
    setCreateError(null);
    const result = await onCreate({ nameAr: newName, priceIls: newPrice });
    setCreating(false);
    if (!result.ok) {
      setCreateError(result.message);
      return;
    }
    onChange(result.variantId);
    close();
  }

  return (
    <>
      <button
        type="button"
        className="admin-picker-trigger"
        aria-haspopup="dialog"
        aria-label={`${label}: ${selected ? variantOptionLabel(selected) : "لم يُختر بعد"}`}
        data-invalid={invalid || undefined}
        onClick={() => setOpen(true)}
      >
        <span>{selected ? variantOptionLabel(selected) : "اختاري المنتج"}</span>
        <ChevronDown size={18} aria-hidden="true" />
      </button>
      <Sheet open={open} onClose={close} title={label}>
        <div className="admin-picker-search">
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={blockSubmit}
            placeholder="ابحثي بالاسم أو الباركود"
            aria-label="بحث عن منتج"
          />
        </div>
        {filtered.length ? (
          <ul className="admin-picker-list">
            {filtered.map((option) => (
              <li key={option.variantId}>
                <button
                  type="button"
                  aria-pressed={option.variantId === value}
                  onClick={() => {
                    onChange(option.variantId);
                    close();
                  }}
                >
                  <strong>{variantOptionLabel(option)}</strong>
                  {option.hint ? <small>{option.hint}</small> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="admin-picker-empty">لا يوجد منتج بهذا الاسم.</p>
        )}
        {onCreate ? (
          <details className="admin-disclosure admin-picker-create">
            <summary>منتج جديد</summary>
            <label>
              اسم المنتج
              <input
                value={newName}
                maxLength={160}
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={blockSubmit}
              />
            </label>
            <label>
              سعر البيع للزبون ₪
              <input
                value={newPrice}
                inputMode="decimal"
                dir="ltr"
                placeholder="0.00"
                onChange={(event) => setNewPrice(event.target.value)}
                onKeyDown={blockSubmit}
              />
            </label>
            <p className="admin-picker-empty">
              يُحفظ المنتج غير متاح في المتجر حتى تراجعيه وتنشريه.
            </p>
            {createError ? (
              <p className="admin-form-error" role="alert">
                {createError}
              </p>
            ) : null}
            <button
              type="button"
              className="admin-btn admin-btn-secondary"
              disabled={creating}
              onClick={create}
            >
              {creating ? "جارٍ الإنشاء…" : "إنشاء المنتج واختياره"}
            </button>
          </details>
        ) : null}
      </Sheet>
    </>
  );
}
