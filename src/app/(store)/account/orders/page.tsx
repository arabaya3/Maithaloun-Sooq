import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { customerOrdersService } from "@/features/accounts/application/customer-services";
import { getCustomerSession } from "@/features/accounts/application/customer-session";
import { OrderHistory } from "@/features/accounts/ui/order-history";
import { MobileNavigation } from "@/features/storefront/components/mobile-navigation";
import { SiteHeader } from "@/features/storefront/components/site-header";

export const metadata: Metadata = {
  title: "طلباتي",
  robots: { index: false, follow: false },
};

export default async function AccountOrdersPage() {
  await connection();
  const customer = await getCustomerSession();
  if (!customer) redirect("/account?next=/account/orders");
  const [orders, claimableCount] = await Promise.all([
    customerOrdersService.history(customer.id),
    customerOrdersService.claimableCount(customer.phoneE164),
  ]);

  return (
    <>
      <SiteHeader />
      <main className="page-shell account-page">
        <div className="account-heading">
          <span className="eyebrow">حسابي</span>
          <h1>طلباتي</h1>
        </div>
        <OrderHistory orders={orders} claimableCount={claimableCount} />
      </main>
      <MobileNavigation />
    </>
  );
}
