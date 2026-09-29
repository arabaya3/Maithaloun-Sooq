import type { Metadata } from "next";
import { connection } from "next/server";

import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { ProductCaptureWizard } from "@/features/admin/ui/product-capture-wizard";

export const metadata: Metadata = {
  title: "منتج جديد",
};

export default async function AdminProductCreatePage() {
  await connection();
  await requireAdminSession();

  return (
    <main className="admin-page admin-page-capture">
      <ProductCaptureWizard />
    </main>
  );
}
