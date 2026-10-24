"use client";

import { ArrowLeft, Banknote, Truck } from "lucide-react";
import Image from "next/image";

import { ProductMedia } from "@/features/catalog/components/product-media";
import {
  localizedProductName,
  type Product,
} from "@/features/catalog/domain/product";
import { useI18n } from "@/i18n/i18n-provider";
import { Link } from "@/i18n/link";

// Unsplash photo by PlanetCare, cropped only; see docs/brand-assets.md.
const HERO_PHOTO = "/assets/lifestyle/laundry-room.webp";

export function Hero({ products }: { products: readonly Product[] }) {
  const { m, locale } = useI18n();
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-photo">
        <Image
          src={HERO_PHOTO}
          alt=""
          fill
          priority
          sizes="(min-width: 64rem) 600px, (min-width: 48rem) 48vw, 100vw"
        />
      </div>
      <div className="hero-body">
        <p className="hero-eyebrow" dir="ltr">
          MAYTHA MARKET
        </p>
        <h1 id="hero-title">{m.store.heroTitle}</h1>
        <p className="hero-lead">{m.common.trustLine}</p>
        <a className="hero-cta" href="#catalog">
          {m.store.shopNow}
          <ArrowLeft className="rtl-flip" aria-hidden="true" />
        </a>
        <ul className="hero-facts">
          <li>
            <Truck aria-hidden="true" />
            {m.common.deliveryInMaythalun}
          </li>
          <li>
            <Banknote aria-hidden="true" />
            {m.common.cashOnDelivery}
          </li>
        </ul>
      </div>
      {products.length ? (
        <div className="hero-shelf" data-count={products.length}>
          <p className="hero-shelf-label" id="hero-shelf-label">
            {m.store.heroPicks}
          </p>
          <ul className="hero-picks" aria-labelledby="hero-shelf-label">
            {products.map((product) => (
              <li key={product.id}>
                <Link
                  href={`/products/${product.slug}`}
                  className="hero-pick"
                  aria-label={localizedProductName(product, locale)}
                >
                  <ProductMedia
                    product={product}
                    className="hero-pick-image"
                    sizes="(min-width: 48rem) 120px, 28vw"
                  />
                  {product.brand ? (
                    <bdi
                      dir="auto"
                      className="hero-pick-brand"
                      aria-hidden="true"
                    >
                      {product.brand}
                    </bdi>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
