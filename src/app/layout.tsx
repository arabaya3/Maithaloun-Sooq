import type { Metadata, Viewport } from "next";
import { Noto_Sans_Arabic } from "next/font/google";
import type { ReactNode } from "react";

import { DeliveryProvider } from "@/features/delivery/delivery-provider";
import { CartProvider } from "@/features/cart/cart-provider";
import { productRepository } from "@/features/catalog/infrastructure/mock-product-repository";
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
  themeColor: "#0d4a43",
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
  const products = await productRepository.list();
  const productIds = products.map((product) => product.id);

  return (
    <html
      lang="ar"
      dir="rtl"
      className={arabicFont.variable}
      data-scroll-behavior="smooth"
    >
      <body>
        <DeliveryProvider>
          <FavoritesProvider productIds={productIds}>
            <CartProvider productIds={productIds}>{children}</CartProvider>
          </FavoritesProvider>
        </DeliveryProvider>
      </body>
    </html>
  );
}
