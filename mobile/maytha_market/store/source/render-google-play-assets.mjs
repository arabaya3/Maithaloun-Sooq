// Renders the complete Google Play asset set into <repo>/google-play-store-assets/:
//   icon/MAYTHA_icon_512x512.png            same monogram art as the launcher icon (store/play/icon-512.png)
//   feature-graphic/MAYTHA_feature_1024x500.png   24-bit PNG, no alpha
//   phone-screenshots/NN-*.png              1080x1920, brand background + Arabic heading + REAL capture
// The phone captures in ./play-captures/ are real Pixel 5 emulator screenshots (1080x2340) of the
// release-like profile build against live catalog data; nothing on them is drawn by this script.
// Deterministic: bundled fonts, no network. Run from the repository root after `pnpm install`:
//   node mobile/maytha_market/store/source/render-google-play-assets.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import sharp from "sharp";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../..");
const outRoot = path.join(root, "google-play-store-assets");
const captures = path.join(here, "play-captures");
const font = (file) =>
  `data:font/woff2;base64,${fs.readFileSync(path.join(root, "public/assets/fonts", file)).toString("base64")}`;

// Brand colors (same as render-store-graphics.mjs and lib/ui/theme.dart).
const FOREST = "#183D32";
const DEEP = "#102F26";
const IVORY = "#F7F5EF";
const SAGE_LIGHT = "#A9C9B2";

// Monogram geometry, shared with tools/brand/render-brand-assets.mjs and render-store-graphics.mjs.
const mark = (size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">
  <path d="M13.5 51V18.2c0-2 2.5-2.9 3.7-1.3L32 36.6l14.8-19.7c1.2-1.6 3.7-.7 3.7 1.3V51" fill="none" stroke="${IVORY}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M32 31.2c-6.4-3.7-7.6-11.4-.1-19.7 7.6 8.3 6.4 16 .1 19.7Z" fill="${SAGE_LIGHT}"/>
  <path d="M32 29.2V15.4" fill="none" stroke="${FOREST}" stroke-width="1.1" stroke-linecap="round"/>
</svg>`;

// Phone screenshots: file name, capture, heading, verified sub-line, optional crop of the capture.
// Status bar (top 125 px) is cropped from every capture; nothing else is altered.
const STATUS_BAR = 125;
const SHOTS = [
  { file: "01-home.png", src: "ar-home.png", title: "تسوّق بسهولة", sub: "الأقسام والمنتجات من أول شاشة" },
  { file: "02-category-kitchen.png", src: "ar-category-kitchen.png", title: "منتجات متنوعة", sub: "تصفّح حسب القسم" },
  { file: "03-catalog-all-products.png", src: "ar-catalog-all.png", title: "كل احتياجاتك بمكان واحد", sub: "منظفات، غسيل، مطبخ وحمّام" },
  { file: "04-product-details.png", src: "ar-product-details.png", title: "تفاصيل واضحة وأسعار مناسبة", sub: "صور وسعر لكل منتج" },
  { file: "05-product-variant-choice.png", src: "ar-product-variants.png", title: "اختار المنتج المناسب", sub: "الرائحة أو الحجم اللي بدك إياه" },
  { file: "06-cart.png", src: "ar-cart.png", title: "سلة تسوق سهلة", sub: "عدّل الكميات بسهولة" },
  {
    file: "07-cart-whatsapp-order.png",
    src: "ar-cart.png",
    title: "اطلب عبر واتساب بخطوة وحدة",
    sub: "توصيل مجاني من 50 ₪، والدفع عند الاستلام",
    crop: { left: 0, top: 1404, width: 1080, height: 648 },
  },
  { file: "08-search-by-brand.png", src: "ar-search-brand.png", title: "ابحث بالاسم أو الماركة", sub: "لاقي منتجك بثواني" },
];

const css = `
@font-face { font-family: Playfair; src: url(${font("playfair-display-latin.woff2")}); font-weight: 400 600; }
@font-face { font-family: Naskh; src: url(${font("noto-naskh-arabic.woff2")}); font-weight: 500 700; }
@font-face { font-family: Readex; src: url(${font("readex-pro-v1.woff2")}); font-weight: 300 700; }
html, body { margin: 0; }
.fg { width: 1024px; height: 500px; box-sizing: border-box; display: flex; align-items: center; gap: 56px;
  padding: 0 72px; background: radial-gradient(circle at 18% 50%, ${FOREST} 0%, ${FOREST} 38%, ${DEEP} 100%); }
.fg .text { display: grid; gap: 20px; color: ${IVORY}; direction: rtl; text-align: right; flex: 1; }
.fg .name { font-family: Playfair; font-weight: 500; font-size: 34px; letter-spacing: 0.12em; direction: ltr; text-align: right; color: ${SAGE_LIGHT}; }
.fg .head { font-family: Readex; font-weight: 600; font-size: 46px; line-height: 1.35; white-space: nowrap; }
.fg .rule { width: 96px; height: 2px; background: ${SAGE_LIGHT}; justify-self: start; }
.fg .line { font-family: Readex; font-weight: 400; font-size: 27px; color: ${SAGE_LIGHT}; }
.tile { width: 512px; height: 512px; display: grid; place-items: center; background: ${FOREST}; }
.shot { width: 1080px; height: 1920px; box-sizing: border-box; position: relative; overflow: hidden;
  background: radial-gradient(circle at 80% 0%, ${FOREST} 0%, ${FOREST} 45%, ${DEEP} 100%);
  display: flex; flex-direction: column; align-items: center; }
.shot .top { direction: rtl; text-align: center; color: ${IVORY}; padding-top: 112px; height: 340px; box-sizing: border-box; }
.shot h1 { font-family: Readex; font-weight: 600; font-size: 66px; margin: 0 0 16px; line-height: 1.25; }
.shot p { font-family: Readex; font-weight: 400; font-size: 36px; margin: 0; color: ${SAGE_LIGHT}; }
.shot .brand { position: absolute; left: 44px; top: 40px; display: flex; align-items: center; gap: 12px;
  font-family: Playfair; font-size: 24px; letter-spacing: 0.14em; color: ${SAGE_LIGHT}; }
.phone { margin-top: 20px; padding: 14px; border-radius: 64px; background: #0B211A; box-shadow: 0 30px 80px rgba(0,0,0,.45);
  border: 2px solid rgba(169,201,178,.35); }
.phone img { display: block; height: 1500px; border-radius: 50px; }
.card { margin: auto 0; padding: 14px; border-radius: 40px; background: #0B211A; border: 2px solid rgba(169,201,178,.35);
  box-shadow: 0 30px 80px rgba(0,0,0,.45); }
.card img { display: block; width: 960px; border-radius: 28px; }
`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
const shoot = async (html, width, height) => {
  await page.setViewportSize({ width, height });
  await page.setContent(`<style>${css}</style>${html}`);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
  return page.screenshot();
};
const dir = (name) => {
  const d = path.join(outRoot, name);
  fs.mkdirSync(d, { recursive: true });
  return d;
};

// Icon: identical art to store/play/icon-512.png and the Android launcher icon (mark at 70% of a forest tile).
const icon = await shoot(`<div class="tile">${mark(Math.round(512 * 0.7))}</div>`, 512, 512);
await sharp(icon).ensureAlpha().png().toFile(path.join(dir("icon"), "MAYTHA_icon_512x512.png"));

// Feature graphic: logo + brand colors + Arabic headline. No product photos (third-party packaging).
const fg = await shoot(
  `<div class="fg">${mark(230)}<div class="text"><div class="name">MAYTHA MARKET</div>` +
    `<div class="head">كل احتياجات بيتك بمكان واحد</div><div class="rule"></div>` +
    `<div class="line">توصيل داخل ميثلون، والدفع عند الاستلام</div></div></div>`,
  1024,
  500,
);
await sharp(fg).removeAlpha().png().toFile(path.join(dir("feature-graphic"), "MAYTHA_feature_1024x500.png"));

// Phone screenshots.
const phoneDir = dir("phone-screenshots");
for (const f of fs.readdirSync(phoneDir)) fs.rmSync(path.join(phoneDir, f));
for (const s of SHOTS) {
  const src = path.join(captures, s.src);
  const meta = await sharp(src).metadata();
  const region = s.crop ?? { left: 0, top: STATUS_BAR, width: meta.width, height: meta.height - STATUS_BAR };
  const buf = await sharp(src).extract(region).png().toBuffer();
  const uri = `data:image/png;base64,${buf.toString("base64")}`;
  const body = s.crop ? `<div class="card"><img src="${uri}"></div>` : `<div class="phone"><img src="${uri}"></div>`;
  const png = await shoot(
    `<div class="shot"><div class="brand">${mark(40)}MAYTHA MARKET</div>` +
      `<div class="top"><h1>${s.title}</h1><p>${s.sub}</p></div>${body}</div>`,
    1080,
    1920,
  );
  await sharp(png).removeAlpha().png().toFile(path.join(phoneDir, s.file));
}

await browser.close();
console.log("rendered", SHOTS.length, "phone screenshots, icon and feature graphic into", outRoot);
