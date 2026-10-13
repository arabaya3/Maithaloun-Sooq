import type { Metadata } from "next";
import { connection } from "next/server";

import { customerAccountService } from "@/features/accounts/application/customer-services";
import { getCustomerSession } from "@/features/accounts/application/customer-session";
import { customerAccountsEnabled } from "@/features/accounts/domain/account-config";
import { productRepository } from "@/features/catalog/infrastructure/product-repository";
import { serviceAreaRepository } from "@/features/delivery/service-area-repository";
import { storeContactService } from "@/features/orders/application/order-service-instance";
import { CheckoutForm } from "@/features/orders/components/checkout-form";
import type { CheckoutChannel } from "@/features/orders/domain/whatsapp-order";
import { MobileNavigation } from "@/features/storefront/components/mobile-navigation";
import { SiteHeader } from "@/features/storefront/components/site-header";
import { getMessages } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const m = await getMessages();
  return {
    title: m.meta.checkoutTitle,
    robots: { index: false, follow: false },
  };
}

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string | string[] }>;
}) {
  await connection();
  const requested = (await searchParams).channel;
  const [products, serviceAreas, customer, storeWhatsApp] = await Promise.all([
    productRepository.list(),
    serviceAreaRepository.listEnabled(),
    getCustomerSession(),
    storeContactService.whatsAppNumber(),
  ]);
  const profile = customer
    ? await customerAccountService.profile(customer.id)
    : null;
  const contact = profile?.whatsappE164 ?? profile?.phoneE164;
  const prefill =
    profile && contact
      ? {
          customerName: profile.displayName ?? "",
          countryCode: contact.startsWith("+972")
            ? ("972" as const)
            : ("970" as const),
          nationalNumber: `0${contact.slice(4)}`,
        }
      : null;
  // Only the two known channels are honoured; WhatsApp needs a configured store number.
  const channel: CheckoutChannel =
    requested === "whatsapp" && storeWhatsApp ? "whatsapp" : "web";

  return (
    <>
      <SiteHeader />
      <main className="page-shell checkout-page">
        <CheckoutForm
          products={products}
          serviceAreas={serviceAreas}
          prefill={prefill}
          signInHint={customerAccountsEnabled() && !customer}
          channel={channel}
        />
      </main>
      <MobileNavigation />
    </>
  );
}
