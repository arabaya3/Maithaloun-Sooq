import type { Metadata } from "next";
import { connection } from "next/server";

import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { PageHeader } from "@/features/admin/ui/kit";
import { ProductDraft } from "@/features/admin/ui/product-draft";
import { ProductForm } from "@/features/admin/ui/product-form";

export const metadata: Metadata = { title: "إدخال منتج يدوياً" };

export default async function ManualProductCreatePage() {
  await connection();
  await requireAdminSession();
  return (
    <main className="admin-page admin-page--narrow">
      <PageHeader
        title="إدخال منتج يدوياً"
        lede="يُنشأ المنتج كمسودة. بعد الحفظ تكملين الخيارات والصور وطرق البيع، ثم تنشرينه."
        back={{ href: "/admin/products/new", label: "طرق إضافة منتج" }}
      />
      <ProductDraft>
        <ProductForm sortOrder={100} mode="create" />
      </ProductDraft>
    </main>
  );
}
