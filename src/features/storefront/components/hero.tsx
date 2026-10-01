import { ChevronLeft, Truck, WalletCards } from "lucide-react";
import { getImageProps } from "next/image";

const common = { alt: "", quality: 75 };

export function Hero() {
  const {
    props: { srcSet: wide },
  } = getImageProps({
    ...common,
    src: "/assets/hero/home-wide.webp",
    width: 1600,
    height: 703,
    sizes: "(min-width: 75rem) 1152px, calc(100vw - 3rem)",
  });
  const {
    props: { srcSet: narrow, ...image },
  } = getImageProps({
    ...common,
    src: "/assets/hero/home-narrow.webp",
    width: 960,
    height: 600,
    sizes: "calc(100vw - 2rem)",
  });

  return (
    <section className="hero" aria-labelledby="hero-title">
      <picture className="hero-media">
        <source
          media="(min-width: 48rem)"
          srcSet={wide}
          sizes="(min-width: 75rem) 1152px, calc(100vw - 3rem)"
          width={1600}
          height={703}
        />
        <img
          {...image}
          srcSet={narrow}
          alt=""
          loading="eager"
          fetchPriority="high"
        />
      </picture>
      <div className="hero-body">
        <h1 id="hero-title">
          <span>نظافة تريحك…</span>
          <span className="hero-accent">وعطر بتحبه</span>
        </h1>
        <p>كل احتياجات النظافة والعناية بالمنزل في مكان واحد</p>
        <a className="hero-cta" href="#catalog">
          اكتشف المنتجات
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
    </section>
  );
}
