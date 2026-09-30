import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { can } from "@/features/admin/domain/permissions";
import { PageHeader } from "@/features/admin/ui/kit";
import { SpreadsheetImportWizard } from "@/features/purchasing/ui/spreadsheet-import-wizard";

export const metadata: Metadata = { title: "رفع ملف Excel" };

export default async function SpreadsheetImportPage() {
  await connection();
  const actor = await requireAdminSession();
  if (!can(actor, "purchase.import")) redirect("/admin/inventory");

  return (
    <main className="admin-page admin-page--narrow">
      <PageHeader
        title="رفع ملف Excel"
        lede="فاتورة شراء واحدة في كل ملف. تراجعين كل سطر قبل أن يدخل المخزون."
        back={{ href: "/admin/inventory", label: "المخزون والمشتريات" }}
      />
      <SpreadsheetImportWizard />
    </main>
  );
}
