import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";

import "./globals.css";

// Noto Sans Arabic (OFL), width axis pinned and subset to the Arabic and Latin text the site uses.
const arabicFont = localFont({
  src: "./fonts/noto-sans-arabic-subset.woff2",
  weight: "400 900",
  style: "normal",
  display: "optional",
  variable: "--font-arabic",
  adjustFontFallback: "Arial",
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
  themeColor: "#12324A",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="ar"
      dir="rtl"
      className={arabicFont.variable}
      data-scroll-behavior="smooth"
    >
      <body>{children}</body>
    </html>
  );
}
