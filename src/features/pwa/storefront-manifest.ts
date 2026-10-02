import type { MetadataRoute } from "next";

import { manifestIcons } from "./app-icons";

export const storefrontManifest: MetadataRoute.Manifest = {
  id: "/",
  name: "سوق ميثلون",
  short_name: "ميثلون",
  description: "احتياجات ومنتجات التنظيف المنزلية في مكان واحد.",
  start_url: "/",
  scope: "/",
  display: "standalone",
  orientation: "portrait-primary",
  background_color: "#fbfaf7",
  theme_color: "#12324a",
  lang: "ar",
  dir: "rtl",
  categories: ["shopping", "lifestyle"],
  icons: manifestIcons,
};
