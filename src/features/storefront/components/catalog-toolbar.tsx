"use client";

import { ArrowUpDown, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import {
  PRODUCT_SORTS,
  parseProductSort,
  type ProductSort,
} from "@/features/catalog/domain/product-sort";
import { useI18n } from "@/i18n/i18n-provider";

export interface FilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

/** Count, sort and active-filter chips above a product grid; phones get the filters in a bottom sheet. */
export function CatalogToolbar({
  count,
  sort,
  onSort,
  chips = [],
  onClearFilters,
  sheet,
}: {
  count: number;
  sort: ProductSort;
  onSort: (sort: ProductSort) => void;
  chips?: readonly FilterChip[];
  onClearFilters?: () => void;
  /** Filter controls for the phone sheet; renders `onApply` and `onReset` buttons around them. */
  sheet?: {
    content: ReactNode;
    activeCount: number;
    onApply: () => void;
    onReset: () => void;
  };
}) {
  const { m } = useI18n();
  const sortId = useId();
  const [open, setOpen] = useState(false);
  const sortLabels: Record<ProductSort, string> = {
    featured: m.store.sortFeatured,
    "price-asc": m.store.sortPriceAsc,
    "price-desc": m.store.sortPriceDesc,
  };

  return (
    <div className="catalog-toolbar">
      <div className="catalog-toolbar-row">
        <span className="results-count" aria-live="polite">
          {m.common.productCount(count)}
        </span>
        <div className="catalog-toolbar-actions">
          {sheet ? (
            <button
              type="button"
              className="toolbar-button filter-trigger"
              aria-haspopup="dialog"
              onClick={() => setOpen(true)}
            >
              <SlidersHorizontal aria-hidden="true" />
              {m.store.filter}
              {sheet.activeCount ? (
                <span className="toolbar-badge">{sheet.activeCount}</span>
              ) : null}
            </button>
          ) : null}
          <label className="toolbar-button sort-control" htmlFor={sortId}>
            <ArrowUpDown aria-hidden="true" />
            <span className="sr-only">{m.store.sortLabel}</span>
            <select
              id={sortId}
              value={sort}
              onChange={(event) => onSort(parseProductSort(event.target.value))}
            >
              {PRODUCT_SORTS.map((value) => (
                <option key={value} value={value}>
                  {sortLabels[value]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {chips.length ? (
        <div
          className="filter-chips"
          role="group"
          aria-label={m.store.activeFilters}
        >
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              className="filter-chip"
              aria-label={m.store.removeFilter(chip.label)}
              onClick={chip.onRemove}
            >
              <span>{chip.label}</span>
              <X aria-hidden="true" />
            </button>
          ))}
          {onClearFilters && chips.length > 1 ? (
            <button
              type="button"
              className="filter-clear"
              onClick={onClearFilters}
            >
              {m.store.clearFilters}
            </button>
          ) : null}
        </div>
      ) : null}
      {sheet && open ? (
        <FilterSheet
          onClose={() => setOpen(false)}
          onApply={() => {
            sheet.onApply();
            setOpen(false);
          }}
          onReset={sheet.onReset}
        >
          {sheet.content}
        </FilterSheet>
      ) : null}
    </div>
  );
}

function FilterSheet({
  children,
  onClose,
  onApply,
  onReset,
}: {
  children: ReactNode;
  onClose: () => void;
  onApply: () => void;
  onReset: () => void;
}) {
  const { m } = useI18n();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [onClose]);

  return (
    <div className="filter-sheet-backdrop" onClick={onClose}>
      <div
        ref={panelRef}
        className="filter-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="filter-sheet-header">
          <h2 id={titleId}>{m.store.filterTitle}</h2>
          <button
            type="button"
            className="filter-sheet-close"
            aria-label={m.catalog.close}
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <div className="filter-sheet-body">{children}</div>
        <div className="filter-sheet-footer">
          <button
            type="button"
            className="filter-sheet-reset"
            onClick={onReset}
          >
            {m.store.resetFilters}
          </button>
          <button
            type="button"
            className="filter-sheet-apply"
            onClick={onApply}
          >
            {m.store.applyFilters}
          </button>
        </div>
      </div>
    </div>
  );
}
