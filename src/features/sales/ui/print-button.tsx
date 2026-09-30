"use client";

import { Printer } from "lucide-react";

export function PrintButton() {
  return (
    <button
      type="button"
      className="admin-btn admin-btn-primary"
      onClick={() => window.print()}
    >
      <Printer size={18} aria-hidden="true" />
      طباعة
    </button>
  );
}
