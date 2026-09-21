"use client";

import { Grid2X2, Home, ShoppingBasket, Tag, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useCart } from "@/features/cart/cart-provider";
import { formatProductCount } from "@/shared/lib/format-product-count";

const navigation = [
  { href: "/", label: "الرئيسية", icon: Home },
  { href: "/categories", label: "الفئات", icon: Grid2X2 },
  { href: "/cart", label: "السلة", icon: ShoppingBasket },
  { href: "/offers", label: "العروض", icon: Tag },
  { href: "/account", label: "حسابي", icon: UserRound },
];

export function MobileNavigation() {
  const pathname = usePathname();
  const { count } = useCart();
  const currentPath = pathname ?? "";

  return (
    <nav className="mobile-navigation" aria-label="التنقل الرئيسي للهاتف">
      {navigation.map((item) => {
        const Icon = item.icon;
        const isCurrent =
          item.href === "/"
            ? currentPath === "/"
            : currentPath.startsWith(item.href);
        const accessibleLabel =
          item.href === "/cart"
            ? `${item.label}، ${formatProductCount(count)}`
            : item.label;

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-label={accessibleLabel}
            aria-current={isCurrent ? "page" : undefined}
          >
            <span className="mobile-nav-icon">
              <Icon aria-hidden="true" />
              {item.href === "/cart" && count > 0 ? (
                <span className="mobile-nav-badge" aria-hidden="true">
                  {count}
                </span>
              ) : null}
            </span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
