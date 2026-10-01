import { ChevronLeft, Truck, WalletCards } from "lucide-react";

export function Hero() {
  return (
    <section className="hero" aria-labelledby="hero-title">
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
    </section>
  );
}
