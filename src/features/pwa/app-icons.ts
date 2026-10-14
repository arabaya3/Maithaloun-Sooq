import type { MetadataRoute } from "next";

const base = "/brand/app";

export const appIcons = {
  favicon16: `${base}/favicon-16-v4.png`,
  favicon32: `${base}/favicon-32-v4.png`,
  appleTouch: `${base}/apple-touch-icon-v4.png`,
  icon192: `${base}/icon-192-v4.png`,
  icon512: `${base}/icon-512-v4.png`,
  maskable192: `${base}/maskable-192-v4.png`,
  maskable512: `${base}/maskable-512-v4.png`,
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
