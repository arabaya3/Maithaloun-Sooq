// Renders the Google Play feature graphic (1024x500) and Play icon (512x512) from the MAYTHA
// monogram, brand colors and bundled fonts. Deterministic: no network, fixed fonts and sizes.
// Run from the repository root (uses the web project's @playwright/test and sharp):
//   node mobile/maytha_market/store/source/render-store-graphics.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import sharp from "sharp";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../..");
const out = path.resolve(here, "../play");
const font = (file) =>
  `data:font/woff2;base64,${fs.readFileSync(path.join(root, "public/assets/fonts", file)).toString("base64")}`;

// Brand colors (same as tools/brand/render-brand-assets.mjs and lib/ui/theme.dart).
const FOREST = "#183D32";
const DEEP = "#102F26";
const IVORY = "#F7F5EF";
const SAGE_LIGHT = "#A9C9B2";

// Monogram geometry, shared with tools/brand/render-brand-assets.mjs.
const mark = (size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">
  <path d="M13.5 51V18.2c0-2 2.5-2.9 3.7-1.3L32 36.6l14.8-19.7c1.2-1.6 3.7-.7 3.7 1.3V51" fill="none" stroke="${IVORY}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M32 31.2c-6.4-3.7-7.6-11.4-.1-19.7 7.6 8.3 6.4 16 .1 19.7Z" fill="${SAGE_LIGHT}"/>
  <path d="M32 29.2V15.4" fill="none" stroke="${FOREST}" stroke-width="1.1" stroke-linecap="round"/>
</svg>`;

// Short Arabic line from store/listing.md.
const ARABIC_LINE = "ماركات بتعرفها وبتثق فيها، لبيت أنظف وأجمل.";

const css = `
@font-face { font-family: Playfair; src: url(${font("playfair-display-latin.woff2")}); font-weight: 400 600; }
@font-face { font-family: Naskh; src: url(${font("noto-naskh-arabic.woff2")}); font-weight: 500 700; }
html, body { margin: 0; }
.fg { width: 1024px; height: 500px; box-sizing: border-box; display: flex; align-items: center; gap: 52px;
  padding: 0 72px; background: radial-gradient(circle at 18% 50%, ${FOREST} 0%, ${FOREST} 38%, ${DEEP} 100%); }
.text { display: grid; gap: 22px; color: ${IVORY}; }
.name { font-family: Playfair; font-weight: 500; font-size: 60px; white-space: nowrap; letter-spacing: 0.06em; line-height: 1; }
.rule { width: 96px; height: 2px; background: ${SAGE_LIGHT}; }
.line { font-family: Naskh; font-weight: 600; font-size: 32px; white-space: nowrap; direction: rtl; text-align: left; color: ${SAGE_LIGHT}; }
.tile { width: 512px; height: 512px; display: grid; place-items: center; background: ${FOREST}; }
`;

fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
const shoot = async (html, width, height) => {
  await page.setViewportSize({ width, height });
  await page.setContent(`<style>${css}</style>${html}`);
  await page.evaluate(() => document.fonts.ready);
  return page.screenshot();
};

// Feature graphic: Play wants JPEG or 24-bit PNG without alpha.
const fg = await shoot(
  `<div class="fg">${mark(230)}<div class="text"><div class="name">MAYTHA MARKET</div><div class="rule"></div><div class="line">${ARABIC_LINE}</div></div></div>`,
  1024,
  500,
);
await sharp(fg).removeAlpha().png().toFile(path.join(out, "feature-graphic-1024x500.png"));

// Play icon: 512x512 32-bit PNG, same art as assets/brand/icon-512.png (mark at 70% of a forest tile).
const icon = await shoot(`<div class="tile">${mark(Math.round(512 * 0.7))}</div>`, 512, 512);
await sharp(icon).ensureAlpha().png().toFile(path.join(out, "icon-512.png"));

await browser.close();
