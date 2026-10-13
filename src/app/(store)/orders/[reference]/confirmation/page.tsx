import { CheckCircle2 } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { getCustomerSession } from "@/features/accounts/application/customer-session";
import { customerAccountsEnabled } from "@/features/accounts/domain/account-config";
import {
  orderService,
  storeContactService,
} from "@/features/orders/application/order-service-instance";
import { WhatsAppHandoff } from "@/features/orders/components/whatsapp-handoff";
import {
  whatsAppLinks,
  whatsAppOrderMessage,
} from "@/features/orders/domain/whatsapp-order";
import { orderStatusLabel } from "@/features/orders/domain/order-status";
import { Link } from "@/i18n/link";
import { getLocale, getMessages } from "@/i18n/server";
import { formatIls } from "@/shared/lib/format-currency";

export async function generateMetadata(): Promise<Metadata> {
  const m = await getMessages();
  return {
    title: m.meta.confirmationTitle,
    robots: { index: false, follow: false, nocache: true },
  };
}

export default async function OrderConfirmationPage({
  params,
  searchParams,
}: {
  params: Promise<{ reference: string }>;
  searchParams: Promise<{ handoff?: string | string[] }>;
}) {
  await connection();
  const reference = (await params).reference;
  const [confirmation, details, locale] = await Promise.all([
    orderService.getConfirmation(reference),
    orderService.getConfirmationLines(reference),
    getLocale(),
  ]);
  if (!confirmation || !details) notFound();
  const m = (await getMessages()).orders;
  const awaitingWhatsApp = confirmation.status === "awaiting_whatsapp";
  const storeNumber = awaitingWhatsApp
    ? await storeContactService.whatsAppNumber()
    : null;
  // The store reads this message, so it stays Arabic in every language.
  const message = whatsAppOrderMessage({
    publicReference: confirmation.publicReference,
    lines: details.lines,
    itemsSubtotalAgorot: confirmation.itemsSubtotalAgorot,
    deliveryFeeAgorot: confirmation.deliveryFeeAgorot,
    finalTotalAgorot: confirmation.finalTotalAgorot,
  });
  const links = storeNumber ? whatsAppLinks(storeNumber, message) : null;
  const suggestAccount =
    customerAccountsEnabled() && !(await getCustomerSession());

  return (
    <main className="page-shell order-confirmation-page">
      <section aria-labelledby="confirmation-title">
        <CheckCircle2 aria-hidden="true" />
        <span className="eyebrow">{m.received}</span>
        <h1 id="confirmation-title">
          {awaitingWhatsApp ? m.lastStepWhatsApp : m.thanks}
        </h1>
        <p>
          {m.statusLabel}
          <strong>{orderStatusLabel(confirmation.status, locale)}</strong>
        </p>
        <div className="order-reference">
          <span>{m.reference}</span>
          <strong>
            <bdi dir="ltr">{confirmation.publicReference}</bdi>
          </strong>
        </div>
        {links ? (
          <WhatsAppHandoff
            message={message}
            appHref={links.app}
            webHref={links.web}
            autoOpen={(await searchParams).handoff === "1"}
          />
        ) : awaitingWhatsApp ? (
          <p role="note">{m.savedNoWhatsApp}</p>
        ) : (
          <p role="note">{m.reachedStore}</p>
        )}
        <ul className="order-confirmation-lines" aria-label={m.orderLines}>
          {details.lines.map((line, index) => (
            <li key={index}>
              <span>
                <strong>
                  <bdi dir="auto">{line.name}</bdi>
                </strong>
                {line.options ? <small>{line.options}</small> : null}
                {line.unit ? <small>{line.unit}</small> : null}
              </span>
              <span>× {line.quantity}</span>
              <bdi dir="ltr">{formatIls(line.lineSubtotalAgorot)}</bdi>
            </li>
          ))}
        </ul>
        <dl>
          <div>
            <dt>{m.subtotal}</dt>
            <dd>
              <bdi dir="ltr">{formatIls(confirmation.itemsSubtotalAgorot)}</bdi>
            </dd>
          </div>
          <div>
            <dt>{m.deliveryCost}</dt>
            <dd>
              {confirmation.deliveryFeeAgorot === null
                ? m.confirmedLater
                : formatIls(confirmation.deliveryFeeAgorot)}
            </dd>
          </div>
          {confirmation.finalTotalAgorot === null ? null : (
            <div>
              <dt>{m.total}</dt>
              <dd>
                <bdi dir="ltr">{formatIls(confirmation.finalTotalAgorot)}</bdi>
              </dd>
            </div>
          )}
          <div>
            <dt>{m.paymentMethod}</dt>
            <dd>{m.cashOnDelivery}</dd>
          </div>
        </dl>
        <Link href="/">{m.backToStore}</Link>
      </section>
      {suggestAccount ? (
        <aside className="account-card account-suggestion">
          <p className="account-note">{m.accountSuggestion}</p>
          <Link href="/account?mode=create&next=/account/orders">
            {m.createAccount}
          </Link>
        </aside>
      ) : null}
    </main>
  );
}
