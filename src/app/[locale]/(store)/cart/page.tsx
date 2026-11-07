import type { Metadata } from "next";

import { CartPage } from "@/features/cart/components/cart-page";
import { productRepository } from "@/features/catalog/infrastructure/product-repository";
import { storeContactService } from "@/features/orders/application/order-service-instance";
import { MobileNavigation } from "@/features/storefront/components/mobile-navigation";
import { SiteHeader } from "@/features/storefront/components/site-header";
import { getMessages, localizedAlternates } from "@/i18n/server";

// Unknown languages (scanner paths like /wp-login.php land here) are a static 404, never a render.
export const dynamicParams = false;

export async function generateMetadata(): Promise<Metadata> {
  const m = await getMessages();
  return {
    alternates: await localizedAlternates("/cart"),
    title: m.meta.cartTitle,
    description: m.meta.cartDescription,
  };
}

export default async function CartRoute() {
  const [products, storeWhatsApp] = await Promise.all([
    productRepository.list(),
    storeContactService.whatsAppNumber(),
  ]);

  return (
    <>
      <SiteHeader />
      <main className="page-shell cart-page">
        <CartPage products={products} storeWhatsApp={storeWhatsApp} />
      </main>
      <MobileNavigation />
    </>
  );
}
