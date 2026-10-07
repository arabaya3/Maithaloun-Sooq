import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";

import { ADMIN_MANIFEST_PATH } from "@/features/pwa/admin-manifest";

import "@/features/admin/ui/admin.css";
import "@/features/admin/ui/admin-operations.css";
import "@/features/admin/ui/admin-today.css";
import "@/features/admin/ui/admin-products.css";
import "@/features/admin/ui/admin-sell.css";
import "@/features/admin/ui/admin-inventory.css";
import "@/features/admin/ui/admin-merch.css";
import "@/features/admin/ui/admin-control.css";

// Cairo (OFL), the admin typeface. Each subset is its own family in one stack, so the browser takes Arabic,
// Latin and ₪ (latin-ext) from the file that has them; only Arabic is preloaded.
const cairoArabic = localFont({
  src: "../fonts/cairo-arabic.woff2",
  weight: "400 800",
  style: "normal",
  display: "swap",
  variable: "--font-cairo-arabic",
  adjustFontFallback: "Arial",
});
const cairoLatin = localFont({
  src: "../fonts/cairo-latin.woff2",
  weight: "400 800",
  style: "normal",
  display: "swap",
  preload: false,
  variable: "--font-cairo-latin",
  adjustFontFallback: "Arial",
});
const cairoLatinExt = localFont({
  src: "../fonts/cairo-latin-ext.woff2",
  weight: "400 800",
  style: "normal",
  display: "swap",
  preload: false,
  variable: "--font-cairo-latin-ext",
  adjustFontFallback: "Arial",
});

export const dynamic = "force-dynamic";

// The on-screen keyboard shrinks the layout so the assistant composer stays visible.
export const viewport: Viewport = {
  themeColor: "#164C3B",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export const metadata: Metadata = {
  title: {
    default: "إدارة سوق ميثلون",
    template: "%s | إدارة سوق ميثلون",
  },
  applicationName: "إدارة سوق ميثلون",
  manifest: ADMIN_MANIFEST_PATH,
  appleWebApp: { capable: true, title: "إدارة السوق" },
  robots: { index: false, follow: false, nocache: true, noarchive: true },
};

export default function AdminRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className={`${cairoArabic.variable} ${cairoLatin.variable} ${cairoLatinExt.variable} admin-font-scope font-scope`}
    >
      {children}
    </div>
  );
}
