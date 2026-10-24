// Generates brand assets from the approved original logo (no redraw).
// Usage: node tool/gen_brand.js <original.png> <outDir>   (needs `sharp` resolvable via NODE_PATH)
const sharp = require('sharp');
const [src, out] = process.argv.slice(2);
const BG = { r: 0xf8, g: 0xfa, b: 0xf5, alpha: 1 };
(async () => {
  await sharp(src).png().toFile(`${out}/logo-original.png`);
  await sharp(src).png().toFile(`${out}/icon-512.png`);
  // Adaptive/maskable: logo scaled into the 66% safe zone on the logo's own background colour.
  const inner = Math.round(512 * 0.66);
  const scaled = await sharp(src).resize(inner, inner, { kernel: 'lanczos3' }).png().toBuffer();
  await sharp({ create: { width: 512, height: 512, channels: 4, background: BG } })
    .composite([{ input: scaled, gravity: 'center' }]).png().toFile(`${out}/maskable-512.png`);
  // Transparent adaptive foreground (432 canvas semantics scaled to 512).
  await sharp({ create: { width: 512, height: 512, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: scaled, gravity: 'center' }]).png().toFile(`${out}/adaptive-foreground-512.png`);
  // Symbol-only crop (roof + cart + leaf + sparkles) for the compact in-app header.
  await sharp(src).extract({ left: 60, top: 48, width: 360, height: 210 }).png().toFile(`${out}/logo-mark.png`);
})();
