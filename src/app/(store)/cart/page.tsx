import type { Metadata } from "next";
import { connection } from "next/server";

import { CartPage } from "@/features/cart/components/cart-page";
import { productRepository } from "@/features/catalog/infrastructure/product-repository";
import { storeContactService } from "@/features/orders/application/order-service-instance";
import { MobileNavigation } from "@/features/storefront/components/mobile-navigation";
import { SiteHeader } from "@/features/storefront/components/site-header";

export const metadata: Metadata = {
  title: "سلة التسوق",
  description: "راجع المنتجات والكميات المحفوظة في سلة MAYTHA.",
};

export default async function CartRoute() {
  await connection();
  const [products, storeWhatsApp] = await Promise.all([
    productRepository.list(),
    storeContactService.whatsAppNumber(),
  ]);

  return (
    <>
      <SiteHeader />
      <main className="page-shell cart-page">
        <CartPage
          products={products}
          whatsAppOrdering={Boolean(storeWhatsApp)}
        />
      </main>
      <MobileNavigation />
    </>
  );
}
