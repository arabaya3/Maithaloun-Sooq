"use client";

import { BadgePercent, Heart, House, LayoutGrid, ShoppingBag } from "lucide-react";
import { usePathname } from "next/navigation";

import { useCart } from "@/features/cart/cart-provider";
import { splitLocalePath } from "@/i18n/config";
import { useI18n } from "@/i18n/i18n-provider";
import { Link } from "@/i18n/link";

export function MobileNavigation() {
  const { m } = useI18n();
  const { count } = useCart();
  const currentPath = splitLocalePath(usePathname() ?? "/").path;
  const navigation = [
    { href: "/", label: m.common.home, icon: House },
    { href: "/categories", label: m.common.categories, icon: LayoutGrid },
    { href: "/offers", label: m.common.offers, icon: BadgePercent },
    { href: "/favorites", label: m.common.favorites, icon: Heart },
    { href: "/cart", label: m.common.cart, icon: ShoppingBag },
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
            {item.href === "/cart" ? (
              <span className="cart-icon">
                <Icon aria-hidden="true" />
                {count > 0 ? <span className="cart-count">{count}</span> : null}
              </span>
            ) : (
              <Icon aria-hidden="true" />
            )}
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
