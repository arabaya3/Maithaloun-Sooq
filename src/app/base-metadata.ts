import type { Metadata } from "next";

import { appIcons } from "@/features/pwa/app-icons";

// Vercel provides the production host; local and test builds resolve against localhost.
const siteUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "http://localhost:3000";

export const baseMetadata: Metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: "MAYTHA",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: appIcons.favicon32, type: "image/png", sizes: "32x32" },
      { url: appIcons.favicon16, type: "image/png", sizes: "16x16" },
      { url: appIcons.icon192, type: "image/png", sizes: "192x192" },
    ],
    apple: [{ url: appIcons.appleTouch, sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: { capable: true, title: "MAYTHA", statusBarStyle: "default" },
};
