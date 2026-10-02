import { CheckCircle2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { getCustomerSession } from "@/features/accounts/application/customer-session";
import { customerAccountsEnabled } from "@/features/accounts/domain/account-config";
import { orderService } from "@/features/orders/application/order-service-instance";
import { orderStatusLabels } from "@/features/orders/domain/order-status";
import { formatIls } from "@/shared/lib/format-currency";

export const metadata: Metadata = {
  title: "تم استلام الطلب",
  robots: { index: false, follow: false, nocache: true },
};

export default async function OrderConfirmationPage({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  await connection();
  const confirmation = await orderService.getConfirmation(
    (await params).reference,
  );
  if (!confirmation) notFound();
  const suggestAccount =
    customerAccountsEnabled() && !(await getCustomerSession());

  return (
    <main className="page-shell order-confirmation-page">
      <section aria-labelledby="confirmation-title">
        <CheckCircle2 aria-hidden="true" />
        <span className="eyebrow">تم استلام الطلب</span>
        <h1 id="confirmation-title">شكراً، طلبك قيد المراجعة</h1>
        <p>
          حالة الطلب: <strong>{orderStatusLabels[confirmation.status]}</strong>
        </p>
        <div className="order-reference">
          <span>رقم الطلب</span>
          <strong>
            <bdi dir="ltr">{confirmation.publicReference}</bdi>
          </strong>
        </div>
        <dl>
          <div>
            <dt>مجموع المنتجات</dt>
            <dd>
              <bdi dir="ltr">{formatIls(confirmation.itemsSubtotalAgorot)}</bdi>
            </dd>
          </div>
          <div>
            <dt>تكلفة التوصيل</dt>
            <dd>
              {confirmation.deliveryFeeAgorot === null
                ? "سيتم تأكيدها لاحقاً"
                : formatIls(confirmation.deliveryFeeAgorot)}
            </dd>
          </div>
          <div>
            <dt>طريقة الدفع</dt>
            <dd>نقداً عند الاستلام</dd>
          </div>
        </dl>
        <Link href="/">العودة إلى المتجر</Link>
      </section>
      {suggestAccount ? (
        <aside className="account-card account-suggestion">
          <p className="account-note">
            أنشئ حساباً لحفظ المفضلة، متابعة الطلبات وإعادة طلب مشترياتك بسهولة.
            يمكنك إضافة هذا الطلب لحسابك بعد تأكيد رقمك.
          </p>
          <Link href="/account?mode=create&next=/account/orders">
            إنشاء حساب
          </Link>
        </aside>
      ) : null}
    </main>
  );
}
