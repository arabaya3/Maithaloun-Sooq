"use client";

export default function AdminError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="admin-page">
      <h1>تعذّر تحميل صفحة الإدارة</h1>
      <p>حدث خطأ أثناء تحميل البيانات. لم تُعرض أي تفاصيل داخلية.</p>
      <button type="button" onClick={reset}>
        إعادة المحاولة
      </button>
    </main>
  );
}
