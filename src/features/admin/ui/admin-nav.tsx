"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";

import { logoutAction } from "@/features/admin/application/admin-actions";

const links = [
  { href: "/admin", label: "لوحة المتابعة", match: "exact" as const },
  { href: "/admin/orders", label: "الطلبات", match: "prefix" as const },
  { href: "/admin/products", label: "المنتجات", match: "prefix" as const },
  {
    href: "/admin/settings",
    label: "إعدادات المتجر",
    match: "prefix" as const,
  },
];

function isActive(pathname: string, href: string, match: "exact" | "prefix") {
  if (match === "exact") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminNav({
  displayName,
  variant,
}: {
  displayName: string;
  variant: "desktop" | "mobile";
}) {
  const pathname = usePathname();
  const drawerId = useId();
  const [open, setOpen] = useState(false);
  const [navPath, setNavPath] = useState(pathname);
  if (navPath !== pathname) {
    setNavPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  const nav = (
    <nav aria-label="تنقل الإدارة" className="admin-nav">
      {links.map((link) => {
        const active = isActive(pathname, link.href, link.match);
        return (
          <Link
            key={link.href}
            href={link.href}
            prefetch={false}
            aria-current={active ? "page" : undefined}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );

  if (variant === "desktop") {
    return (
      <div className="admin-nav-desktop">
        <p className="admin-nav-user">{displayName}</p>
        {nav}
        <form action={logoutAction}>
          <button type="submit">تسجيل الخروج</button>
        </form>
      </div>
    );
  }

  return (
    <>
      <div className="admin-nav-mobile-bar">
        <p className="admin-nav-user">{displayName}</p>
        <button
          type="button"
          className="admin-nav-menu-button"
          aria-expanded={open}
          aria-controls={drawerId}
          onClick={() => setOpen((value) => !value)}
        >
          القائمة
        </button>
      </div>

      {open ? (
        <div
          className="admin-nav-drawer-backdrop"
          onClick={() => setOpen(false)}
        >
          <div
            id={drawerId}
            className="admin-nav-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="قائمة الإدارة"
            onClick={(event) => event.stopPropagation()}
          >
            {nav}
            <form action={logoutAction}>
              <button type="submit">تسجيل الخروج</button>
            </form>
            <button
              type="button"
              className="admin-nav-drawer-close"
              onClick={() => setOpen(false)}
            >
              إغلاق
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
