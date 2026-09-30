import type { MetadataRoute } from "next";

export const ADMIN_MANIFEST_PATH = "/admin-manifest.webmanifest";

export const adminManifest: MetadataRoute.Manifest = {
  id: "/admin",
  name: "إدارة سوق ميثلون",
  short_name: "إدارة السوق",
  description: "تطبيق إدارة الطلبات والمخزون والمبيعات لسوق ميثلون.",
  start_url: "/admin",
  scope: "/admin",
  display: "standalone",
  orientation: "portrait-primary",
  background_color: "#f6f7f5",
  theme_color: "#174e3b",
  lang: "ar",
  dir: "rtl",
  categories: ["business", "productivity"],
  icons: [
    {
      src: "/icons/icon-192.png",
      sizes: "192x192",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/icons/icon-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/icons/icon-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
  ],
};
