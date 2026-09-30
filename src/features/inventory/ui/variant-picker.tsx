"use client";

import { ChevronDown, Search } from "lucide-react";
import { useMemo, useState } from "react";

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

export function variantOptionLabel(option: VariantOption): string {
  return option.variantLabel
    ? `${option.name} — ${option.variantLabel}`
    : option.name;
}

export function VariantPicker({
  options,
  value,
  onChange,
  label,
  invalid,
}: {
  options: readonly VariantOption[];
  value: string;
  onChange: (variantId: string) => void;
  label: string;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
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
      <Sheet open={open} onClose={() => setOpen(false)} title={label}>
        <div className="admin-picker-search">
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
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
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <strong>{variantOptionLabel(option)}</strong>
                  {option.hint ? <small>{option.hint}</small> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="admin-picker-empty">
            لا يوجد منتج بهذا الاسم. أضيفيه من “المنتجات” أولاً.
          </p>
        )}
      </Sheet>
    </>
  );
}
