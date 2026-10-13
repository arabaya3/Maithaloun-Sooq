import {
  ArrowLeft,
  BadgeCheck,
  Banknote,
  RefreshCcw,
  Truck,
} from "lucide-react";
import Link from "next/link";

import { ProductCard } from "@/features/catalog/components/product-card";
import { ProductMedia } from "@/features/catalog/components/product-media";
import type { ProductCategory } from "@/features/catalog/domain/category";
import type { Product } from "@/features/catalog/domain/product";
import {
  FREE_DELIVERY_THRESHOLD_AGOROT,
  STANDARD_DELIVERY_FEE_AGOROT,
} from "@/features/delivery/delivery-policy";
import {
  brandPath,
  type CatalogBrand,
} from "@/features/storefront/domain/home-merchandising";
import { formatIls } from "@/shared/lib/format-currency";

// Fewer than this and the row would look empty, so it is not shown.
export const MIN_BRANDS = 3;
export const MIN_BEST_SELLERS = 4;

function SectionHeading({
  id,
  title,
  href,
  linkLabel,
}: {
  id: string;
  title: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="home-section-heading">
      <h2 id={id}>{title}</h2>
      {href && linkLabel ? (
        <Link href={href} className="home-section-link">
          {linkLabel}
          <ArrowLeft aria-hidden="true" />
        </Link>
      ) : null}
    </div>
  );
}

export function FeaturedBrands({
  brands,
}: {
  brands: readonly CatalogBrand[];
}) {
  if (brands.length < MIN_BRANDS) return null;
  return (
    <section className="home-section" aria-labelledby="brands-title">
      <SectionHeading
        id="brands-title"
        title="ماركات مختارة"
        href="/brands"
        linkLabel="كل الماركات"
      />
      <ul className="brand-row">
        {brands.slice(0, 8).map((brand) => (
          <li key={brand.name}>
            <Link href={brandPath(brand.name)} className="brand-tile">
              <bdi dir="auto">{brand.name}</bdi>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function BestSellers({ products }: { products: readonly Product[] }) {
  if (products.length < MIN_BEST_SELLERS) return null;
  return (
    <section className="home-section" aria-labelledby="best-sellers-title">
      <SectionHeading id="best-sellers-title" title="الأكثر طلباً" />
      <div className="product-rail">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </section>
  );
}

export function PromoBanners({
  offerProducts,
  featured,
}: {
  offerProducts: readonly Product[];
  featured: { category: ProductCategory; product: Product | null } | null;
}) {
  const offer = offerProducts.find((product) => product.image.kind === "image");
  if (!offerProducts.length && !featured) return null;
  return (
    <section className="promo-grid" aria-label="عروض وأقسام مختارة">
      {offerProducts.length ? (
        <article className="promo promo-dark">
          <div className="promo-body">
            <h2>عروض حالية</h2>
            <p>
              {offerProducts.length === 1
                ? "منتج عليه عرض الآن"
                : `${offerProducts.length} منتجات عليها عروض الآن`}
            </p>
            <Link href="/offers" className="promo-cta">
              تسوّق العروض
              <ArrowLeft aria-hidden="true" />
            </Link>
          </div>
          {offer ? (
            <ProductMedia
              product={offer}
              className="promo-image"
              sizes="(min-width: 48rem) 220px, 40vw"
            />
          ) : null}
        </article>
      ) : null}
      {featured ? (
        <article className="promo promo-light">
          <div className="promo-body">
            <h2>{featured.category.nameAr}</h2>
            {featured.category.description ? (
              <p>{featured.category.description}</p>
            ) : null}
            <Link
              href={`/categories/${encodeURIComponent(featured.category.code)}`}
              className="promo-cta"
            >
              تسوّق القسم
              <ArrowLeft aria-hidden="true" />
            </Link>
          </div>
          {featured.product ? (
            <ProductMedia
              product={featured.product}
              className="promo-image"
              sizes="(min-width: 48rem) 220px, 40vw"
            />
          ) : null}
        </article>
      ) : null}
    </section>
  );
}

export function StoreBenefits() {
  const benefits = [
    { icon: BadgeCheck, title: "منتجات أصلية", text: "من ماركات بتعرفها" },
    {
      icon: Truck,
      title: "توصيل داخل ميثلون",
      text: `مجاني من ${formatIls(FREE_DELIVERY_THRESHOLD_AGOROT)}، وإلا ${formatIls(STANDARD_DELIVERY_FEE_AGOROT)}`,
    },
    { icon: Banknote, title: "الدفع عند الاستلام", text: "نقداً عند التوصيل" },
    {
      icon: RefreshCcw,
      title: "استبدال التالف أو الخاطئ",
      text: "إذا وصلك منتج تالف أو غير المطلوب",
    },
  ];
  return (
    <section className="store-benefits" aria-label="لماذا MAYTHA">
      <ul>
        {benefits.map(({ icon: Icon, title, text }) => (
          <li key={title}>
            <Icon aria-hidden="true" />
            <span>
              <strong>{title}</strong>
              <small>{text}</small>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
