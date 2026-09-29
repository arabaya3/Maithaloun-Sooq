import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { ProductForm } from "@/features/admin/ui/product-form";

export const metadata: Metadata = { title: "إدخال منتج يدوياً" };

export default async function ManualProductCreatePage() {
  await connection();
  await requireAdminSession();
  return (
    <main className="admin-page">
      <p>
        <Link href="/admin/products/new">العودة للتصوير</Link>
      </p>
      <h1>إدخال منتج يدوياً</h1>
      <ProductForm sortOrder={100} mode="create" />
    </main>
  );
}
