"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  Boxes,
  Camera,
  ChartNoAxesColumn,
  HandCoins,
  Home,
  LogOut,
  MoreHorizontal,
  Package,
  PenLine,
  Plus,
  ReceiptText,
  Sheet as SheetIcon,
  Settings,
  ShoppingBag,
  Store,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

import { logoutAction } from "@/features/admin/application/admin-actions";
import type { AdminRole } from "@/features/admin/domain/admin-actor";
import { Sheet } from "@/shared/ui/sheet";

interface NavLink {
  href: string;
  label: string;
  match: "exact" | "prefix";
  Icon: LucideIcon;
  ownerOnly?: boolean;
}

const primaryLinks: NavLink[] = [
  { href: "/admin", label: "الرئيسية", match: "exact", Icon: Home },
  {
    href: "/admin/orders",
    label: "الطلبات",
    match: "prefix",
    Icon: ShoppingBag,
  },
  { href: "/admin/inventory", label: "المخزون", match: "prefix", Icon: Boxes },
];

const secondaryLinks: NavLink[] = [
  {
    href: "/admin/products",
    label: "المنتجات",
    match: "prefix",
    Icon: Package,
  },
  {
    href: "/admin/sales",
    label: "المبيعات",
    match: "prefix",
    Icon: ReceiptText,
  },
  {
    href: "/admin/customers",
    label: "الزبائن والديون",
    match: "prefix",
    Icon: Users,
  },
  {
    href: "/admin/reports",
    label: "التقارير",
    match: "prefix",
    Icon: ChartNoAxesColumn,
    ownerOnly: true,
  },
  {
    href: "/admin/inventory/suppliers",
    label: "الموردون",
    match: "prefix",
    Icon: Truck,
  },
  {
    href: "/admin/notifications",
    label: "الإشعارات",
    match: "prefix",
    Icon: Bell,
  },
  {
    href: "/admin/settings",
    label: "إعدادات المتجر",
    match: "prefix",
    Icon: Settings,
    ownerOnly: true,
  },
];

interface AddTask {
  href: string;
  label: string;
  hint: string;
  Icon: LucideIcon;
  ownerOnly?: boolean;
}

const addTasks: AddTask[] = [
  {
    href: "/admin/inventory/capture",
    label: "تصوير فاتورة شراء",
    hint: "قراءة الأصناف والأسعار من الصورة",
    Icon: ReceiptText,
  },
  {
    href: "/admin/products/new",
    label: "تصوير منتج",
    hint: "قراءة الاسم والحجم من الصورة",
    Icon: Camera,
  },
  {
    href: "/admin/sales/new",
    label: "إدخال بيع يدوي",
    hint: "بيع في المحل نقداً أو على الحساب",
    Icon: HandCoins,
  },
  {
    href: "/admin/inventory/purchases/new",
    label: "إدخال شراء يدوي",
    hint: "فاتورة مورد تُضاف إلى المخزون",
    Icon: PenLine,
  },
  {
    href: "/admin/inventory/import",
    label: "رفع Excel",
    hint: "فاتورة شراء من ملف xlsx أو csv",
    Icon: SheetIcon,
    ownerOnly: true,
  },
];

function visible<T extends { ownerOnly?: boolean }>(
  items: T[],
  role: AdminRole,
): T[] {
  return items.filter((item) => !item.ownerOnly || role === "owner");
}

function isActive(pathname: string, link: NavLink): boolean {
  if (link.match === "exact") return pathname === link.href;
  if (pathname !== link.href && !pathname.startsWith(`${link.href}/`)) {
    return false;
  }
  // A more specific destination (الموردون) wins over its parent (المخزون).
  return ![...primaryLinks, ...secondaryLinks].some(
    (other) =>
      other.href.length > link.href.length &&
      other.href.startsWith(`${link.href}/`) &&
      (pathname === other.href || pathname.startsWith(`${other.href}/`)),
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
          <p className="admin-sidebar-brand-subtitle">الطلبات والمخزون</p>
        ) : null}
      </div>
    </div>
  );
}

export function AdminDesktopNav({
  displayName,
  role,
}: {
  displayName: string;
  role: AdminRole;
}) {
  const pathname = usePathname();
  return (
    <div className="admin-nav-desktop">
      <nav aria-label="تنقل الإدارة" className="admin-nav">
        {visible([...primaryLinks, ...secondaryLinks], role).map((link) => (
          <Link
            key={link.href}
            href={link.href}
            prefetch={false}
            className="admin-nav-link"
            aria-current={isActive(pathname, link) ? "page" : undefined}
          >
            <link.Icon size={18} aria-hidden="true" />
            <span>{link.label}</span>
          </Link>
        ))}
      </nav>
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
    </div>
  );
}

export function AdminBottomNav({
  displayName,
  role,
}: {
  displayName: string;
  role: AdminRole;
}) {
  const pathname = usePathname();
  const [sheet, setSheet] = useState<"add" | "more" | null>(null);
  const [sheetPath, setSheetPath] = useState(pathname);
  if (sheetPath !== pathname) {
    setSheetPath(pathname);
    setSheet(null);
  }
  const moreActive = visible(secondaryLinks, role).some((link) =>
    isActive(pathname, link),
  );

  return (
    <>
      <nav className="admin-bottom-nav" aria-label="التنقل السفلي">
        {primaryLinks.map((link) => (
          <BottomLink key={link.href} link={link} pathname={pathname} />
        ))}
        <button
          type="button"
          className="admin-bottom-nav-item admin-bottom-nav-add"
          aria-haspopup="dialog"
          onClick={() => setSheet("add")}
        >
          <span className="admin-bottom-nav-add-mark" aria-hidden="true">
            <Plus size={22} />
          </span>
          <span>إضافة</span>
        </button>
        <button
          type="button"
          className="admin-bottom-nav-item"
          aria-haspopup="dialog"
          data-active={moreActive || undefined}
          onClick={() => setSheet("more")}
        >
          <MoreHorizontal size={22} aria-hidden="true" />
          <span>المزيد</span>
        </button>
      </nav>

      <Sheet
        open={sheet === "add"}
        onClose={() => setSheet(null)}
        title="ماذا تريدين أن تضيفي؟"
      >
        <ul className="admin-task-sheet">
          {visible(addTasks, role).map((task) => (
            <li key={task.href}>
              <Link href={task.href} prefetch={false}>
                <task.Icon size={22} aria-hidden="true" />
                <span>
                  <strong>{task.label}</strong>
                  <small>{task.hint}</small>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Sheet>

      <Sheet
        open={sheet === "more"}
        onClose={() => setSheet(null)}
        title="المزيد"
      >
        <ul className="admin-more-sheet">
          {visible(secondaryLinks, role).map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                prefetch={false}
                aria-current={isActive(pathname, link) ? "page" : undefined}
              >
                <link.Icon size={20} aria-hidden="true" />
                <span>{link.label}</span>
              </Link>
            </li>
          ))}
          <li>
            <Link href="/" prefetch={false}>
              <Store size={20} aria-hidden="true" />
              <span>العودة إلى المتجر</span>
            </Link>
          </li>
          <li>
            <form action={logoutAction}>
              <button type="submit">
                <LogOut size={20} aria-hidden="true" />
                <span>تسجيل الخروج</span>
              </button>
            </form>
          </li>
        </ul>
        <p className="admin-more-user">{displayName}</p>
      </Sheet>
    </>
  );
}

function BottomLink({ link, pathname }: { link: NavLink; pathname: string }) {
  return (
    <Link
      href={link.href}
      prefetch={false}
      className="admin-bottom-nav-item"
      aria-current={isActive(pathname, link) ? "page" : undefined}
    >
      <link.Icon size={22} aria-hidden="true" />
      <span>{link.label}</span>
    </Link>
  );
}
