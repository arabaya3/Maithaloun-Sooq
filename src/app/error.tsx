"use client";

import { AlertTriangle } from "lucide-react";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="placeholder-page page-shell">
      <div className="placeholder-panel" role="alert">
        <AlertTriangle className="status-icon" aria-hidden="true" />
        <h1>تعذّر تحميل الصفحة</h1>
        <p>حدث خطأ غير متوقع. يمكنك المحاولة مرة أخرى.</p>
        <button type="button" className="retry-button" onClick={reset}>
          إعادة المحاولة
        </button>
      </div>
    </main>
  );
}
