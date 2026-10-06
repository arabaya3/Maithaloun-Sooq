"use client";

import { ErrorState } from "@/features/admin/ui/kit";

export default function AdminTodayError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="admin-page admin-today">
      <h1>اليوم</h1>
      <ErrorState
        title="تعذّر تحميل مهام اليوم"
        reference={error.digest}
        action={
          <button
            type="button"
            className="admin-btn admin-btn-primary"
            onClick={reset}
          >
            إعادة المحاولة
          </button>
        }
      >
        <p className="admin-muted">
          لم يتغيّر شيء في متجرك. أعيدي المحاولة بعد لحظات.
        </p>
      </ErrorState>
    </main>
  );
}
