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
  heading,
  count,
  sort,
  onSort,
  chips = [],
  onClearFilters,
  sheet,
}: {
  heading?: ReactNode;
  count: number;
  sort: ProductSort;
  onSort: (sort: ProductSort) => void;
  chips?: readonly FilterChip[];
  onClearFilters?: () => void;
  /** Filter controls for the phone sheet; renders `onApply` and `onReset` buttons around them. */
  sheet?: {
    content: ReactNode;
    activeCount: number;
    previewCount: number;
    canReset: boolean;
    onOpen?: () => void;
    onApply: () => void;
    onReset: () => void;
  };
}) {
  const { m, locale } = useI18n();
  const sortId = useId();
  const [open, setOpen] = useState(false);
  const sortLabels: Record<ProductSort, string> = {
    featured: m.store.sortFeatured,
    "price-asc": m.store.sortPriceAsc,
    "price-desc": m.store.sortPriceDesc,
  };

  return (
    <div className="catalog-toolbar">
      {heading ? (
        <div className="home-section-heading catalog-heading">
          {heading}
          <span className="results-count" aria-live="polite">
            {m.common.productCount(count)}
          </span>
        </div>
      ) : null}
      <div className="catalog-toolbar-row">
        {!heading ? (
          <span className="results-count" aria-live="polite">
            {m.common.productCount(count)}
          </span>
        ) : null}
        <div className="catalog-toolbar-actions">
          {sheet ? (
            <button
              type="button"
              className="toolbar-button filter-trigger"
              aria-haspopup="dialog"
              onClick={() => {
                sheet.onOpen?.();
                setOpen(true);
              }}
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
                  {heading && value === "featured"
                    ? locale === "ar"
                      ? "ترتيب"
                      : "Sort"
                    : sortLabels[value]}
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
          {onClearFilters && chips.length > 0 ? (
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
          previewCount={sheet.previewCount}
          canReset={sheet.canReset}
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
  previewCount,
  canReset,
  onClose,
  onApply,
  onReset,
}: {
  children: ReactNode;
  previewCount: number;
  canReset: boolean;
  onClose: () => void;
  onApply: () => void;
  onReset: () => void;
}) {
  const { m } = useI18n();
  const titleId = useId();
  const panelRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const overflow = document.body.style.overflow;
    panel.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      panel.close();
      document.body.style.overflow = overflow;
    };
  }, []);

  return (
    <dialog
      ref={panelRef}
      className="filter-sheet"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
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
          disabled={!canReset}
        >
          {m.store.resetFilters}
        </button>
        <button type="button" className="filter-sheet-apply" onClick={onApply}>
          {m.store.applyFilters}
          <span className="filter-result-count" aria-live="polite">
            {previewCount}
          </span>
        </button>
      </div>
    </dialog>
  );
}
