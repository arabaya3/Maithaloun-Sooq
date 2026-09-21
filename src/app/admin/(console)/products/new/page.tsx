import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { ProductForm } from "@/features/admin/ui/product-form";

export const metadata: Metadata = {
  title: "منتج جديد",
};

export default async function AdminProductCreatePage() {
  await connection();
  await requireAdminSession();

  return (
    <main className="admin-page">
      <p>
        <Link href="/admin/products" prefetch={false}>
          العودة إلى المنتجات
        </Link>
      </p>
      <h1>منتج جديد</h1>
      <ProductForm sortOrder={100} mode="create" />
    </main>
  );
}
