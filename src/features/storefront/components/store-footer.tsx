import Image from "next/image";

export const MANAGEMENT_ATTRIBUTION = "بإدارة المهندس عايد ربايعة";

export function StoreFooter() {
  return (
    <footer className="store-footer">
      <div className="store-footer-inner page-shell">
        <div className="store-footer-identity">
          <Image
            className="store-footer-logo"
            src="/brand/maithaloun-symbol.png"
            alt=""
            width={360}
            height={285}
            sizes="40px"
          />
          <div>
            <p className="store-footer-name">سوق ميثلون</p>
            <p className="store-footer-note">
              توصيل داخل ميثلون · الدفع عند الاستلام
            </p>
          </div>
        </div>
        <p className="store-footer-attribution">{MANAGEMENT_ATTRIBUTION}</p>
      </div>
    </footer>
  );
}
