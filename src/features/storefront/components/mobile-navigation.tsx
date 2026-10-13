"use client";

import { BadgePercent, House, LayoutGrid, UserRound } from "lucide-react";
import { usePathname } from "next/navigation";

import { splitLocalePath } from "@/i18n/config";
import { useI18n } from "@/i18n/i18n-provider";
import { Link } from "@/i18n/link";

export function MobileNavigation() {
  const { m } = useI18n();
  const currentPath = splitLocalePath(usePathname() ?? "/").path;
  const navigation = [
    { href: "/", label: m.common.home, icon: House },
    { href: "/categories", label: m.common.categories, icon: LayoutGrid },
    { href: "/offers", label: m.common.offers, icon: BadgePercent },
    { href: "/account", label: m.common.account, icon: UserRound },
  ];

  return (
    <nav className="mobile-navigation" aria-label={m.store.mobileNavigation}>
      {navigation.map((item) => {
        const Icon = item.icon;
        const isCurrent =
          item.href === "/"
            ? currentPath === "/"
            : currentPath.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isCurrent ? "page" : undefined}
          >
            <Icon aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
