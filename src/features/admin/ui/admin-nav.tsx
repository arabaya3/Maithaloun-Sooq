"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  Boxes,
  Camera,
  ChartNoAxesColumn,
  ChevronDown,
  ClipboardCheck,
  HandCoins,
  House,
  LogOut,
  Mic,
  MoreHorizontal,
  Package,
  PenLine,
  Plus,
  ReceiptText,
  Search,
  Settings,
  Sheet as SheetIcon,
  ShoppingBag,
  Store,
  Tags,
  ScrollText,
  BadgePercent,
  Truck,
  Users,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import { useState, useSyncExternalStore } from "react";

import { logoutAction } from "@/features/admin/application/admin-actions";
import type { AdminRole } from "@/features/admin/domain/admin-actor";
import { Sheet } from "@/shared/ui/sheet";

import { AdminGlobalSearch } from "./admin-global-search";

const noSubscription = () => () => {};

// Sheet buttons only work once React has attached their handlers; until then they say so instead of swallowing a tap.
function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}

interface NavLink {
  href: string;
  label: string;
  match: "exact" | "prefix";
  Icon: LucideIcon;
  ownerOnly?: boolean;
}

type GroupKey = "today" | "sell" | "stock" | "catalog" | "manage";

interface NavGroup {
  key: GroupKey;
  label: string;
  /** The bottom-navigation name; «الإدارة» is the «المزيد» tab on the phone. */
  tabLabel: string;
  Icon: LucideIcon;
  links: NavLink[];
}

// The five areas of the redesign: اليوم، البيع، المخزون، الكتالوج، الإدارة.
const groups: NavGroup[] = [
  {
    key: "today",
    label: "اليوم",
    tabLabel: "اليوم",
    Icon: House,
    links: [{ href: "/admin", label: "اليوم", match: "exact", Icon: House }],
  },
  {
    key: "sell",
    label: "البيع",
    tabLabel: "البيع",
    Icon: ShoppingBag,
    links: [
      {
        href: "/admin/orders",
        label: "الطلبات",
        match: "prefix",
        Icon: ShoppingBag,
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
    ],
  },
  {
    key: "stock",
    label: "المخزون",
    tabLabel: "المخزون",
    Icon: Boxes,
    links: [
      {
        href: "/admin/inventory",
        label: "المخزون",
        match: "prefix",
        Icon: Boxes,
      },
      {
        href: "/admin/inventory/purchases",
        label: "فواتير الشراء",
        match: "prefix",
        Icon: Warehouse,
      },
      {
        href: "/admin/inventory/capture",
        label: "تصوير فاتورة شراء",
        match: "prefix",
        Icon: Camera,
      },
      {
        href: "/admin/inventory/import",
        label: "رفع Excel",
        match: "prefix",
        Icon: SheetIcon,
        ownerOnly: true,
      },
      {
        href: "/admin/inventory/price-reviews",
        label: "مراجعة أسعار البيع",
        match: "prefix",
        Icon: ClipboardCheck,
        ownerOnly: true,
      },
      {
        href: "/admin/inventory/suppliers",
        label: "الموردون",
        match: "prefix",
        Icon: Truck,
      },
    ],
  },
  {
    key: "catalog",
    label: "الكتالوج",
    tabLabel: "الكتالوج",
    Icon: Package,
    links: [
      {
        href: "/admin/products",
        label: "المنتجات",
        match: "prefix",
        Icon: Package,
      },
      {
        href: "/admin/categories",
        label: "الأقسام",
        match: "prefix",
        Icon: Tags,
        ownerOnly: true,
      },
      {
        href: "/admin/offers",
        label: "العروض",
        match: "prefix",
        Icon: BadgePercent,
        ownerOnly: true,
      },
    ],
  },
  {
    key: "manage",
    label: "الإدارة",
    tabLabel: "المزيد",
    Icon: MoreHorizontal,
    links: [
      {
        href: "/admin/reports",
        label: "التقارير",
        match: "prefix",
        Icon: ChartNoAxesColumn,
        ownerOnly: true,
      },
      {
        href: "/admin/notifications",
        label: "الإشعارات",
        match: "prefix",
        Icon: Bell,
      },
      {
        href: "/admin/voice",
        label: "تسجيل عملية بالصوت",
        match: "prefix",
        Icon: Mic,
      },
      {
        href: "/admin/settings",
        label: "إعدادات المتجر",
        match: "prefix",
        Icon: Settings,
        ownerOnly: true,
      },
      {
        href: "/admin/audit",
        label: "سجل التدقيق",
        match: "prefix",
        Icon: ScrollText,
        ownerOnly: true,
      },
    ],
  },
];

const allLinks = groups.flatMap((group) => group.links);

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
    href: "/admin/products/new/photo",
    label: "تصوير منتج",
    hint: "قراءة الاسم والحجم من الصورة",
    Icon: Camera,
  },
  {
    href: "/admin/voice",
    label: "تسجيل عملية بالصوت",
    hint: "بيع، دفعة، أو سؤال عن الربح والديون",
    Icon: Mic,
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
  return !allLinks.some(
    (other) =>
      other.href.length > link.href.length &&
      other.href.startsWith(`${link.href}/`) &&
      (pathname === other.href || pathname.startsWith(`${other.href}/`)),
  );
}

function groupActive(pathname: string, group: NavGroup): boolean {
  return group.links.some((link) => isActive(pathname, link));
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
        <p className="admin-sidebar-brand-title">سوق ميثلون</p>
        {!compact ? (
          <p className="admin-sidebar-brand-subtitle">إدارة المتجر</p>
        ) : null}
      </div>
    </div>
  );
}

function SidebarLink({ link, pathname }: { link: NavLink; pathname: string }) {
  return (
    <Link
      href={link.href}
      prefetch={false}
      className="admin-nav-link"
      aria-current={isActive(pathname, link) ? "page" : undefined}
    >
      <link.Icon size={18} aria-hidden="true" />
      <span>{link.label}</span>
    </Link>
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
        {groups.map((group) => {
          const links = visible(group.links, role);
          if (!links.length) return null;
          if (group.key === "today") {
            return (
              <SidebarLink key="today" link={links[0]!} pathname={pathname} />
            );
          }
          if (group.key === "manage") {
            return (
              <details
                key={group.key}
                className="admin-nav-group admin-nav-group-expandable"
                open={groupActive(pathname, group) || undefined}
              >
                <summary className="admin-nav-group-label">
                  <span>{group.label}</span>
                  <ChevronDown size={16} aria-hidden="true" />
                </summary>
                {links.map((link) => (
                  <SidebarLink
                    key={link.href}
                    link={link}
                    pathname={pathname}
                  />
                ))}
              </details>
            );
          }
          return (
            <div key={group.key} className="admin-nav-group">
              <p className="admin-nav-group-label">{group.label}</p>
              {links.map((link) => (
                <SidebarLink key={link.href} link={link} pathname={pathname} />
              ))}
            </div>
          );
        })}
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

/** The phone header: brand, the «إضافة» task sheet and notifications. */
export function AdminMobileHeader({ role }: { role: AdminRole }) {
  const pathname = usePathname();
  const hydrated = useHydrated();
  const [open, setOpen] = useState<"add" | "search" | null>(null);
  const [openedAt, setOpenedAt] = useState(pathname);
  if (openedAt !== pathname) {
    setOpenedAt(pathname);
    setOpen(null);
  }
  return (
    <header className="admin-mobile-header">
      <AdminBrand compact />
      <div className="admin-mobile-header-actions">
        <button
          type="button"
          className="admin-mobile-header-action"
          aria-haspopup="dialog"
          aria-label="بحث"
          disabled={!hydrated}
          onClick={() => setOpen("search")}
        >
          <Search size={20} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="admin-mobile-header-action is-primary"
          aria-haspopup="dialog"
          aria-label="إضافة"
          disabled={!hydrated}
          onClick={() => setOpen("add")}
        >
          <Plus size={22} aria-hidden="true" />
        </button>
        <Link
          href="/admin/notifications"
          prefetch={false}
          className="admin-mobile-header-action"
          aria-label="الإشعارات"
        >
          <Bell size={20} aria-hidden="true" />
        </Link>
      </div>
      <Sheet
        open={open === "search"}
        onClose={() => setOpen(null)}
        title="بحث في المتجر"
      >
        {/* Mounted only while open, so the page never holds two search boxes. */}
        {open === "search" ? (
          <AdminGlobalSearch autoFocus onNavigate={() => setOpen(null)} />
        ) : null}
      </Sheet>
      <Sheet
        open={open === "add"}
        onClose={() => setOpen(null)}
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
    </header>
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
  const [sheet, setSheet] = useState<GroupKey | null>(null);
  const hydrated = useHydrated();
  const [sheetPath, setSheetPath] = useState(pathname);
  if (sheetPath !== pathname) {
    setSheetPath(pathname);
    setSheet(null);
  }
  const opened = groups.find((group) => group.key === sheet);

  return (
    <>
      <nav className="admin-bottom-nav" aria-label="التنقل السفلي">
        {groups.map((group) => {
          const links = visible(group.links, role);
          if (!links.length) return null;
          const active = groupActive(pathname, group);
          if (group.key === "today") {
            return (
              <Link
                key="today"
                href="/admin"
                prefetch={false}
                className="admin-bottom-nav-item"
                aria-current={active ? "page" : undefined}
              >
                <group.Icon size={22} aria-hidden="true" />
                <span>{group.tabLabel}</span>
              </Link>
            );
          }
          return (
            <button
              key={group.key}
              type="button"
              className="admin-bottom-nav-item"
              aria-haspopup="dialog"
              data-active={active || undefined}
              disabled={!hydrated}
              onClick={() => setSheet(group.key)}
            >
              <group.Icon size={22} aria-hidden="true" />
              <span>{group.tabLabel}</span>
            </button>
          );
        })}
      </nav>

      <Sheet
        open={Boolean(opened)}
        onClose={() => setSheet(null)}
        title={opened?.tabLabel ?? ""}
      >
        {opened ? (
          <>
            <ul className="admin-more-sheet">
              {visible(opened.links, role).map((link) => (
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
              {opened.key === "manage" ? (
                <>
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
                </>
              ) : null}
            </ul>
            {opened.key === "manage" ? (
              <p className="admin-more-user">{displayName}</p>
            ) : null}
          </>
        ) : null}
      </Sheet>
    </>
  );
}
