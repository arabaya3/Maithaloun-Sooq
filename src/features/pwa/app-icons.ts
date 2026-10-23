import type { MetadataRoute } from "next";

const base = "/brand/app";

export const appIcons = {
  favicon16: `${base}/favicon-16-v5.png`,
  favicon32: `${base}/favicon-32-v5.png`,
  appleTouch: `${base}/apple-touch-icon-v5.png`,
  icon192: `${base}/icon-192-v5.png`,
  icon512: `${base}/icon-512-v5.png`,
  maskable192: `${base}/maskable-192-v5.png`,
  maskable512: `${base}/maskable-512-v5.png`,
} as const;

export const manifestIcons: MetadataRoute.Manifest["icons"] = [
  {
    src: appIcons.icon192,
    sizes: "192x192",
    type: "image/png",
    purpose: "any",
  },
  {
    src: appIcons.icon512,
    sizes: "512x512",
    type: "image/png",
    purpose: "any",
  },
  {
    src: appIcons.maskable192,
    sizes: "192x192",
    type: "image/png",
    purpose: "maskable",
  },
  {
    src: appIcons.maskable512,
    sizes: "512x512",
    type: "image/png",
    purpose: "maskable",
  },
];
