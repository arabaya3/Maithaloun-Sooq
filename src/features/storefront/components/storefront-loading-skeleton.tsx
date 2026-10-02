import { MobileNavigation } from "./mobile-navigation";
import { SiteHeader } from "./site-header";

export function StorefrontLoadingSkeleton() {
  return (
    <>
      <SiteHeader />
      <main
        className="page-shell storefront-main storefront-skeleton"
        aria-busy="true"
      >
        <p className="sr-only" role="status">
          جارٍ تحميل المنتجات
        </p>
        <section className="welcome" aria-hidden="true">
          <span className="skeleton skeleton-title" />
          <span className="skeleton skeleton-search" />
        </section>
        <span className="skeleton skeleton-hero" aria-hidden="true" />
        <div className="category-list" aria-hidden="true">
          {Array.from({ length: 5 }, (_, index) => (
            <span key={index} className="skeleton-category">
              <span className="skeleton skeleton-category-icon" />
              <span className="skeleton skeleton-category-label" />
            </span>
          ))}
        </div>
        <div className="product-grid" aria-hidden="true">
          {Array.from({ length: 4 }, (_, index) => (
            <span key={index} className="skeleton skeleton-product" />
          ))}
        </div>
      </main>
      <MobileNavigation />
    </>
  );
}
