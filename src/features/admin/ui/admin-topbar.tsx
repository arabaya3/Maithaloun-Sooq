"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus, Search } from "lucide-react";

const titles: Record<string, string> = {
  "/admin": "لوحة المتابعة",
  "/admin/orders": "الطلبات",
  "/admin/products": "المنتجات",
  "/admin/products/new": "منتج جديد",
  "/admin/settings": "إعدادات المتجر",
  "/admin/notifications": "الإشعارات",
  "/admin/reports": "التقارير",
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
  const showOrderSearch =
    pathname === "/admin" || pathname.startsWith("/admin/orders");
  const showAddProduct =
    pathname === "/admin" || pathname.startsWith("/admin/products");

  return (
    <div className="admin-topbar">
      <div className="admin-topbar-start">
        <p className="admin-topbar-title">{title}</p>
      </div>
      <div className="admin-topbar-actions">
        {showOrderSearch ? (
          <form
            className="admin-topbar-search"
            action="/admin/orders"
            method="get"
          >
            <Search size={16} aria-hidden="true" />
            <label className="sr-only" htmlFor="admin-global-order-search">
              بحث الطلبات
            </label>
            <input
              id="admin-global-order-search"
              name="q"
              type="search"
              placeholder="ابحث عن طلب…"
              dir="auto"
            />
          </form>
        ) : null}
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
