export default function Loading() {
  return (
    <main
      className="page-shell loading-page"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="loading-mark" aria-hidden="true" />
      <p>جارٍ تحميل المنتجات…</p>
    </main>
  );
}
