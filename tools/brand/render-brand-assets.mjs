// Renders the MAYTHA MARKET app icons, favicon, in-page logo files, social image and brand kit
// from the approved original logo (tools/brand/maytha-logo-original.png, 512x512, no alpha).
// The mark is never redrawn: every file is a resize, crop or background mask of the original.
// Run: pnpm generate:brand
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import sharp from "sharp";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const SOURCE = path.join(root, "tools/brand/maytha-logo-original.png");
const VERSION = "v5";
// The logo's own background colour, sampled from the original tile.
const TILE_BG = { r: 248, g: 250, b: 245 };
const TILE_BG_HEX = "#F8FAF5";
const FOREST = "#0E5A2F";
// The original sits on a rounded square (about 68px radius) with a faint grey rim and white corners.
const TILE_INSET = 4;
const TILE_RADIUS = 66;
// Roof, cart, sparkles and leaves without the wordmark, with a little breathing room.
const MARK_CROP = { left: 60, top: 45, width: 356, height: 216 };

const appDir = path.join(root, "public/brand/app");
const logoDir = path.join(root, "public/brand/logo");
const kitDir = path.join(root, "public/brand/kit");
for (const dir of [appDir, logoDir, kitDir]) {
  fs.mkdirSync(dir, { recursive: true });
}
for (const file of fs.readdirSync(appDir)) {
  if (!file.includes(`-${VERSION}.`)) fs.rmSync(path.join(appDir, file));
}

const roundedMask = (size, inset, radius) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect x="${inset}" y="${inset}" width="${size - inset * 2}" height="${size - inset * 2}" rx="${radius}" fill="#fff"/></svg>`,
  );

// The rounded tile with transparent corners (for light page surfaces).
const tileRounded = await sharp(SOURCE)
  .ensureAlpha()
  .composite([
    { input: roundedMask(512, TILE_INSET, TILE_RADIUS), blend: "dest-in" },
  ])
  .png()
  .toBuffer();

// Full-bleed square: corners and rim become the tile colour, so platforms can apply their own mask.
const tileSquare = await sharp({
  create: { width: 512, height: 512, channels: 3, background: TILE_BG },
})
  .composite([{ input: tileRounded }])
  .png()
  .toBuffer();

// The mark alone with its light background keyed out. Pixels close to the tile colour become
// transparent along a soft ramp; the green artwork keeps its exact colours.
async function transparentMark() {
  const { data, info } = await sharp(SOURCE)
    .extract(MARK_CROP)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0, o = 0; i < data.length; i += 3, o += 4) {
    const diff = Math.max(
      Math.abs(data[i] - TILE_BG.r),
      Math.abs(data[i + 1] - TILE_BG.g),
      Math.abs(data[i + 2] - TILE_BG.b),
    );
    const alpha = Math.max(0, Math.min(1, (diff - 10) / 36));
    out[o] = data[i];
    out[o + 1] = data[i + 1];
    out[o + 2] = data[i + 2];
    out[o + 3] = Math.round(alpha * 255);
  }
  return sharp(out, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
}
const mark = await transparentMark();

// Small icons: the mark alone (the wordmark would be illegible), centred on the tile colour.
async function markIcon(size, share) {
  const inner = Math.round(size * share);
  const resized = await sharp(mark)
    .resize({ width: inner, height: inner, fit: "inside", kernel: "lanczos3" })
    .toBuffer();
  return sharp({
    create: { width: size, height: size, channels: 3, background: TILE_BG },
  })
    .composite([{ input: resized, gravity: "centre" }])
    .png()
    .toBuffer();
}

// Maskable icons keep the whole logo inside the 80% safe zone.
async function maskableIcon(size) {
  const inner = Math.round(size * 0.8);
  const resized = await sharp(tileSquare).resize(inner, inner).toBuffer();
  return sharp({
    create: { width: size, height: size, channels: 3, background: TILE_BG },
  })
    .composite([{ input: resized, gravity: "centre" }])
    .png()
    .toBuffer();
}

const write = (dir, file, buffer) =>
  fs.writeFileSync(path.join(dir, file), buffer);
const resize = (input, size) =>
  sharp(input).resize(size, size, { kernel: "lanczos3" }).png().toBuffer();

const favicons = { 16: 0.96, 32: 0.94, 48: 0.9 };
for (const [size, share] of Object.entries(favicons)) {
  write(
    appDir,
    `favicon-${size}-${VERSION}.png`,
    await markIcon(Number(size), share),
  );
}
write(appDir, `apple-touch-icon-${VERSION}.png`, await resize(tileSquare, 180));
write(appDir, `icon-192-${VERSION}.png`, await resize(tileSquare, 192));
write(appDir, `icon-512-${VERSION}.png`, tileSquare);
write(appDir, `maskable-192-${VERSION}.png`, await maskableIcon(192));
write(appDir, `maskable-512-${VERSION}.png`, await maskableIcon(512));

// favicon.ico: the 16, 32 and 48 px PNGs packed in an ICO container.
{
  const sizes = [16, 32, 48];
  const images = sizes.map((size) =>
    fs.readFileSync(path.join(appDir, `favicon-${size}-${VERSION}.png`)),
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

// In-page files: the rounded tile at two sizes, and the transparent mark for the header.
write(logoDir, `maytha-logo-512-${VERSION}.png`, tileRounded);
write(
  logoDir,
  `maytha-logo-256-${VERSION}.png`,
  await sharp(tileRounded).resize(256, 256).png().toBuffer(),
);
write(logoDir, `maytha-mark-${VERSION}.png`, mark);

// Owner brand kit.
write(kitDir, "maytha-logo-original.png", fs.readFileSync(SOURCE));
write(kitDir, "maytha-logo-rounded.png", tileRounded);
write(kitDir, "maytha-mark-transparent.png", mark);
// WhatsApp crops profile pictures to a circle; the logo stays inside it (upscaled from the 512px source).
write(kitDir, "maytha-whatsapp-profile.png", await maskableIcon(640));

// Social image, rendered in a browser so the Arabic tagline is shaped correctly.
const font = (file) =>
  `data:font/woff2;base64,${fs.readFileSync(path.join(root, "public/assets/fonts", file)).toString("base64")}`;
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(`<style>
@font-face { font-family: Naskh; src: url(${font("noto-naskh-arabic.woff2")}); font-weight: 500 700; }
html, body { margin: 0; }
.og { width: 1200px; height: 630px; display: grid; place-content: center; justify-items: center; gap: 18px; background: ${TILE_BG_HEX}; }
.og img { width: 440px; height: 440px; }
.og .line { font-family: Naskh; font-size: 40px; font-weight: 600; direction: rtl; color: ${FOREST}; }
</style><div class="og"><img src="data:image/png;base64,${tileRounded.toString("base64")}" alt=""><div class="line">ماركات بتعرفها وبتثق فيها.</div></div>`);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({
  path: path.join(root, "src/app/opengraph-image.png"),
});
await browser.close();
