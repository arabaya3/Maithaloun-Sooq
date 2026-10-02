import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "public/brand/maithaloun-symbol.png");
const output = resolve(root, "public/brand/app");
const VERSION = "v2";
const BACKGROUND = { r: 255, g: 255, b: 255, alpha: 1 };

// Width of the logo as a share of the canvas. Maskable icons keep the whole
// symbol inside the central 80% circle so no launcher mask clips it.
const icons = [
  { name: `favicon-16-${VERSION}.png`, size: 16, logo: 0.94 },
  { name: `favicon-32-${VERSION}.png`, size: 32, logo: 0.94 },
  { name: `apple-touch-icon-${VERSION}.png`, size: 180, logo: 0.74 },
  { name: `icon-192-${VERSION}.png`, size: 192, logo: 0.78 },
  { name: `icon-512-${VERSION}.png`, size: 512, logo: 0.7 },
  { name: `maskable-192-${VERSION}.png`, size: 192, logo: 0.6 },
  { name: `maskable-512-${VERSION}.png`, size: 512, logo: 0.6 },
];

const symbol = await sharp(source).trim({ threshold: 1 }).toBuffer();

async function render(size, share) {
  const logo = await sharp(symbol)
    .resize({ width: Math.round(size * share), kernel: "lanczos3" })
    .toBuffer();
  return sharp({
    create: { width: size, height: size, channels: 4, background: BACKGROUND },
  })
    .composite([{ input: logo, gravity: "center" }])
    .flatten({ background: BACKGROUND })
    .png({ compressionLevel: 9, palette: size >= 180, quality: 90 })
    .toBuffer();
}

function ico(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(size, entry);
    header.writeUInt8(size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map(({ data }) => data)]);
}

await mkdir(output, { recursive: true });
for (const icon of icons) {
  await writeFile(
    resolve(output, icon.name),
    await render(icon.size, icon.logo),
  );
}
const favicon = await Promise.all(
  [16, 32, 48].map(async (size) => ({ size, data: await render(size, 0.94) })),
);
await writeFile(resolve(root, "src/app/favicon.ico"), ico(favicon));
