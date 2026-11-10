import { storeContactService } from "@/features/orders/application/order-service-instance";
import { MobileNavigation } from "@/features/storefront/components/mobile-navigation";
import { ProductRequestForm } from "@/features/storefront/components/product-request-form";
import { SiteHeader } from "@/features/storefront/components/site-header";
import { getLocale, localizedAlternates } from "@/i18n/server";

export async function generateMetadata() {
  const locale = await getLocale();
  return {
    title: locale === "ar" ? "اطلب منتج غير متوفر" : "Request a product",
    alternates: await localizedAlternates("/request-product"),
  };
}

export default async function ProductRequestPage() {
  const phone = await storeContactService.whatsAppNumber();
  return (
    <>
      <SiteHeader hideSearch />
      <ProductRequestForm phone={phone} />
      <MobileNavigation />
    </>
  );
}
