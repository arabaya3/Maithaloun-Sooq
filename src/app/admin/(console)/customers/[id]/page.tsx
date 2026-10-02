import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  type LucideIcon,
} from "lucide-react";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import {
  customerService,
  reminderService,
} from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { can } from "@/features/admin/domain/permissions";
import { formatAdminDateTime } from "@/features/admin/ui/format-admin-datetime";
import {
  Money,
  PageHeader,
  StatusPill,
  type PillTone,
} from "@/features/admin/ui/kit";
import { formatWhatsAppDisplay } from "@/features/orders/domain/phone";
import { ReminderControls } from "@/features/reminders/ui/reminder-controls";
import {
  invoicePaymentStateLabels,
  type InvoicePaymentState,
} from "@/features/sales/domain/customer-balance";
import {
  CustomerDetailsForm,
  CustomerPaymentForm,
  ReversePaymentForm,
} from "@/features/sales/ui/customer-forms";

export const metadata: Metadata = { title: "ملف الزبون" };

const statePill: Record<
  InvoicePaymentState,
  { tone: PillTone; Icon: LucideIcon }
> = {
  paid: { tone: "ok", Icon: CheckCircle2 },
  unpaid: { tone: "warn", Icon: Clock },
  partially_paid: { tone: "warn", Icon: Clock },
  overdue: { tone: "danger", Icon: AlertTriangle },
  cancelled: { tone: "neutral", Icon: Ban },
};

export default async function CustomerProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();
  const actor = await requireAdminSession();
  const customer = await customerService.getDetail(actor, (await params).id);
  if (!customer) notFound();
  const { summary } = customer;
  const reminders = await reminderService.getView(actor, customer.id);
  const canManageReminders = can(actor, "reminders.manage");
  const canCorrect = can(actor, "ledger.correct");

  return (
    <main className="admin-page admin-page--narrow">
      <PageHeader
        title={customer.name}
        lede={
          customer.phoneE164 ? (
            <bdi dir="ltr">{formatWhatsAppDisplay(customer.phoneE164)}</bdi>
          ) : (
            "بدون رقم هاتف"
          )
        }
        back={{ href: "/admin/customers", label: "الزبائن والديون" }}
      />
      {customer.address || customer.landmark ? (
        <p className="admin-customer-address">
          {[customer.address, customer.landmark].filter(Boolean).join(" — ")}
        </p>
      ) : null}

      <section className="admin-panel" aria-labelledby="balance-title">
        <h2 id="balance-title">الحساب</h2>
        <dl className="admin-figures">
          <div>
            <dt>الرصيد الحالي</dt>
            <dd>
              <Money agorot={summary.balanceAgorot} />
            </dd>
          </div>
          <div>
            <dt>مجموع المشتريات</dt>
            <dd>
              <Money agorot={summary.totalPurchasesAgorot} />
            </dd>
          </div>
          <div>
            <dt>مجموع المدفوع</dt>
            <dd>
              <Money agorot={summary.totalPaidAgorot} />
            </dd>
          </div>
          <div>
            <dt>أقدم مبلغ غير مدفوع</dt>
            <dd>
              {summary.oldestUnpaid ? (
                <>
                  <Money agorot={summary.oldestUnpaid.amountAgorot} />
                  <small className="admin-muted">
                    {" "}
                    منذ <bdi dir="ltr">{summary.oldestUnpaid.ageDays}</bdi> يوم
                  </small>
                </>
              ) : (
                "لا يوجد"
              )}
            </dd>
          </div>
        </dl>
        <p className="admin-muted">
          {customer.lastActivityAt
            ? `آخر حركة ${formatAdminDateTime(customer.lastActivityAt)}`
            : "لا توجد حركات بعد."}
        </p>
        <div className="admin-form-actions">
          <Link
            className="admin-btn admin-btn-secondary"
            href={`/admin/sales/new?customer=${customer.id}`}
            prefetch={false}
          >
            بيع جديد لهذا الزبون
          </Link>
        </div>
      </section>

      {summary.balanceAgorot > 0 ? (
        <section className="admin-panel" aria-labelledby="payment-title">
          <h2 id="payment-title">تسجيل دفعة</h2>
          <CustomerPaymentForm customerId={customer.id} />
        </section>
      ) : null}

      <section className="admin-panel" aria-labelledby="invoices-title">
        <h2 id="invoices-title">الفواتير</h2>
        {customer.invoices.length ? (
          <ul className="admin-line-list">
            {customer.invoices.map((invoice) => {
              const pill = statePill[invoice.state];
              return (
                <li key={invoice.id}>
                  <Link
                    href={`/admin/sales/${invoice.id}`}
                    prefetch={false}
                    className="admin-line"
                  >
                    <span className="admin-line-main">
                      <strong>
                        فاتورة <bdi dir="ltr">{invoice.invoiceNumber}</bdi>
                      </strong>
                      <small>
                        <bdi dir="ltr">{invoice.date}</bdi>
                        {invoice.remainingAgorot > 0 ? (
                          <>
                            {" "}
                            · الباقي <Money agorot={invoice.remainingAgorot} />
                          </>
                        ) : null}
                      </small>
                    </span>
                    <span className="admin-line-side">
                      <Money agorot={invoice.totalAgorot} />
                      <StatusPill tone={pill.tone} Icon={pill.Icon}>
                        {invoicePaymentStateLabels[invoice.state]}
                      </StatusPill>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="admin-empty">لا توجد فواتير لهذا الزبون.</p>
        )}
      </section>

      <section className="admin-panel" aria-labelledby="payments-title">
        <h2 id="payments-title">الدفعات</h2>
        {customer.payments.length ? (
          <ul className="admin-line-list">
            {customer.payments.map((payment) => (
              <li key={payment.id} className="admin-payment-row">
                <div className="admin-line admin-line--static">
                  <span className="admin-line-main">
                    <strong>
                      {payment.isReversal
                        ? "قيد تصحيح (عكس دفعة)"
                        : payment.atSale
                          ? "دفعة عند البيع"
                          : "دفعة"}
                    </strong>
                    <small>
                      {formatAdminDateTime(payment.createdAt)}
                      {payment.note ? ` · ${payment.note}` : ""}
                      {payment.reversed ? " · تم عكسها" : ""}
                    </small>
                  </span>
                  <span className="admin-line-side">
                    <Money agorot={payment.amountAgorot} />
                  </span>
                </div>
                {canCorrect && !payment.isReversal && !payment.reversed ? (
                  <ReversePaymentForm
                    paymentId={payment.id}
                    customerId={customer.id}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="admin-empty">لا توجد دفعات بعد.</p>
        )}
      </section>

      <section className="admin-panel" aria-labelledby="reminders-title">
        <h2 id="reminders-title">التذكير بالدين</h2>
        <p className="admin-muted">
          {reminders.disputed
            ? `الرصيد متنازع عليه${reminders.disputeNote ? `: ${reminders.disputeNote}` : ""} — التذكيرات متوقفة.`
            : reminders.snoozedUntil
              ? `التذكير مؤجَّل حتى ${reminders.snoozedUntil}.`
              : "يصلك تذكير كل 5 أيام ما دام الرصيد غير مسدَّد. لا تُرسل أي رسالة للزبون."}
        </p>
        {reminders.history.length ? (
          <ul className="admin-line-list">
            {reminders.history.map((reminder) => (
              <li key={reminder.reminderDate} className="admin-line">
                <span className="admin-line-main">
                  <strong>
                    تذكير <bdi dir="ltr">{reminder.reminderDate}</bdi>
                  </strong>
                  <small>
                    بعد <bdi dir="ltr">{reminder.daysOutstanding}</bdi> يوم ·{" "}
                    {reminder.pushStatus === "sent"
                      ? "وصل إشعار للهاتف"
                      : "إشعار داخل التطبيق فقط"}
                  </small>
                </span>
                <span className="admin-line-side">
                  <Money agorot={reminder.balanceAgorot} />
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {canManageReminders && summary.balanceAgorot > 0 ? (
          <ReminderControls
            customerId={customer.id}
            snoozed={Boolean(reminders.snoozedUntil)}
            disputed={reminders.disputed}
          />
        ) : null}
      </section>

      <section className="admin-panel" aria-labelledby="details-title">
        <h2 id="details-title">بيانات الزبون</h2>
        {customer.aliases.length ? (
          <p className="admin-muted">
            يُعرف أيضاً بـ: {customer.aliases.join("، ")}
          </p>
        ) : null}
        <CustomerDetailsForm
          customer={{
            id: customer.id,
            name: customer.name,
            phone: customer.phoneE164 ?? "",
            notes: customer.notes ?? "",
          }}
        />
      </section>
    </main>
  );
}
