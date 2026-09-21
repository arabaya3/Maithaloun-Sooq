import type { Metadata } from "next";
import { connection } from "next/server";

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
  const [products, serviceAreas] = await Promise.all([
    productRepository.list(),
    serviceAreaRepository.listEnabled(),
  ]);

  return (
    <>
      <SiteHeader />
      <main className="page-shell checkout-page">
        <CheckoutForm products={products} serviceAreas={serviceAreas} />
      </main>
      <MobileNavigation />
    </>
  );
}
