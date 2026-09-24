import type { Metadata } from "next";

import "@/features/admin/ui/admin.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: {
    default: "إدارة سوق ميثلون",
    template: "%s | إدارة سوق ميثلون",
  },
  robots: { index: false, follow: false, nocache: true, noarchive: true },
};

export default function AdminRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
