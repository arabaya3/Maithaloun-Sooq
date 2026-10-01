import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";

import { ADMIN_MANIFEST_PATH } from "@/features/pwa/admin-manifest";

import "@/features/admin/ui/admin.css";
import "@/features/admin/ui/admin-operations.css";

// Noto Sans Arabic (OFL), the unchanged admin typeface.
const adminFont = localFont({
  src: "../fonts/noto-sans-arabic-subset.woff2",
  weight: "400 900",
  style: "normal",
  display: "optional",
  variable: "--font-arabic",
  adjustFontFallback: "Arial",
});

export const dynamic = "force-dynamic";

// The on-screen keyboard shrinks the layout so the assistant composer stays visible.
export const viewport: Viewport = {
  themeColor: "#1F4D3A",
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
    <div className={`${adminFont.variable} admin-font-scope font-scope`}>
      {children}
    </div>
  );
}
