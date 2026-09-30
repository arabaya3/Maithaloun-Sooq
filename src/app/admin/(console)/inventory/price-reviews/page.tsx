import type { Metadata } from "next";
import { BadgeCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { priceReviewService } from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { can } from "@/features/admin/domain/permissions";
import { EmptyState, PageHeader } from "@/features/admin/ui/kit";
import { PriceReviewCard } from "@/features/inventory/ui/price-review-card";

export const metadata: Metadata = { title: "مراجعة أسعار البيع" };

export default async function PriceReviewsPage() {
  await connection();
  const actor = await requireAdminSession();
  if (!can(actor, "pricing.review")) redirect("/admin/inventory");
  const items = await priceReviewService.listOpen(actor);

  return (
    <main className="admin-page admin-page--narrow">
      <PageHeader
        title="مراجعة أسعار البيع"
        lede="أصناف تغيّرت تكلفة شرائها. سعر المتجر لا يتغيّر إلا بقرارك."
        back={{ href: "/admin/inventory", label: "المخزون والمشتريات" }}
      />
      {items.length ? (
        <ul
          className="admin-supplier-list"
          aria-label="أصناف تحتاج مراجعة السعر"
        >
          {items.map((item) => (
            <PriceReviewCard key={item.id} item={item} />
          ))}
        </ul>
      ) : (
        <EmptyState Icon={BadgeCheck} title="لا توجد أسعار تحتاج مراجعة">
          <p className="admin-muted">
            يظهر الصنف هنا عندما تتغيّر تكلفة شرائه أو يصبح هامش ربحه ضعيفاً.
          </p>
        </EmptyState>
      )}
    </main>
  );
}
