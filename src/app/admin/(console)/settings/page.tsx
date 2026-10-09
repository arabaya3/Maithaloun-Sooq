import type { Metadata } from "next";
import Link from "next/link";
import { FlaskConical, ScrollText, Users } from "lucide-react";
import { connection } from "next/server";
import { redirect } from "next/navigation";

import {
  adminDeliveryService,
  summaryService,
} from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { DeliveryAreaForm } from "@/features/admin/ui/delivery-area-form";
import {
  ACTIVE_SERVICE_AREA_CODE,
  ACTIVE_SERVICE_AREA_NAME_AR,
  FREE_DELIVERY_THRESHOLD_AGOROT,
  STANDARD_DELIVERY_FEE_AGOROT,
} from "@/features/delivery/delivery-policy";
import { formatIls } from "@/shared/lib/format-currency";
import { WorkspaceNav } from "@/features/admin/ui/workspace-nav";
import { smokeTestEnabled } from "@/features/assistant/domain/smoke-test";
import { SummaryFrequencyForm } from "@/features/reminders/ui/reminder-controls";
import { storeContactService } from "@/features/orders/application/order-service-instance";
import { StoreWhatsAppForm } from "@/features/orders/components/store-whatsapp-form";

export const metadata: Metadata = {
  title: "إعدادات المتجر",
};

export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string | string[] }>;
}) {
  await connection();
  const actor = await requireAdminSession();
  if (actor.role !== "owner") redirect("/admin");
  const areas = await adminDeliveryService.list(actor);
  const [summaryFrequency, storeWhatsApp] = await Promise.all([
    summaryService.getFrequency(),
    storeContactService.whatsAppNumber(),
  ]);
  const active = areas.find((area) => area.code === ACTIVE_SERVICE_AREA_CODE);
  const savedArea = (await searchParams).saved === "delivery-area";
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
      <WorkspaceNav
        label="أقسام الإعدادات"
        sections={[
          { id: "accounts", label: "الحسابات والسجل" },
          { id: "delivery", label: "التوصيل" },
          { id: "summary", label: "الملخص الدوري" },
          { id: "whatsapp", label: "واتساب" },
        ]}
      />

      <nav
        id="accounts"
        className="admin-action-grid admin-workspace-anchor"
        aria-label="الحسابات والسجل"
      >
        <Link href="/admin/settings/users" prefetch={false}>
          <Users size={22} aria-hidden="true" />
          <span>المستخدمون والجلسات</span>
        </Link>
        <Link href="/admin/audit" prefetch={false}>
          <ScrollText size={22} aria-hidden="true" />
          <span>سجل التدقيق</span>
        </Link>
        {/* The assistant is switched off for now; its check appears only while explicitly enabled. */}
        {smokeTestEnabled(process.env) ? (
          <Link href="/admin/assistant-smoke" prefetch={false}>
            <FlaskConical size={22} aria-hidden="true" />
            <span>فحص المساعد</span>
          </Link>
        ) : null}
      </nav>

      {savedArea ? (
        <p className="admin-media-message" data-tone="ok" role="status">
          تم حفظ منطقة التوصيل.
        </p>
      ) : null}

      <section
        id="delivery"
        className="admin-panel admin-workspace-anchor"
        aria-labelledby="delivery-policy-title"
      >
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

      <section
        id="summary"
        className="admin-panel admin-workspace-anchor"
        aria-labelledby="summary-frequency-title"
      >
        <h2 id="summary-frequency-title">ملخص الأعمال الدوري</h2>
        <p className="admin-muted">
          ملخص تلقائي للمبيعات والربح والمخزون يُحفظ في أرشيف التقارير ويصل
          كإشعار.
        </p>
        <SummaryFrequencyForm frequency={summaryFrequency} />
      </section>

      <section
        id="whatsapp"
        className="admin-panel admin-workspace-anchor"
        aria-labelledby="store-whatsapp-title"
      >
        <h2 id="store-whatsapp-title">الطلب عبر واتساب</h2>
        <p className="admin-muted">
          عند تحديد رقم، يستطيع الزبون إرسال طلبه إلى هذا الرقم. يُحفظ الطلب
          بحالة «بانتظار تأكيد واتساب» ولا يُحجز المخزون حتى تؤكديه.
        </p>
        <StoreWhatsAppForm current={storeWhatsApp} />
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
