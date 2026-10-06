import type { Metadata } from "next";
import Link from "next/link";
import { Camera, ChevronLeft, PenLine, ReceiptText } from "lucide-react";
import { connection } from "next/server";

import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { can } from "@/features/admin/domain/permissions";
import { PageHeader } from "@/features/admin/ui/kit";

export const metadata: Metadata = {
  title: "منتج جديد",
};

// Spec §8 step 1: choose the source. Each route ends in a draft product that the workspace completes.
export default async function AdminProductCreatePage() {
  await connection();
  const actor = await requireAdminSession();
  const routes = [
    {
      href: "/admin/products/new/photo",
      title: "تصوير المنتج",
      hint: "صوّري العبوة ونقرأ الاسم والحجم والباركود، ثم تراجعينها قبل الحفظ.",
      Icon: Camera,
    },
    {
      href: "/admin/products/new/manual",
      title: "إدخال المنتج يدوياً",
      hint: "اكتبي الاسم والقسم والسعر خطوة بخطوة. المسودة تُحفظ تلقائياً على هذا الجهاز.",
      Icon: PenLine,
    },
    {
      href: can(actor, "purchase.record")
        ? "/admin/inventory/capture"
        : "/admin/inventory/purchases",
      title: "من فاتورة شراء",
      hint: "صوّري فاتورة المورد وأضيفي أصنافها الجديدة مع الكمية والتكلفة.",
      Icon: ReceiptText,
    },
  ];
  return (
    <main className="admin-page admin-create-routes">
      <PageHeader
        title="منتج جديد"
        lede="اختاري طريقة البدء. كل طريقة تنشئ مسودة لا تظهر للزبائن حتى تنشريها."
        back={{ href: "/admin/products", label: "العودة إلى المنتجات" }}
      />
      <ul className="admin-route-cards">
        {routes.map((route) => (
          <li key={route.href}>
            <Link
              href={route.href}
              prefetch={false}
              className="admin-route-card"
            >
              <span className="admin-route-card-icon" aria-hidden="true">
                <route.Icon size={28} />
              </span>
              <span className="admin-route-card-text">
                <strong>{route.title}</strong>
                <small>{route.hint}</small>
              </span>
              <ChevronLeft size={20} aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
