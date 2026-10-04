import type { Metadata } from "next";
import { connection } from "next/server";

import { catalogAuthoringService } from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { can } from "@/features/admin/domain/permissions";
import {
  CategoryCreateForm,
  CategoryRow,
} from "@/features/admin/ui/category-manager";
import { PageHeader } from "@/features/admin/ui/kit";

export const metadata: Metadata = { title: "الأقسام" };

const savedMessages: Record<string, string> = {
  created: "تمت إضافة القسم.",
  updated: "تم حفظ القسم.",
  archived: "تمت أرشفة القسم.",
  restored: "تمت استعادة القسم.",
};

export default async function CategoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string | string[] }>;
}) {
  await connection();
  const actor = await requireAdminSession();
  const header = (
    <PageHeader
      title="الأقسام"
      back={{ href: "/admin/products", label: "المنتجات" }}
    />
  );
  if (!can(actor, "settings.manage")) {
    return (
      <main className="admin-page admin-page--narrow">
        {header}
        <p className="admin-note" role="note">
          إدارة الأقسام للمالك فقط.
        </p>
      </main>
    );
  }
  const { saved } = await searchParams;
  const message =
    typeof saved === "string" && Object.hasOwn(savedMessages, saved)
      ? savedMessages[saved]
      : null;
  const categories = await catalogAuthoringService.listCategories(true);
  const active = categories.filter((category) => !category.archived);
  const archived = categories.filter((category) => category.archived);

  return (
    <main className="admin-page admin-page--narrow">
      {header}
      {message ? (
        <p className="admin-media-message" data-tone="ok" role="status">
          {message}
        </p>
      ) : null}
      <CategoryCreateForm />
      <h2>الأقسام الحالية ({active.length})</h2>
      <ul className="admin-supplier-list" aria-label="الأقسام الحالية">
        {active.map((category) => (
          <CategoryRow key={category.code} category={category} />
        ))}
      </ul>
      {archived.length ? (
        <details>
          <summary>أقسام مؤرشفة ({archived.length})</summary>
          <ul className="admin-supplier-list" aria-label="الأقسام المؤرشفة">
            {archived.map((category) => (
              <CategoryRow key={category.code} category={category} />
            ))}
          </ul>
        </details>
      ) : null}
    </main>
  );
}
