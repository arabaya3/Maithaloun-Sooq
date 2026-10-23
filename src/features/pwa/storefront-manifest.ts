import type { MetadataRoute } from "next";

import { manifestIcons } from "./app-icons";

export const storefrontManifest: MetadataRoute.Manifest = {
  id: "/",
  name: "MAYTHA MARKET",
  short_name: "MAYTHA",
  description: "منتجات التنظيف والعناية من ماركات بتعرفها وبتثق فيها.",
  start_url: "/",
  scope: "/",
  display: "standalone",
  orientation: "portrait-primary",
  background_color: "#f8faf5",
  theme_color: "#0e5a2f",
  lang: "ar",
  dir: "rtl",
  categories: ["shopping", "lifestyle"],
  icons: manifestIcons,
};
