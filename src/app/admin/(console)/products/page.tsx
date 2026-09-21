import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { adminCatalogService } from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { getProductDisplayName } from "@/features/catalog/domain/product";
import { formatIls } from "@/shared/lib/format-currency";

export const metadata: Metadata = {
  title: "المنتجات",
};

export default async function AdminProductsPage() {
  await connection();
  const actor = await requireAdminSession();
  const products = await adminCatalogService.list(actor);

  return (
    <main className="admin-page">
      <div className="admin-page-header">
        <h1>المنتجات</h1>
        <Link href="/admin/products/new" prefetch={false}>
          منتج جديد
        </Link>
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>المنتج</th>
              <th>السعر</th>
              <th>التوفر</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id}>
                <td>
                  <Link href={`/admin/products/${product.id}`} prefetch={false}>
                    {getProductDisplayName(product)}
                  </Link>
                </td>
                <td>{formatIls(product.priceAgorot)}</td>
                <td>
                  {product.availability === "available" ? "متاح" : "غير متاح"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
