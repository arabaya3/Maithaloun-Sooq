import type { Metadata, Viewport } from "next";
import { Noto_Sans_Arabic } from "next/font/google";
import { connection } from "next/server";
import type { ReactNode } from "react";

import { CartProvider } from "@/features/cart/cart-provider";
import { productRepository } from "@/features/catalog/infrastructure/product-repository";
import { DeliveryProvider } from "@/features/delivery/delivery-provider";
import { serviceAreaRepository } from "@/features/delivery/service-area-repository";
import { FavoritesProvider } from "@/features/favorites/favorites-provider";

import "./globals.css";

const arabicFont = Noto_Sans_Arabic({
  subsets: ["arabic"],
  display: "swap",
  variable: "--font-arabic",
});

export const metadata: Metadata = {
  title: {
    default: "سوق ميثلون",
    template: "%s | سوق ميثلون",
  },
  description: "متجر عربي لاحتياجات ومنتجات التنظيف المنزلية.",
  applicationName: "سوق ميثلون",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icons/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: "/icons/icon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#1F4D3A",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  await connection();
  const [products, serviceAreas] = await Promise.all([
    productRepository.list(),
    serviceAreaRepository.listEnabled(),
  ]);
  const productIds = products.map((product) => product.id);
  const catalog = products.map((product) => ({
    productId: product.id,
    defaultVariantId: product.defaultVariantId,
    variantIds: product.variants.map((variant) => variant.id),
  }));
  const locations = serviceAreas.map((area) => ({
    code: area.code,
    nameAr: area.nameAr,
  }));

  return (
    <html
      lang="ar"
      dir="rtl"
      className={arabicFont.variable}
      data-scroll-behavior="smooth"
    >
      <body>
        <DeliveryProvider locations={locations}>
          <FavoritesProvider productIds={productIds}>
            <CartProvider catalog={catalog}>{children}</CartProvider>
          </FavoritesProvider>
        </DeliveryProvider>
      </body>
    </html>
  );
}
