import { ChevronLeft, Truck, WalletCards } from "lucide-react";
import { getImageProps } from "next/image";

const bannerSizes = "(min-width: 75rem) 560px, 48vw";
const compactSizes = "46vw";

export function Hero() {
  const {
    props: { srcSet: banner },
  } = getImageProps({
    alt: "",
    src: "/assets/hero/home-banner.webp",
    width: 1200,
    height: 617,
    sizes: bannerSizes,
  });
  const {
    props: { srcSet: compact, ...image },
  } = getImageProps({
    alt: "",
    src: "/assets/hero/home-compact.webp",
    width: 640,
    height: 506,
    sizes: compactSizes,
  });

  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-body">
        <h2 id="hero-title">
          <span>أساسيات البيت،</span>
          <span className="hero-accent">أقرب إلك</span>
        </h2>
        <a className="hero-cta" href="#catalog">
          ابدأ التسوق
          <ChevronLeft aria-hidden="true" />
        </a>
        <ul className="hero-facts">
          <li>
            <Truck aria-hidden="true" />
            توصيل داخل ميثلون
          </li>
          <li>
            <WalletCards aria-hidden="true" />
            الدفع عند الاستلام
          </li>
        </ul>
      </div>
      <picture className="hero-media">
        <source
          media="(min-width: 48rem)"
          srcSet={banner}
          sizes={bannerSizes}
          width={1200}
          height={617}
        />
        <img
          {...image}
          srcSet={compact}
          alt=""
          loading="eager"
          fetchPriority="high"
        />
      </picture>
    </section>
  );
}
