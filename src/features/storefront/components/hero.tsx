"use client";

import { ArrowLeft, BadgeCheck, Banknote, Truck } from "lucide-react";

import { ProductMedia } from "@/features/catalog/components/product-media";
import type { Product } from "@/features/catalog/domain/product";
import { useI18n } from "@/i18n/i18n-provider";

export function Hero({ products }: { products: readonly Product[] }) {
  const { m } = useI18n();
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-body">
        <p className="hero-eyebrow" dir="ltr">
          MAYTHA
        </p>
        <h1 id="hero-title">{m.store.heroTitle}</h1>
        <p className="hero-lead">{m.common.trustLine}</p>
        <a className="hero-cta" href="#catalog">
          {m.store.shopNow}
          <ArrowLeft className="rtl-flip" aria-hidden="true" />
        </a>
        <ul className="hero-facts">
          <li>
            <BadgeCheck aria-hidden="true" />
            {m.common.trustedBrands}
          </li>
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
        <div
          className="hero-media"
          data-count={products.length}
          aria-hidden="true"
        >
          {products.map((product, index) => (
            <ProductMedia
              key={product.id}
              product={product}
              className="hero-product"
              sizes={
                index === 0
                  ? "(min-width: 64rem) 320px, 40vw"
                  : "(min-width: 64rem) 200px, 26vw"
              }
              priority={index === 0}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
