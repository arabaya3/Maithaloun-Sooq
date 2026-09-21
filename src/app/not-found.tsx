import Link from "next/link";

export default function NotFoundPage() {
  return (
    <main className="placeholder-page page-shell">
      <div className="placeholder-panel">
        <h1>الصفحة غير موجودة</h1>
        <p>تعذّر العثور على الصفحة المطلوبة.</p>
        <Link href="/">العودة إلى المتجر</Link>
      </div>
    </main>
  );
}
