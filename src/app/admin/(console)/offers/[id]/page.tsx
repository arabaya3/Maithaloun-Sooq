import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";

import { offerService } from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { can } from "@/features/admin/domain/permissions";
import { PageHeader } from "@/features/admin/ui/kit";
import {
  offerTargetChoices,
  offerValues,
} from "@/features/offers/application/offer-editor-data";
import {
  describeOfferValue,
  offerStatus,
  offerStatusLabels,
} from "@/features/offers/domain/offer-status";
import { OfferEditor } from "@/features/offers/ui/offer-editor";
import {
  OfferArchiveForm,
  OfferDeleteForm,
} from "@/features/offers/ui/offer-manage";

export const metadata: Metadata = { title: "العرض" };

const savedMessages: Record<string, string> = {
  created: "تم إنشاء العرض.",
  updated: "تم حفظ العرض.",
  archived: "تمت أرشفة العرض وإيقافه.",
  restored: "تمت استعادة العرض، وهو غير مفعّل حتى تفعّليه.",
};

export default async function OfferPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  await connection();
  const actor = await requireAdminSession();
  if (!can(actor, "settings.manage")) redirect("/admin/offers");
  const offer = await offerService.get(actor, (await params).id);
  if (!offer) notFound();
  const { saved } = await searchParams;
  const message =
    saved && Object.hasOwn(savedMessages, saved) ? savedMessages[saved] : null;
  const status = offerStatus(offer, new Date());
  const choices = offer.archived ? null : await offerTargetChoices(actor);

  return (
    <main className="admin-page admin-page--narrow">
      <PageHeader
        title={offer.nameAr}
        lede={`${offerStatusLabels[status]} · ${describeOfferValue(offer)}`}
        back={{ href: "/admin/offers", label: "العروض" }}
      />
      {message ? (
        <p className="admin-media-message" data-tone="ok" role="status">
          {message}
        </p>
      ) : null}
      {choices ? (
        <OfferEditor values={offerValues(offer)} {...choices} />
      ) : (
        <p className="admin-note" role="note">
          العرض مؤرشف ولا يُعدَّل. استعيديه أولاً.
        </p>
      )}
      <section className="admin-panel" aria-labelledby="offer-manage-title">
        <h2 id="offer-manage-title">إدارة العرض</h2>
        <p className="admin-muted">
          {offer.usage
            ? `استُخدم في ${offer.usage} سطر طلب، فيبقى محفوظاً في السجلات ويُؤرشف بدل الحذف.`
            : "لم يُستخدم في أي طلب بعد."}
        </p>
        <OfferArchiveForm offerId={offer.id} archived={offer.archived} />
        {offer.usage ? null : <OfferDeleteForm offerId={offer.id} />}
      </section>
    </main>
  );
}
