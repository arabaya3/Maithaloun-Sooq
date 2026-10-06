import type { Metadata } from "next";
import Link from "next/link";
import { Search, Users } from "lucide-react";
import { connection } from "next/server";

import { customerService } from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { formatAdminDateTime } from "@/features/admin/ui/format-admin-datetime";
import {
  EmptyState,
  MetricCard,
  Money,
  PageHeader,
} from "@/features/admin/ui/kit";
import {
  agingBucket,
  agingBucketLabels,
  type AgingBucket,
} from "@/features/sales/domain/customer-balance";
import { CustomerDetailsForm } from "@/features/sales/ui/customer-forms";

export const metadata: Metadata = { title: "الزبائن والديون" };

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; q?: string }>;
}) {
  await connection();
  const actor = await requireAdminSession();
  const params = await searchParams;
  const onlyOwing = params.filter === "owing";
  const search = (params.q ?? "").slice(0, 80);
  const customers = await customerService.list(actor, { onlyOwing, search });
  const aging: Record<AgingBucket, number> = { current: 0, late: 0, old: 0 };
  for (const customer of customers) {
    if (customer.oldestUnpaidDays !== null) {
      aging[agingBucket(customer.oldestUnpaidDays)] += 1;
    }
  }
  const agingTone: Record<AgingBucket, "neutral" | "warning" | "danger"> = {
    current: "neutral",
    late: "warning",
    old: "danger",
  };
  const totalOwed = customers.reduce(
    (sum, customer) => sum + Math.max(customer.balanceAgorot, 0),
    0,
  );

  return (
    <main className="admin-page admin-page--narrow">
      <PageHeader
        title="الزبائن والديون"
        lede={
          <>
            مجموع المستحق على الزبائن <Money agorot={totalOwed} />
          </>
        }
      />

      <section
        className="admin-kpi-strip admin-kpi-strip--compact"
        aria-label="عمر الديون"
      >
        {(Object.keys(aging) as AgingBucket[]).map((bucket) => (
          <MetricCard
            key={bucket}
            label={`أقدم دين ${agingBucketLabels[bucket]}`}
            value={aging[bucket] === 1 ? "زبون واحد" : `${aging[bucket]} زبائن`}
            tone={aging[bucket] ? agingTone[bucket] : "neutral"}
          />
        ))}
      </section>

      <form className="admin-search-bar" action="/admin/customers">
        {onlyOwing ? <input type="hidden" name="filter" value="owing" /> : null}
        <label className="sr-only" htmlFor="customer-search">
          بحث عن زبون
        </label>
        <Search size={18} aria-hidden="true" />
        <input
          id="customer-search"
          name="q"
          type="search"
          defaultValue={search}
          placeholder="اسم الزبون"
        />
        <button type="submit" className="admin-btn admin-btn-secondary">
          بحث
        </button>
      </form>

      <nav className="admin-tabs" aria-label="تصفية الزبائن">
        <Link
          href="/admin/customers"
          prefetch={false}
          className={onlyOwing ? "admin-tab" : "admin-tab is-active"}
          aria-current={onlyOwing ? undefined : "page"}
        >
          الكل
        </Link>
        <Link
          href="/admin/customers?filter=owing"
          prefetch={false}
          className={onlyOwing ? "admin-tab is-active" : "admin-tab"}
          aria-current={onlyOwing ? "page" : undefined}
        >
          عليهم ديون
        </Link>
      </nav>

      {customers.length ? (
        <section className="admin-panel" aria-label="قائمة الزبائن">
          <ul className="admin-line-list">
            {customers.map((customer) => (
              <li key={customer.id}>
                <Link
                  href={`/admin/customers/${customer.id}`}
                  prefetch={false}
                  className="admin-line"
                >
                  <span className="admin-line-main">
                    <strong>{customer.name}</strong>
                    <small>
                      {customer.lastActivityAt
                        ? `آخر حركة ${formatAdminDateTime(customer.lastActivityAt)}`
                        : "لا توجد حركات"}
                    </small>
                  </span>
                  <span className="admin-line-side">
                    <Money agorot={customer.balanceAgorot} />
                    <small className="admin-muted">
                      {customer.balanceAgorot > 0
                        ? "عليه"
                        : customer.balanceAgorot < 0
                          ? "له رصيد"
                          : "لا ديون"}
                    </small>
                    {customer.oldestUnpaidDays !== null ? (
                      <span
                        className="admin-chip"
                        data-tone={
                          agingTone[agingBucket(customer.oldestUnpaidDays)]
                        }
                      >
                        أقدم دين منذ {customer.oldestUnpaidDays} يوم
                      </span>
                    ) : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <EmptyState
          Icon={Users}
          title={onlyOwing ? "لا أحد عليه ديون" : "لا يوجد زبائن بعد"}
        >
          <p className="admin-muted">
            يُضاف الزبون تلقائياً عند أول بيع باسمه، أو أضيفيه من هنا.
          </p>
        </EmptyState>
      )}

      <section className="admin-panel" aria-labelledby="new-customer-title">
        <h2 id="new-customer-title">زبون جديد</h2>
        <CustomerDetailsForm />
      </section>
    </main>
  );
}
