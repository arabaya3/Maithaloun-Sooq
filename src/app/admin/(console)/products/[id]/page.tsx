import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { adminCatalogService } from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { ProductForm } from "@/features/admin/ui/product-form";

export const metadata: Metadata = {
  title: "تعديل المنتج",
};

export default async function AdminProductEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();
  const actor = await requireAdminSession();
  const product = await adminCatalogService.getByDomainId(
    actor,
    (await params).id,
  );
  if (!product) notFound();

  return (
    <main className="admin-page">
      <p>
        <Link href="/admin/products" prefetch={false}>
          العودة إلى المنتجات
        </Link>
      </p>
      <h1>تعديل المنتج</h1>
      <ProductForm
        product={product}
        sortOrder={product.sortOrder}
        mode="edit"
      />
    </main>
  );
}
