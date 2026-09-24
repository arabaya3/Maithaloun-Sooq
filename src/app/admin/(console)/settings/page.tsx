import type { Metadata } from "next";
import { connection } from "next/server";

import { adminDeliveryService } from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { DeliveryAreaForm } from "@/features/admin/ui/delivery-area-form";
import {
  ACTIVE_SERVICE_AREA_CODE,
  ACTIVE_SERVICE_AREA_NAME_AR,
  FREE_DELIVERY_THRESHOLD_AGOROT,
  STANDARD_DELIVERY_FEE_AGOROT,
} from "@/features/delivery/delivery-policy";
import { formatIls } from "@/shared/lib/format-currency";

export const metadata: Metadata = {
  title: "إعدادات المتجر",
};

export default async function AdminSettingsPage() {
  await connection();
  const actor = await requireAdminSession();
  const areas = await adminDeliveryService.list(actor);
  const active = areas.find((area) => area.code === ACTIVE_SERVICE_AREA_CODE);
  const historical = areas.filter(
    (area) => area.code !== ACTIVE_SERVICE_AREA_CODE,
  );

  return (
    <main className="admin-page">
      <header className="admin-page-header">
        <div>
          <h1>إعدادات المتجر</h1>
          <p className="admin-lede">
            التوصيل حالياً داخل ميثلون فقط وفق سياسة الأسعار الثابتة.
          </p>
        </div>
      </header>

      <section className="admin-panel" aria-labelledby="delivery-policy-title">
        <h2 id="delivery-policy-title">سياسة التوصيل</h2>
        <dl className="admin-definition-list admin-policy-list">
          <div>
            <dt>منطقة التوصيل النشطة</dt>
            <dd>{ACTIVE_SERVICE_AREA_NAME_AR}</dd>
          </div>
          <div>
            <dt>حد التوصيل المجاني</dt>
            <dd>
              <bdi dir="ltr">{formatIls(FREE_DELIVERY_THRESHOLD_AGOROT)}</bdi>
            </dd>
          </div>
          <div>
            <dt>رسوم أقل من الحد</dt>
            <dd>
              <bdi dir="ltr">{formatIls(STANDARD_DELIVERY_FEE_AGOROT)}</bdi>
            </dd>
          </div>
        </dl>
        <p className="admin-muted">
          هذه القيم معتمدة من خادم التطبيق عند إنشاء الطلبات. لا تُحسب من واجهة
          الزبون.
        </p>
      </section>

      {active ? (
        <section className="admin-panel" aria-labelledby="active-area-title">
          <h2 id="active-area-title">منطقة {active.nameAr}</h2>
          <p className="admin-muted">
            يمكن تعطيل المنطقة للطوارئ فقط. رسوم الطلبات الجديدة تبقى وفق
            السياسة أعلاه.
          </p>
          <DeliveryAreaForm area={active} />
        </section>
      ) : null}

      {historical.length > 0 ? (
        <section
          className="admin-panel"
          aria-labelledby="historical-areas-title"
        >
          <h2 id="historical-areas-title">مناطق تاريخية (للسجلات فقط)</h2>
          <p className="admin-muted">
            محفوظة لسلامة الطلبات القديمة. مخفية عن اختيار الزبون عند التعطيل.
          </p>
          <div className="admin-area-grid">
            {historical.map((area) => (
              <DeliveryAreaForm key={area.code} area={area} />
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
