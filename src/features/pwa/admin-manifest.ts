import type { MetadataRoute } from "next";

import { manifestIcons } from "./app-icons";

export const ADMIN_MANIFEST_PATH = "/admin-manifest.webmanifest";

export const adminManifest: MetadataRoute.Manifest = {
  id: "/admin",
  name: "إدارة MAYTHA MARKET",
  short_name: "إدارة السوق",
  description: "تطبيق إدارة الطلبات والمخزون والمبيعات لمتجر MAYTHA MARKET.",
  start_url: "/admin",
  scope: "/admin",
  display: "standalone",
  orientation: "portrait-primary",
  background_color: "#f6f7f5",
  theme_color: "#174e3b",
  lang: "ar",
  dir: "rtl",
  categories: ["business", "productivity"],
  icons: manifestIcons,
};
