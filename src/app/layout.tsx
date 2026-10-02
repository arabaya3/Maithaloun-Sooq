import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { appIcons } from "@/features/pwa/app-icons";

import "./globals.css";

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
      { url: appIcons.favicon32, type: "image/png", sizes: "32x32" },
      { url: appIcons.favicon16, type: "image/png", sizes: "16x16" },
      { url: appIcons.icon192, type: "image/png", sizes: "192x192" },
    ],
    apple: [{ url: appIcons.appleTouch, sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: { capable: true, title: "ميثلون", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#12324A",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl" data-scroll-behavior="smooth">
      <body className="storefront-font-scope">{children}</body>
    </html>
  );
}
