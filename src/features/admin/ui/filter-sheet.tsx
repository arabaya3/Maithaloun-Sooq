"use client";

import { SlidersHorizontal, X } from "lucide-react";
import { useId, useRef, type ReactNode } from "react";

/**
 * Filters that open in a sheet on phones and sit inline from 1024px (spec §9).
 * The fields stay inside the surrounding form either way, so submitting works the same.
 */
export function FilterSheet({
  title,
  activeCount,
  children,
}: {
  title: string;
  activeCount: number;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  return (
    <div className="admin-filter-sheet">
      <button
        type="button"
        className="admin-btn admin-btn-secondary admin-filter-toggle"
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
      >
        <SlidersHorizontal size={18} aria-hidden="true" />
        {activeCount ? `تصفية (${activeCount})` : "تصفية"}
      </button>
      <dialog
        ref={dialog}
        className="admin-filter-dialog"
        aria-labelledby={titleId}
        onClick={(event) => {
          if (event.target === dialog.current) dialog.current?.close();
        }}
      >
        <div className="admin-filter-dialog-head">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="admin-filter-close"
            aria-label="إغلاق"
            onClick={() => dialog.current?.close()}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <div className="admin-filter-fields">{children}</div>
      </dialog>
    </div>
  );
}
