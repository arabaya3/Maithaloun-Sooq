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
};

function resolveTitle(pathname: string): string {
  if (titles[pathname]) return titles[pathname];
  if (pathname.startsWith("/admin/orders/")) return "تفاصيل الطلب";
  if (pathname.startsWith("/admin/products/")) return "تعديل المنتج";
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
