// Renders the MAYTHA app icons and social image from HTML with the bundled fonts.
// Run: pnpm generate:brand
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const font = (file) =>
  `data:font/woff2;base64,${fs.readFileSync(path.join(root, "public/assets/fonts", file)).toString("base64")}`;
const css = `
@font-face { font-family: Playfair; src: url(${font("playfair-display-latin.woff2")}); font-weight: 400 600; }
@font-face { font-family: Naskh; src: url(${font("noto-naskh-arabic.woff2")}); font-weight: 500 700; }
html, body { margin: 0; }
.icon { display: grid; place-items: center; background: #183d32; color: #f8f7f3; font-family: Playfair; font-weight: 500; }
.og { width: 1200px; height: 630px; display: grid; place-content: center; justify-items: center; gap: 22px; background: #f8f7f3; color: #1c2722; }
.og .name { font-family: Playfair; font-size: 132px; font-weight: 500; letter-spacing: 0.06em; line-height: 1; }
.og .sub { font-family: Playfair; font-size: 26px; letter-spacing: 0.42em; color: #5f6a64; padding-inline-start: 0.42em; }
.og .rule { width: 96px; height: 2px; background: #183d32; margin-block: 10px; }
.og .line { font-family: Naskh; font-size: 40px; font-weight: 600; direction: rtl; }
`;
const icons = [
  ["favicon-16-v3.png", 16, 0.78],
  ["favicon-32-v3.png", 32, 0.78],
  ["apple-touch-icon-v3.png", 180, 0.62],
  ["icon-192-v3.png", 192, 0.62],
  ["icon-512-v3.png", 512, 0.62],
  // Maskable icons keep the letter inside the 80% safe zone.
  ["maskable-192-v3.png", 192, 0.48],
  ["maskable-512-v3.png", 512, 0.48],
];

{
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [file, size, scale] of icons) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>${css}</style><div class="icon" style="width:${size}px;height:${size}px;font-size:${Math.round(size * scale)}px">M</div>`,
    );
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(root, "public/brand/app", file) });
  }
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.setContent(
    `<style>${css}</style><div class="og"><div class="name">MAYTHA</div><div class="sub">HOME &amp; CARE</div><div class="rule"></div><div class="line">منتجات أصلية من ماركات بتعرفها وبتثق فيها.</div></div>`,
  );
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: path.join(root, "src/app/opengraph-image.png"),
  });
  await browser.close();
}
