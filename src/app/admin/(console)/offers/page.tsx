import type { Metadata } from "next";
import Link from "next/link";
import {
  Archive,
  BadgePercent,
  CalendarClock,
  CalendarX2,
  CheckCircle2,
  CircleDashed,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { connection } from "next/server";

import { offerService } from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { can } from "@/features/admin/domain/permissions";
import { formatAdminDateTime } from "@/features/admin/ui/format-admin-datetime";
import {
  EmptyState,
  PageHeader,
  StatusPill,
  type PillTone,
} from "@/features/admin/ui/kit";
import {
  describeOfferValue,
  offerStatus,
  offerStatusLabels,
  offerStatuses,
  type OfferStatus,
} from "@/features/offers/domain/offer-status";

export const metadata: Metadata = { title: "العروض" };

const pills: Record<OfferStatus, { tone: PillTone; Icon: LucideIcon }> = {
  active: { tone: "ok", Icon: CheckCircle2 },
  upcoming: { tone: "info", Icon: CalendarClock },
  draft: { tone: "neutral", Icon: CircleDashed },
  expired: { tone: "warn", Icon: CalendarX2 },
  archived: { tone: "neutral", Icon: Archive },
};

const savedMessages: Record<string, string> = {
  deleted: "تم حذف العرض.",
};

export default async function OffersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; saved?: string }>;
}) {
  await connection();
  const actor = await requireAdminSession();
  const header = (
    <PageHeader
      title="العروض"
      lede="خصومات على أقسام أو منتجات لفترة محددة. سعر المنتج الأصلي لا يتغير."
    />
  );
  if (!can(actor, "settings.manage")) {
    return (
      <main className="admin-page admin-page--narrow">
        {header}
        <p className="admin-note" role="note">
          إدارة العروض للمالك فقط.
        </p>
      </main>
    );
  }
  const params = await searchParams;
  const now = new Date();
  const offers = (
    await offerService.list(actor, { includeArchived: true })
  ).map((offer) => ({ ...offer, status: offerStatus(offer, now) }));
  const counts = Object.fromEntries(
    offerStatuses.map((status) => [
      status,
      offers.filter((offer) => offer.status === status).length,
    ]),
  ) as Record<OfferStatus, number>;
  const requested = offerStatuses.find((status) => status === params.status);
  const status =
    requested ?? (counts.active ? "active" : counts.draft ? "draft" : "active");
  const shown = offers.filter((offer) => offer.status === status);
  // A switched-off offer can only collide once switched on; say so before the owner tries.
  const pending = new Map(
    await Promise.all(
      shown
        .filter((offer) => offer.status === "draft")
        .map(
          async (offer) =>
            [
              offer.id,
              await offerService.conflicts(
                {
                  startsAt: offer.startsAt ? new Date(offer.startsAt) : null,
                  endsAt: offer.endsAt ? new Date(offer.endsAt) : null,
                  targets: offer.targets,
                },
                offer.id,
              ),
            ] as const,
        ),
    ),
  );
  const message =
    params.saved && Object.hasOwn(savedMessages, params.saved)
      ? savedMessages[params.saved]
      : null;

  return (
    <main className="admin-page admin-page--narrow">
      {header}
      {message ? (
        <p className="admin-media-message" data-tone="ok" role="status">
          {message}
        </p>
      ) : null}
      <Link
        className="admin-btn admin-btn-primary admin-btn-block"
        href="/admin/offers/new"
        prefetch={false}
      >
        عرض جديد
      </Link>
      <nav className="admin-tabs" aria-label="حالة العروض">
        {offerStatuses.map((item) => (
          <Link
            key={item}
            href={`/admin/offers?status=${item}`}
            prefetch={false}
            className={item === status ? "admin-tab is-active" : "admin-tab"}
            aria-current={item === status ? "page" : undefined}
          >
            {offerStatusLabels[item]} ({counts[item]})
          </Link>
        ))}
      </nav>
      {shown.length ? (
        <ul className="admin-supplier-list" aria-label="قائمة العروض">
          {shown.map((offer) => {
            const pill = pills[offer.status];
            const conflicts = pending.get(offer.id) ?? [];
            const scope = [
              offer.targets.categoryCodes.length
                ? `${offer.targets.categoryCodes.length} قسم`
                : null,
              offer.targets.productIds.length
                ? `${offer.targets.productIds.length} منتج`
                : null,
              offer.targets.variantIds.length
                ? `${offer.targets.variantIds.length} صنف`
                : null,
            ].filter(Boolean);
            return (
              <li key={offer.id}>
                <Link
                  href={`/admin/offers/${offer.id}`}
                  prefetch={false}
                  className="admin-panel admin-offer-card"
                >
                  <span className="admin-offer-card-head">
                    <strong>{offer.nameAr}</strong>
                    <StatusPill tone={pill.tone} Icon={pill.Icon}>
                      {offerStatusLabels[offer.status]}
                    </StatusPill>
                  </span>
                  <span>{describeOfferValue(offer)}</span>
                  <small className="admin-muted">
                    {scope.join(" · ")}
                    {offer.startsAt
                      ? ` · من ${formatAdminDateTime(offer.startsAt)}`
                      : ""}
                    {offer.endsAt
                      ? ` · حتى ${formatAdminDateTime(offer.endsAt)}`
                      : " · بلا تاريخ نهاية"}
                    {offer.usage ? ` · استُخدم في ${offer.usage} طلب` : ""}
                  </small>
                  {conflicts.length ? (
                    <small className="admin-offer-conflict">
                      <TriangleAlert size={14} aria-hidden="true" /> يتعارض عند
                      التفعيل مع «{conflicts[0]!.nameAr}»
                    </small>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState
          Icon={BadgePercent}
          title={
            offers.length
              ? `لا توجد عروض بحالة «${offerStatusLabels[status]}»`
              : "لا توجد عروض بعد"
          }
        >
          <p className="admin-muted">
            {offers.length
              ? "اختاري حالة أخرى من الأعلى."
              : "أنشئي أول عرض لقسم أو منتجات محددة."}
          </p>
        </EmptyState>
      )}
    </main>
  );
}
