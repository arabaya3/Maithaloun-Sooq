import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { connection } from "next/server";

import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { can } from "@/features/admin/domain/permissions";
import { SimpleProductEditor } from "@/features/admin/ui/simple-product-editor";

export const metadata: Metadata = { title: "منتج جديد" };

export default async function AdminNewProductPage() {
  await connection();
  const actor = await requireAdminSession();
  if (!can(actor, "settings.manage")) {
    return (
      <main className="admin-page admin-page--narrow sp-page">
        <h1>منتج جديد</h1>
        <p className="sp-note" data-tone="warning">
          إضافة المنتجات للمالك فقط.
        </p>
      </main>
    );
  }
  return (
    <main className="admin-page admin-page--narrow sp-page">
      <header className="admin-workspace-header">
        <Link
          href="/admin/products"
          prefetch={false}
          className="admin-back-link"
        >
          <ArrowRight size={16} aria-hidden="true" />
          العودة إلى المنتجات
        </Link>
        <h1>منتج جديد</h1>
        <p className="sp-muted">
          اكتبي الاسم، ثم أضيفي الأنواع (روائح أو أحجام) مع صورة وسعر لكل نوع،
          واضغطي حفظ.
        </p>
      </header>
      <SimpleProductEditor
        canStock={can(actor, "stock.adjust")}
        initial={{
          productId: null,
          nameAr: "",
          categoryId: "",
          description: "",
          kind: "single",
          optionName: "",
          rows: [],
          generalImages: [],
          published: false,
        }}
      />
      <p className="sp-muted sp-alt">
        <Link href="/admin/products/new/photo" prefetch={false}>
          أو صوّري العبوة ودعي النظام يقرأ الاسم والسعر
        </Link>
      </p>
    </main>
  );
}
