"use client";

import { SlidersHorizontal, X } from "lucide-react";
import { useId, useRef, type ReactNode } from "react";

/**
 * Content that opens in a bottom sheet on phones and sits inline from 1024px (spec §9).
 * Filter fields stay inside the surrounding form either way, so submitting works the same.
 */
export function FilterSheet({
  title,
  activeCount = 0,
  label = "تصفية",
  icon = <SlidersHorizontal size={18} aria-hidden="true" />,
  children,
}: {
  title: string;
  activeCount?: number;
  /** Text on the phone button that opens the sheet. */
  label?: string;
  /** A rendered icon: server pages cannot pass a component to this client component. */
  icon?: ReactNode;
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
        {icon}
        {activeCount ? `${label} (${activeCount})` : label}
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
