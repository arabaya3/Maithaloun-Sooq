import type { MetadataRoute } from "next";

export const storefrontManifest: MetadataRoute.Manifest = {
  id: "/",
  name: "سوق ميثلون",
  short_name: "سوق ميثلون",
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
