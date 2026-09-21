import type { Metadata } from "next";

import { CartPage } from "@/features/cart/components/cart-page";
import { productRepository } from "@/features/catalog/infrastructure/mock-product-repository";
import { MobileNavigation } from "@/features/storefront/components/mobile-navigation";
import { SiteHeader } from "@/features/storefront/components/site-header";

export const metadata: Metadata = {
  title: "سلة التسوق",
  description: "راجع المنتجات والكميات المحفوظة في سلة سوق ميثلون.",
};

export default async function CartRoute() {
  const products = await productRepository.list();

  return (
    <>
      <SiteHeader />
      <main className="page-shell cart-page">
        <CartPage products={products} />
      </main>
      <MobileNavigation />
    </>
  );
}
