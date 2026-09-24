import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { adminCatalogService } from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import {
  categories,
  getProductDisplayName,
  type ProductCategoryId,
} from "@/features/catalog/domain/product";
import { formatIls } from "@/shared/lib/format-currency";

export const metadata: Metadata = {
  title: "المنتجات",
};

export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    category?: string;
    availability?: string;
  }>;
}) {
  await connection();
  const actor = await requireAdminSession();
  const params = await searchParams;
  const products = await adminCatalogService.list(actor);
  const query = params.q?.trim().toLowerCase() ?? "";
  const category =
    params.category && categories.some((entry) => entry.id === params.category)
      ? (params.category as ProductCategoryId)
      : undefined;
  const availability =
    params.availability === "available" || params.availability === "unavailable"
      ? params.availability
      : undefined;

  const filtered = products.filter((product) => {
    if (category && product.categoryId !== category) return false;
    if (availability && product.availability !== availability) return false;
    if (!query) return true;
    const haystack =
      `${product.nameAr} ${product.latinName ?? ""} ${product.id}`
        .toLowerCase()
        .trim();
    return haystack.includes(query);
  });

  const hasFilters = Boolean(query || category || availability);

  return (
    <main className="admin-page">
      <header className="admin-page-header">
        <div>
          <h1>المنتجات</h1>
          <p className="admin-lede">{filtered.length} منتج معروض</p>
        </div>
        <Link
          className="admin-btn admin-btn-primary"
          href="/admin/products/new"
          prefetch={false}
        >
          إضافة منتج
        </Link>
      </header>

      <form className="admin-toolbar" method="get">
        <div className="admin-toolbar-search">
          <label className="sr-only" htmlFor="product-search">
            بحث
          </label>
          <input
            id="product-search"
            name="q"
            defaultValue={params.q ?? ""}
            placeholder="اسم المنتج"
          />
        </div>
        <label className="admin-toolbar-field" htmlFor="product-category">
          <span>التصنيف</span>
          <select
            id="product-category"
            name="category"
            defaultValue={category ?? ""}
          >
            <option value="">الكل</option>
            {categories
              .filter((entry) => entry.id !== "all")
              .map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
          </select>
        </label>
        <label className="admin-toolbar-field" htmlFor="product-availability">
          <span>التوفر</span>
          <select
            id="product-availability"
            name="availability"
            defaultValue={availability ?? ""}
          >
            <option value="">الكل</option>
            <option value="available">متاح</option>
            <option value="unavailable">غير متاح</option>
          </select>
        </label>
        <div className="admin-toolbar-actions">
          <button type="submit" className="admin-btn admin-btn-secondary">
            تطبيق
          </button>
          {hasFilters ? (
            <Link
              href="/admin/products"
              className="admin-btn admin-btn-ghost"
              prefetch={false}
            >
              مسح
            </Link>
          ) : null}
        </div>
      </form>

      {filtered.length === 0 ? (
        <div className="admin-empty">
          <p>لا توجد منتجات مطابقة.</p>
          <Link href="/admin/products/new" prefetch={false}>
            أضف منتجاً
          </Link>
        </div>
      ) : (
        <>
          <div className="admin-table-wrap admin-table-desktop">
            <table className="admin-data-table">
              <thead>
                <tr>
                  <th>المنتج</th>
                  <th>التصنيف</th>
                  <th>السعر</th>
                  <th>الخيارات</th>
                  <th>التوفر</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((product) => {
                  const variantCount = product.variants?.length ?? 1;
                  const prices = (product.variants ?? []).map(
                    (variant) => variant.priceAgorot,
                  );
                  const min = prices.length
                    ? Math.min(...prices)
                    : product.priceAgorot;
                  const max = prices.length
                    ? Math.max(...prices)
                    : product.priceAgorot;
                  return (
                    <tr key={product.id}>
                      <td>
                        <Link
                          href={`/admin/products/${product.id}`}
                          prefetch={false}
                        >
                          {getProductDisplayName(product)}
                        </Link>
                      </td>
                      <td>
                        {categories.find(
                          (entry) => entry.id === product.categoryId,
                        )?.label ?? product.categoryId}
                      </td>
                      <td className="admin-num">
                        {min === max
                          ? formatIls(min)
                          : `${formatIls(min)} – ${formatIls(max)}`}
                      </td>
                      <td className="admin-num">{variantCount}</td>
                      <td>
                        <span
                          className={
                            product.availability === "available"
                              ? "admin-pill-ok"
                              : "admin-pill-warn"
                          }
                        >
                          {product.availability === "available"
                            ? "متاح"
                            : "غير متاح"}
                        </span>
                      </td>
                      <td>
                        <Link
                          className="admin-btn admin-btn-ghost admin-btn-sm"
                          href={`/admin/products/${product.id}`}
                          prefetch={false}
                        >
                          تعديل
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <ul className="admin-product-list">
            {filtered.map((product) => {
              const variantCount = product.variants?.length ?? 1;
              const prices = (product.variants ?? []).map(
                (variant) => variant.priceAgorot,
              );
              const min = prices.length
                ? Math.min(...prices)
                : product.priceAgorot;
              const max = prices.length
                ? Math.max(...prices)
                : product.priceAgorot;
              return (
                <li key={product.id}>
                  <Link
                    href={`/admin/products/${product.id}`}
                    prefetch={false}
                    className="admin-product-card"
                  >
                    <div>
                      <h2>{getProductDisplayName(product)}</h2>
                      <p className="admin-muted">
                        {categories.find(
                          (entry) => entry.id === product.categoryId,
                        )?.label ?? product.categoryId}
                        {" · "}
                        {variantCount > 1
                          ? `${variantCount} خيارات`
                          : "خيار واحد"}
                      </p>
                    </div>
                    <div className="admin-product-card-meta">
                      <strong className="admin-num">
                        {min === max
                          ? formatIls(min)
                          : `${formatIls(min)} – ${formatIls(max)}`}
                      </strong>
                      <span
                        className={
                          product.availability === "available"
                            ? "admin-pill-ok"
                            : "admin-pill-warn"
                        }
                      >
                        {product.availability === "available"
                          ? "متاح"
                          : "غير متاح"}
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </main>
  );
}
