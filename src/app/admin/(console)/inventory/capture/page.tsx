import type { Metadata } from "next";
import { connection } from "next/server";

import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { InvoiceCaptureWizard } from "@/features/purchasing/ui/invoice-capture-wizard";

export const metadata: Metadata = { title: "تصوير فاتورة شراء" };

export default async function InvoiceCapturePage() {
  await connection();
  await requireAdminSession();
  return (
    <main className="admin-page admin-page-capture">
      <InvoiceCaptureWizard />
    </main>
  );
}
