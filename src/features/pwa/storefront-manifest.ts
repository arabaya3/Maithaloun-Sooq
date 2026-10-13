import type { MetadataRoute } from "next";

import { manifestIcons } from "./app-icons";

export const storefrontManifest: MetadataRoute.Manifest = {
  id: "/",
  name: "MAYTHA",
  short_name: "MAYTHA",
  description: "منتجات التنظيف والعناية من ماركات بتعرفها وبتثق فيها.",
  start_url: "/",
  scope: "/",
  display: "standalone",
  orientation: "portrait-primary",
  background_color: "#f8f7f3",
  theme_color: "#183d32",
  lang: "ar",
  dir: "rtl",
  categories: ["shopping", "lifestyle"],
  icons: manifestIcons,
};
