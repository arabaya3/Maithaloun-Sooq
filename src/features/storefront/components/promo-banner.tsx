"use client";

import Image from "next/image";
import { useState } from "react";

const HERO_IMAGE = "/assets/hero/maythalun-1600.webp";
const HERO_FALLBACK = "/assets/hero/maythalun-1280.jpg";

export function PromoBanner() {
  const [source, setSource] = useState(HERO_IMAGE);
  const [failed, setFailed] = useState(false);

  return (
    <section className="promo-banner" aria-labelledby="promo-title">
      <div className="promo-media" aria-hidden="true">
        {failed ? null : (
          <Image
            src={source}
            alt=""
            fill
            priority
            sizes="(max-width: 48rem) 100vw, min(72rem, 100vw)"
            className="promo-photo"
            onError={() => {
              if (source !== HERO_FALLBACK) {
                setSource(HERO_FALLBACK);
                return;
              }
              setFailed(true);
            }}
          />
        )}
        <div className="promo-overlay" />
      </div>
      <div className="promo-copy">
        <h1 id="promo-title">من ميثلون… لبيتك</h1>
        <p>احتياجات النظافة والمنزل بسهولة، مع توصيل محلي.</p>
        <a className="promo-cta" href="#catalog">
          تسوّق المنتجات
        </a>
      </div>
    </section>
  );
}
