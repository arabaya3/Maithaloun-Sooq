import Link from "next/link";

import { BrandWordmark } from "./brand-logo";
import { TRUST_LINE } from "./hero";

export const MANAGEMENT_ATTRIBUTION = "بإدارة المهندس عايد ربايعة";

const links = [
  { href: "/categories", label: "الأقسام" },
  { href: "/brands", label: "الماركات" },
  { href: "/offers", label: "العروض" },
  { href: "/favorites", label: "المفضلة" },
  { href: "/account", label: "حسابي" },
  { href: "/cart", label: "السلة" },
];

export function StoreFooter() {
  return (
    <footer className="store-footer">
      <div className="store-footer-inner page-shell">
        <div className="store-footer-identity">
          <BrandWordmark className="store-footer-wordmark" />
          <p className="store-footer-note">{TRUST_LINE}</p>
          <p className="store-footer-note">
            توصيل داخل ميثلون · الدفع عند الاستلام
          </p>
        </div>
        <nav className="store-footer-links" aria-label="روابط المتجر">
          {links.map((link) => (
            <Link key={link.href} href={link.href}>
              {link.label}
            </Link>
          ))}
        </nav>
        <p className="store-footer-attribution">{MANAGEMENT_ATTRIBUTION}</p>
      </div>
    </footer>
  );
}
