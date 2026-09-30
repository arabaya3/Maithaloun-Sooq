import type { Metadata } from "next";

import { ADMIN_MANIFEST_PATH } from "@/features/pwa/admin-manifest";

import "@/features/admin/ui/admin.css";
import "@/features/admin/ui/admin-operations.css";

export const dynamic = "force-dynamic";

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
  return children;
}
