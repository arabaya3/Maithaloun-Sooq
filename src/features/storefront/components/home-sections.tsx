"use client";

import {
  ArrowLeft,
  BadgeCheck,
  Banknote,
  RefreshCcw,
  Truck,
} from "lucide-react";

import { ProductCard } from "@/features/catalog/components/product-card";
import { ProductMedia } from "@/features/catalog/components/product-media";
import {
  localizedCategoryDescription,
  localizedCategoryName,
  type ProductCategory,
} from "@/features/catalog/domain/category";
import type { Product } from "@/features/catalog/domain/product";
import {
  FREE_DELIVERY_THRESHOLD_AGOROT,
  STANDARD_DELIVERY_FEE_AGOROT,
} from "@/features/delivery/delivery-policy";
import {
  brandPath,
  type CatalogBrand,
} from "@/features/storefront/domain/home-merchandising";
import { useI18n } from "@/i18n/i18n-provider";
import { Link } from "@/i18n/link";
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
          <ArrowLeft className="rtl-flip" aria-hidden="true" />
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
  const { m } = useI18n();
  if (brands.length < MIN_BRANDS) return null;
  return (
    <section className="home-section" aria-labelledby="brands-title">
      <SectionHeading
        id="brands-title"
        title={m.store.featuredBrands}
        href="/brands"
        linkLabel={m.store.allBrands}
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
  const { m } = useI18n();
  if (products.length < MIN_BEST_SELLERS) return null;
  return (
    <section className="home-section" aria-labelledby="best-sellers-title">
      <SectionHeading id="best-sellers-title" title={m.store.bestSellers} />
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
  const { m, locale } = useI18n();
  const offer = offerProducts.find((product) => product.image.kind === "image");
  if (!offerProducts.length && !featured) return null;
  const featuredDescription = featured
    ? localizedCategoryDescription(featured.category, locale)
    : null;
  return (
    <section className="promo-grid" aria-label={m.store.offersAndCategories}>
      {offerProducts.length ? (
        <article className="promo promo-dark">
          <div className="promo-body">
            <h2>{m.store.currentOffers}</h2>
            <p>{m.store.offerCount(offerProducts.length)}</p>
            <Link href="/offers" className="promo-cta">
              {m.store.shopOffers}
              <ArrowLeft className="rtl-flip" aria-hidden="true" />
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
            <h2>{localizedCategoryName(featured.category, locale)}</h2>
            {featuredDescription ? <p>{featuredDescription}</p> : null}
            <Link
              href={`/categories/${encodeURIComponent(featured.category.code)}`}
              className="promo-cta"
            >
              {m.store.shopCategory}
              <ArrowLeft className="rtl-flip" aria-hidden="true" />
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
  const { m } = useI18n();
  const benefits = [
    {
      icon: BadgeCheck,
      title: m.common.genuineProducts,
      text: m.store.benefitGenuineText,
    },
    {
      icon: Truck,
      title: m.common.deliveryInMaythalun,
      text: m.store.benefitDeliveryText(
        formatIls(FREE_DELIVERY_THRESHOLD_AGOROT),
        formatIls(STANDARD_DELIVERY_FEE_AGOROT),
      ),
    },
    {
      icon: Banknote,
      title: m.common.cashOnDelivery,
      text: m.store.benefitCash,
    },
    {
      icon: RefreshCcw,
      title: m.store.benefitReplace,
      text: m.store.benefitReplaceText,
    },
  ];
  return (
    <section className="store-benefits" aria-label={m.store.whyStore}>
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
