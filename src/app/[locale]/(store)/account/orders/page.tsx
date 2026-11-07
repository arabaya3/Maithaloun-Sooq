import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { customerOrdersService } from "@/features/accounts/application/customer-services";
import { getCustomerSession } from "@/features/accounts/application/customer-session";
import { OrderHistory } from "@/features/accounts/ui/order-history";
import { MobileNavigation } from "@/features/storefront/components/mobile-navigation";
import { SiteHeader } from "@/features/storefront/components/site-header";
import { localizePath } from "@/i18n/config";
import { getLocale, getMessages } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const m = await getMessages();
  return {
    title: m.meta.ordersTitle,
    robots: { index: false, follow: false },
  };
}

export default async function AccountOrdersPage() {
  await connection();
  const [customer, locale, m] = await Promise.all([
    getCustomerSession(),
    getLocale(),
    getMessages(),
  ]);
  if (!customer) {
    redirect(localizePath(locale, "/account?next=/account/orders"));
  }
  const [orders, claimableCount] = await Promise.all([
    customerOrdersService.history(customer.id),
    customerOrdersService.claimableCount(customer.phoneE164),
  ]);

  return (
    <>
      <SiteHeader />
      <main className="page-shell account-page">
        <div className="account-heading">
          <span className="eyebrow">{m.account.title}</span>
          <h1>{m.account.myOrders}</h1>
        </div>
        <OrderHistory orders={orders} claimableCount={claimableCount} />
      </main>
      <MobileNavigation />
    </>
  );
}
