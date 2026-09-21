"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { logoutAction } from "@/features/admin/application/admin-actions";

const links = [
  { href: "/admin", label: "لوحة المتابعة", match: "exact" },
  { href: "/admin/orders", label: "الطلبات", match: "prefix" },
  { href: "/admin/products", label: "المنتجات", match: "prefix" },
  { href: "/admin/delivery-areas", label: "مناطق التوصيل", match: "prefix" },
] as const;

export function AdminNav({ displayName }: { displayName: string }) {
  const pathname = usePathname();

  return (
    <div className="admin-nav-panel">
      <p className="admin-nav-user">{displayName}</p>
      <nav aria-label="تنقل الإدارة" className="admin-nav">
        {links.map((link) => {
          const isActive =
            link.match === "exact"
              ? pathname === link.href
              : pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <Link
              key={link.href}
              href={link.href}
              prefetch={false}
              aria-current={isActive ? "page" : undefined}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
      <form action={logoutAction}>
        <button type="submit">تسجيل الخروج</button>
      </form>
    </div>
  );
}
