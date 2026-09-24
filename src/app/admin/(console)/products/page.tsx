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

  return (
    <main className="admin-page">
      <div className="admin-page-header">
        <div>
          <h1>المنتجات</h1>
          <p className="admin-lede">إدارة الكتالوج والأسعار والتوفر.</p>
        </div>
        <Link
          className="admin-button-primary"
          href="/admin/products/new"
          prefetch={false}
        >
          إضافة منتج
        </Link>
      </div>

      <form className="admin-filters" method="get">
        <label htmlFor="product-search">بحث</label>
        <input
          id="product-search"
          name="q"
          defaultValue={params.q ?? ""}
          placeholder="اسم المنتج"
        />
        <label htmlFor="product-category">التصنيف</label>
        <select
          id="product-category"
          name="category"
          defaultValue={category ?? ""}
        >
          <option value="">كل التصنيفات</option>
          {categories.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
        <label htmlFor="product-availability">التوفر</label>
        <select
          id="product-availability"
          name="availability"
          defaultValue={availability ?? ""}
        >
          <option value="">الكل</option>
          <option value="available">متاح</option>
          <option value="unavailable">غير متاح</option>
        </select>
        <div className="admin-filter-actions">
          <button type="submit">تصفية</button>
          <Link href="/admin/products" prefetch={false}>
            مسح
          </Link>
        </div>
      </form>

      {filtered.length === 0 ? (
        <p className="admin-empty">
          لا توجد منتجات مطابقة.{" "}
          <Link href="/admin/products/new" prefetch={false}>
            أضف منتجاً
          </Link>
        </p>
      ) : (
        <ul className="admin-product-list">
          {filtered.map((product) => {
            const variantCount = product.variants?.length ?? 1;
            const prices = (product.variants ?? []).map((v) => v.priceAgorot);
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
                      {categories.find((c) => c.id === product.categoryId)
                        ?.label ?? product.categoryId}
                      {" · "}
                      {variantCount > 1
                        ? `${variantCount} خيارات`
                        : "خيار واحد"}
                    </p>
                  </div>
                  <div className="admin-product-card-meta">
                    <strong>
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
      )}
    </main>
  );
}
