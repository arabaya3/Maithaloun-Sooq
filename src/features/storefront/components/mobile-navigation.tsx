"use client";

import { House, LayoutGrid, Tag, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const navigation = [
  { href: "/", label: "الرئيسية", icon: House },
  { href: "/categories", label: "الأقسام", icon: LayoutGrid },
  { href: "/offers", label: "العروض", icon: Tag },
  { href: "/account", label: "حسابي", icon: UserRound },
];

export function MobileNavigation() {
  const currentPath = usePathname() ?? "";

  return (
    <nav className="mobile-navigation" aria-label="التنقل الرئيسي للهاتف">
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
