import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { can } from "@/features/admin/domain/permissions";
import { PageHeader } from "@/features/admin/ui/kit";
import {
  emptyOfferValues,
  offerTargetChoices,
} from "@/features/offers/application/offer-editor-data";
import { OfferEditor } from "@/features/offers/ui/offer-editor";

export const metadata: Metadata = { title: "عرض جديد" };

export default async function NewOfferPage() {
  await connection();
  const actor = await requireAdminSession();
  if (!can(actor, "settings.manage")) redirect("/admin/offers");
  const choices = await offerTargetChoices(actor);
  return (
    <main className="admin-page admin-page--narrow">
      <PageHeader
        title="عرض جديد"
        lede="أربع خطوات: ما يشمله، السعر، المدة، ثم معاينة الأسعار قبل الحفظ."
        back={{ href: "/admin/offers", label: "العروض" }}
      />
      <OfferEditor values={emptyOfferValues} {...choices} />
    </main>
  );
}
