import type { Metadata } from "next";

import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { PageHeader } from "@/features/admin/ui/kit";
import { socialService } from "@/features/social/application/social-instance";
import {
  mascotLibrary,
  mascotPoseIds,
  type MascotPoseStatus,
} from "@/features/social/domain/mascot";
import { brand } from "@/features/social/infrastructure/render/brand";
import { SocialNav } from "@/features/social/ui/social-ui";
import { formatIls } from "@/shared/lib/format-currency";

export const metadata: Metadata = { title: "فيسبوك — هوية مايثا" };

const statusLabels: Record<MascotPoseStatus, string> = {
  approved: "معتمدة بحجمها الكامل",
  small_only: "صغيرة فقط (لا تُكبَّر)",
  blocked: "موقوفة للمراجعة",
  artwork_required: "تحتاج رسماً",
};

const colorNames: Record<keyof typeof brand, string> = {
  green: "الأخضر الأساسي",
  greenDeep: "أخضر غامق",
  greenTint: "أخضر فاتح",
  sage: "مريمية",
  canvas: "الخلفية",
  surface: "أبيض البطاقات",
  sand: "رملي",
  text: "النص",
  muted: "نص ثانوي",
  amber: "زر الطلب",
  amberTint: "عنبري فاتح",
};

const logos = [
  ["/brand/logo/maytha-logo-512-v5.png", "الشعار"],
  ["/brand/logo/maytha-mark-v5.png", "العلامة"],
  ["/brand/kit/maytha-mark-transparent.png", "العلامة بخلفية شفافة"],
  ["/brand/kit/maytha-whatsapp-profile.png", "صورة واتساب"],
] as const;

/** What every creative is built from: Meetho's approved art, the logo, the colours and the rules. */
export default async function SocialBrandPage() {
  await requireAdminSession();
  const { origin, store } = await socialService.brandFacts();
  return (
    <main className="admin-page">
      <PageHeader
        title="هوية مايثا"
        lede="ميثو والشعار والألوان والقواعد اللي بتتبعها كل حملة. التصاميم تستعمل الوضعيات المعتمدة فقط."
      />
      <SocialNav current="/admin/social/brand" />

      <section className="admin-panel" aria-labelledby="poses-title">
        <h2 id="poses-title">ميثو</h2>
        <ul className="social-assets">
          {mascotPoseIds.map((pose) => {
            const info = mascotLibrary[pose];
            const hasArt = info.sourceHeight !== null;
            return (
              <li key={pose} className="social-asset">
                {hasArt ? (
                  // eslint-disable-next-line @next/next/no-img-element -- admin-only artwork route
                  <img
                    src={`/admin/api/social/mascot/${pose}`}
                    alt={info.labelAr}
                    loading="lazy"
                  />
                ) : (
                  <span className="social-asset-missing">لا رسمة بعد</span>
                )}
                <strong>{info.labelAr}</strong>
                <span
                  className={`social-asset-status social-asset-status--${info.status}`}
                >
                  {statusLabels[info.status]}
                  {info.sourceHeight ? ` · ${info.sourceHeight}px` : ""}
                </span>
                {info.note ? (
                  <small className="admin-muted">{info.note}</small>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="admin-panel" aria-labelledby="logos-title">
        <h2 id="logos-title">الشعار</h2>
        <ul className="social-assets">
          {logos.map(([src, label]) => (
            <li key={src} className="social-asset">
              {/* eslint-disable-next-line @next/next/no-img-element -- static brand file */}
              <img src={src} alt={label} loading="lazy" />
              <a href={src} download>
                {label}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="admin-panel" aria-labelledby="colors-title">
        <h2 id="colors-title">الألوان</h2>
        <ul className="social-swatches">
          {(Object.keys(brand) as Array<keyof typeof brand>).map((key) => (
            <li key={key}>
              <span
                className="social-swatch"
                style={{ background: brand[key] }}
                aria-hidden="true"
              />
              {colorNames[key]} <bdi dir="ltr">{brand[key]}</bdi>
            </li>
          ))}
        </ul>
      </section>

      <section className="admin-panel" aria-labelledby="rules-title">
        <h2 id="rules-title">قواعد كل تصميم</h2>
        <ul className="admin-line-list">
          <li>ميثو موجود بكل حملة، بوضعية معتمدة فقط وبدون تكبير فوق حجمها.</li>
          <li>كل منتج وسعر ومجموع من كتالوج المتجر اليوم.</li>
          <li>
            التوصيل داخل {store.deliveryAreaAr} فقط: مجاني من{" "}
            {formatIls(store.freeDeliveryFromAgorot)}، وتحت هيك{" "}
            {formatIls(store.deliveryFeeAgorot)}
            {store.cashOnDelivery ? "، والدفع عند الاستلام" : ""}.
          </li>
          <li>
            بدون خصومات أو عروض أو مقارنات أو ادعاءات تحتاج إثبات، وبدون مواد
            غذائية أو أغراض حيوانات.
          </li>
          <li>
            العنوان الرسمي: <bdi dir="ltr">{origin}</bdi>
          </li>
        </ul>
      </section>
    </main>
  );
}
