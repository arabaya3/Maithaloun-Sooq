export interface BrandLogo {
  src: string;
  width: number;
  height: number;
}

// Official wordmarks verified on Wikimedia Commons (see docs/brand-assets.md); shown unaltered.
const logos: Record<string, BrandLogo> = {
  axe: { src: "/brands/logos/axe.svg", width: 1438, height: 348 },
  clear: { src: "/brands/logos/clear.svg", width: 1390, height: 435 },
  "head & shoulders": {
    src: "/brands/logos/head-and-shoulders.svg",
    width: 134,
    height: 60,
  },
  signal: { src: "/brands/logos/signal.svg", width: 1009, height: 424 },
  sunsilk: { src: "/brands/logos/sunsilk.png", width: 528, height: 468 },
};

/** Brands without a verified logo get a typographic tile instead. */
export function brandLogo(name: string): BrandLogo | null {
  return logos[name.trim().toLowerCase()] ?? null;
}
