import type { Metadata } from "next";
import { Truck } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";

import { supplierService } from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { can } from "@/features/admin/domain/permissions";
import { EmptyState, Money, PageHeader } from "@/features/admin/ui/kit";
import {
  SupplierCreateForm,
  SupplierPaymentForm,
} from "@/features/purchasing/ui/supplier-forms";

export const metadata: Metadata = { title: "الموردون" };

export default async function SuppliersPage() {
  await connection();
  const actor = await requireAdminSession();
  const suppliers = await supplierService.list(actor);
  const canPay = can(actor, "suppliers.balances");

  return (
    <main className="admin-page admin-page--narrow">
      <PageHeader
        title="الموردون"
        back={{ href: "/admin/inventory", label: "المخزون والمشتريات" }}
      />

      {suppliers.length ? (
        <ul className="admin-supplier-list" aria-label="قائمة الموردين">
          {suppliers.map((supplier) => (
            <li key={supplier.id} className="admin-panel">
              <div className="admin-line admin-line--static">
                <span className="admin-line-main">
                  <Link
                    href={`/admin/inventory/suppliers/${supplier.id}`}
                    prefetch={false}
                  >
                    <strong>{supplier.nameAr}</strong>
                  </Link>
                  {supplier.active ? null : (
                    <small className="admin-muted"> · مؤرشف</small>
                  )}
                  <small>
                    {supplier.invoiceCount} فاتورة
                    {supplier.phone ? (
                      <>
                        {" "}
                        · <bdi dir="ltr">{supplier.phone}</bdi>
                      </>
                    ) : null}
                  </small>
                </span>
                {supplier.balanceAgorot === null ? null : (
                  <span className="admin-line-side">
                    <Money agorot={supplier.balanceAgorot} />
                    <small className="admin-muted">
                      {supplier.balanceAgorot > 0 ? "مستحق له" : "لا مستحقات"}
                    </small>
                  </span>
                )}
              </div>
              {canPay && (supplier.balanceAgorot ?? 0) > 0 ? (
                <SupplierPaymentForm supplierId={supplier.id} />
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState Icon={Truck} title="لا يوجد موردون بعد">
          <p className="admin-muted">
            أضيفي المورد هنا أو اكتبي اسمه مباشرة عند إدخال فاتورة شراء.
          </p>
        </EmptyState>
      )}

      <section className="admin-panel" aria-labelledby="new-supplier-title">
        <h2 id="new-supplier-title">مورد جديد</h2>
        <SupplierCreateForm />
      </section>
    </main>
  );
}
