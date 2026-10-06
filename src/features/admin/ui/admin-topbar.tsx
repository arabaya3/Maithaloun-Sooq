"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";

import { AdminGlobalSearch } from "./admin-global-search";

const titles: Record<string, string> = {
  "/admin": "اليوم",
  "/admin/orders": "الطلبات",
  "/admin/products": "المنتجات",
  "/admin/products/new": "منتج جديد",
  "/admin/settings": "إعدادات المتجر",
  "/admin/notifications": "الإشعارات",
  "/admin/voice": "سجّل عملية بالصوت",
  "/admin/reports": "التقارير",
  "/admin/reports/archive": "أرشيف الملخصات",
  "/admin/sales": "المبيعات",
  "/admin/sales/new": "بيع يدوي",
  "/admin/customers": "الزبائن والديون",
  "/admin/inventory": "المخزون والمشتريات",
  "/admin/inventory/stock": "قائمة المخزون",
  "/admin/inventory/purchases": "فواتير الشراء",
  "/admin/inventory/purchases/new": "إدخال شراء يدوي",
  "/admin/inventory/suppliers": "الموردون",
  "/admin/inventory/import": "رفع ملف Excel",
  "/admin/inventory/capture": "تصوير فاتورة شراء",
  "/admin/inventory/price-reviews": "مراجعة أسعار البيع",
};

function resolveTitle(pathname: string): string {
  if (titles[pathname]) return titles[pathname];
  if (pathname.startsWith("/admin/orders/")) return "تفاصيل الطلب";
  if (pathname.startsWith("/admin/products/")) return "تعديل المنتج";
  if (pathname.startsWith("/admin/reports/archive/")) return "ملخص محفوظ";
  if (pathname.startsWith("/admin/sales/")) return "فاتورة بيع";
  if (pathname.startsWith("/admin/customers/")) return "ملف الزبون";
  if (pathname.startsWith("/admin/inventory/stock/")) return "تفاصيل المخزون";
  if (pathname.startsWith("/admin/inventory/purchases/")) return "فاتورة شراء";
  if (pathname.startsWith("/admin/inventory/review/"))
    return "مراجعة قبل الحفظ";
  return "إدارة سوق ميثلون";
}

export function AdminTopbar() {
  const pathname = usePathname();
  const title = resolveTitle(pathname);
  const showAddProduct = pathname.startsWith("/admin/products");

  return (
    <div className="admin-topbar">
      <div className="admin-topbar-start">
        <p className="admin-topbar-title">{title}</p>
      </div>
      <div className="admin-topbar-actions">
        <AdminGlobalSearch />
        {showAddProduct ? (
          <Link
            href="/admin/products/new"
            className="admin-btn admin-btn-primary admin-btn-sm"
            prefetch={false}
          >
            <Plus size={16} aria-hidden="true" />
            إضافة منتج
          </Link>
        ) : null}
      </div>
    </div>
  );
}
