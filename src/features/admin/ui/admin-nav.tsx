"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Settings,
  ShoppingBag,
  Store,
  X,
} from "lucide-react";
import { useEffect, useId, useState, type ComponentType } from "react";

import { logoutAction } from "@/features/admin/application/admin-actions";

const links = [
  {
    href: "/admin",
    label: "لوحة المتابعة",
    match: "exact" as const,
    Icon: LayoutDashboard,
  },
  {
    href: "/admin/orders",
    label: "الطلبات",
    match: "prefix" as const,
    Icon: ShoppingBag,
  },
  {
    href: "/admin/products",
    label: "المنتجات",
    match: "prefix" as const,
    Icon: Package,
  },
  {
    href: "/admin/settings",
    label: "إعدادات المتجر",
    match: "prefix" as const,
    Icon: Settings,
  },
];

function isActive(pathname: string, href: string, match: "exact" | "prefix") {
  if (match === "exact") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLinks({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="تنقل الإدارة" className="admin-nav">
      {links.map((link) => {
        const active = isActive(pathname, link.href, link.match);
        const Icon = link.Icon;
        return (
          <Link
            key={link.href}
            href={link.href}
            prefetch={false}
            className="admin-nav-link"
            aria-current={active ? "page" : undefined}
            onClick={onNavigate}
          >
            <Icon size={18} aria-hidden="true" />
            <span>{link.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function NavFooter({ displayName }: { displayName: string }) {
  return (
    <div className="admin-nav-footer">
      <p className="admin-nav-user">{displayName}</p>
      <Link
        href="/"
        prefetch={false}
        className="admin-nav-link admin-nav-link-secondary"
      >
        <Store size={18} aria-hidden="true" />
        <span>العودة إلى المتجر</span>
      </Link>
      <form action={logoutAction}>
        <button
          type="submit"
          className="admin-nav-link admin-nav-link-secondary"
        >
          <LogOut size={18} aria-hidden="true" />
          <span>تسجيل الخروج</span>
        </button>
      </form>
    </div>
  );
}

export function AdminBrand({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={
        compact ? "admin-sidebar-brand is-compact" : "admin-sidebar-brand"
      }
    >
      <span className="admin-sidebar-brand-mark" aria-hidden="true">
        م
      </span>
      <div>
        <p className="admin-sidebar-brand-title">إدارة سوق ميثلون</p>
        {!compact ? (
          <p className="admin-sidebar-brand-subtitle">لوحة المالك</p>
        ) : null}
      </div>
    </div>
  );
}

export function AdminDesktopNav({ displayName }: { displayName: string }) {
  const pathname = usePathname();
  return (
    <div className="admin-nav-desktop">
      <NavLinks pathname={pathname} />
      <NavFooter displayName={displayName} />
    </div>
  );
}

export function AdminMobileNav({ displayName }: { displayName: string }) {
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

  return (
    <>
      <button
        type="button"
        className="admin-nav-menu-button"
        aria-expanded={open}
        aria-controls={drawerId}
        onClick={() => setOpen((value) => !value)}
      >
        <Menu size={20} aria-hidden="true" />
        <span>القائمة</span>
      </button>

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
            <div className="admin-nav-drawer-header">
              <AdminBrand />
              <button
                type="button"
                className="admin-btn admin-btn-ghost admin-btn-icon"
                onClick={() => setOpen(false)}
                aria-label="إغلاق"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>
            <NavLinks pathname={pathname} onNavigate={() => setOpen(false)} />
            <NavFooter displayName={displayName} />
          </div>
        </div>
      ) : null}
    </>
  );
}

export type AdminNavIcon = ComponentType<{
  size?: number;
  "aria-hidden"?: boolean | "true";
}>;
