// Renders the MAYTHA app icons, favicon, social image and brand kit from the monogram and bundled fonts.
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

const FOREST = "#183D32";
const IVORY = "#F7F5EF";
const SAGE_DARK = "#6F9F80";
const SAGE_LIGHT = "#A9C9B2";

// Monogram geometry, shared with src/features/storefront/components/brand-logo.tsx.
const mark = (
  size,
  ink,
  leaf,
  rib,
) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">
  <path d="M13.5 51V18.2c0-2 2.5-2.9 3.7-1.3L32 36.6l14.8-19.7c1.2-1.6 3.7-.7 3.7 1.3V51" fill="none" stroke="${ink}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M32 31.2c-6.4-3.7-7.6-11.4-.1-19.7 7.6 8.3 6.4 16 .1 19.7Z" fill="${leaf}"/>${rib ? `\n  <path d="M32 29.2V15.4" fill="none" stroke="${rib}" stroke-width="1.1" stroke-linecap="round"/>` : ""}
</svg>`;
const onDark = (size, rib = true) =>
  mark(size, IVORY, SAGE_LIGHT, rib ? FOREST : null);
const onLight = (size, rib = true) =>
  mark(size, FOREST, SAGE_DARK, rib ? IVORY : null);

const css = `
@font-face { font-family: Playfair; src: url(${font("playfair-display-latin.woff2")}); font-weight: 400 600; }
@font-face { font-family: Naskh; src: url(${font("noto-naskh-arabic.woff2")}); font-weight: 500 700; }
html, body { margin: 0; background: transparent; }
.tile { display: grid; place-items: center; background: ${FOREST}; }
.lock { display: inline-flex; align-items: center; gap: 0.18em; padding: 0.3em 0.45em; }
.word { display: grid; justify-items: center; line-height: 1; }
.name { font-family: Playfair; font-weight: 500; letter-spacing: 0.06em; }
.sub { font-family: Playfair; font-size: 0.24em; letter-spacing: 0.32em; padding-inline-start: 0.32em; margin-top: 0.45em; }
.og { width: 1200px; height: 630px; display: grid; place-content: center; justify-items: center; gap: 20px; background: ${IVORY}; }
.og .line { font-family: Naskh; font-size: 40px; font-weight: 600; direction: rtl; color: ${FOREST}; }
.og .rule { width: 96px; height: 2px; background: ${FOREST}; }
`;

const lockup = (dark, full, size) => {
  const ink = dark ? FOREST : IVORY;
  const sub = dark ? "#5F6A64" : "#C9D8CD";
  const icon = dark
    ? onLight(Math.round(size * 1.3))
    : onDark(Math.round(size * 1.3));
  return `<span class="lock" style="font-size:${size}px;color:${ink}">${icon}<span class="word"><span class="name">MAYTHA</span>${full ? `<span class="sub" style="color:${sub}">HOME &amp; CARE</span>` : ""}</span></span>`;
};

// [file, size, mark share of the tile, midrib]. Maskable icons keep the mark inside the 80% safe zone;
// the smallest icons drop the midrib, which would only blur.
const icons = [
  ["favicon-16-v4.png", 16, 0.92, false],
  ["favicon-32-v4.png", 32, 0.86, false],
  ["favicon-48-v4.png", 48, 0.84, false],
  ["apple-touch-icon-v4.png", 180, 0.7, true],
  ["icon-192-v4.png", 192, 0.7, true],
  ["icon-512-v4.png", 512, 0.7, true],
  ["maskable-192-v4.png", 192, 0.56, true],
  ["maskable-512-v4.png", 512, 0.56, true],
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
const shoot = async (html, width, height, file, transparent = false) => {
  await page.setViewportSize({ width, height });
  await page.setContent(`<style>${css}</style>${html}`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: file, omitBackground: transparent });
};

const appDir = path.join(root, "public/brand/app");
for (const file of fs.readdirSync(appDir)) {
  if (/-v3\.png$/.test(file)) fs.rmSync(path.join(appDir, file));
}
for (const [file, size, share, rib] of icons) {
  await shoot(
    `<div class="tile" style="width:${size}px;height:${size}px">${onDark(Math.round(size * share), rib)}</div>`,
    size,
    size,
    path.join(appDir, file),
  );
}

// favicon.ico: the 16, 32 and 48 px PNGs packed in an ICO container.
{
  const sizes = [16, 32, 48];
  const images = sizes.map((size) =>
    fs.readFileSync(path.join(appDir, `favicon-${size}-v4.png`)),
  );
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((image, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(sizes[index], entry);
    header.writeUInt8(sizes[index], entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.length;
  });
  fs.writeFileSync(
    path.join(root, "src/app/favicon.ico"),
    Buffer.concat([header, ...images]),
  );
}

await shoot(
  `<div class="og">${lockup(true, true, 120)}<div class="rule"></div><div class="line">ماركات بتعرفها وبتثق فيها.</div></div>`,
  1200,
  630,
  path.join(root, "src/app/opengraph-image.png"),
);

// Brand kit for the owner: vector monograms, logo lockups and a WhatsApp Business profile picture.
const kit = path.join(root, "public/brand/kit");
fs.mkdirSync(kit, { recursive: true });
fs.writeFileSync(
  path.join(kit, "maytha-monogram-dark.svg"),
  `${onLight(64)}\n`,
);
fs.writeFileSync(
  path.join(kit, "maytha-monogram-light.svg"),
  `${onDark(64)}\n`,
);
await shoot(
  lockup(true, true, 96),
  660,
  190,
  path.join(kit, "maytha-logo-full-dark.png"),
  true,
);
await shoot(
  lockup(false, true, 96),
  660,
  190,
  path.join(kit, "maytha-logo-full-light.png"),
  true,
);
await shoot(
  lockup(true, false, 96),
  600,
  170,
  path.join(kit, "maytha-logo-compact-dark.png"),
  true,
);
await shoot(
  lockup(false, false, 96),
  600,
  170,
  path.join(kit, "maytha-logo-compact-light.png"),
  true,
);
// WhatsApp crops profile pictures to a circle, so the mark stays well inside it.
await shoot(
  `<div class="tile" style="width:1024px;height:1024px">${onDark(560)}</div>`,
  1024,
  1024,
  path.join(kit, "maytha-whatsapp-profile.png"),
);
await browser.close();
