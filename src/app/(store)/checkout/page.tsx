import type { Metadata } from "next";
import { connection } from "next/server";

import { customerAccountService } from "@/features/accounts/application/customer-services";
import { getCustomerSession } from "@/features/accounts/application/customer-session";
import { customerAccountsEnabled } from "@/features/accounts/domain/account-config";
import { productRepository } from "@/features/catalog/infrastructure/product-repository";
import { serviceAreaRepository } from "@/features/delivery/service-area-repository";
import { CheckoutForm } from "@/features/orders/components/checkout-form";
import { MobileNavigation } from "@/features/storefront/components/mobile-navigation";
import { SiteHeader } from "@/features/storefront/components/site-header";

export const metadata: Metadata = {
  title: "إتمام الطلب",
  robots: { index: false, follow: false },
};

export default async function CheckoutPage() {
  await connection();
  const [products, serviceAreas, customer] = await Promise.all([
    productRepository.list(),
    serviceAreaRepository.listEnabled(),
    getCustomerSession(),
  ]);
  const profile = customer
    ? await customerAccountService.profile(customer.id)
    : null;
  const contact = profile?.whatsappE164 ?? profile?.phoneE164;
  const address = profile?.addresses.find((entry) => entry.isDefault);
  const prefill =
    profile && contact
      ? {
          customerName: profile.displayName ?? "",
          countryCode: contact.startsWith("+972")
            ? ("972" as const)
            : ("970" as const),
          nationalNumber: `0${contact.slice(4)}`,
          deliveryAddress: address
            ? [address.address, address.landmark].filter(Boolean).join(" — ")
            : "",
        }
      : null;

  return (
    <>
      <SiteHeader />
      <main className="page-shell checkout-page">
        <CheckoutForm
          products={products}
          serviceAreas={serviceAreas}
          prefill={prefill}
          signInHint={customerAccountsEnabled() && !customer}
        />
      </main>
      <MobileNavigation />
    </>
  );
}
