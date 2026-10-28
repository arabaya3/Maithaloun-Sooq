/**
 * Cuts ميثو's approved poses out of the owner's brand sheet into transparent PNGs.
 *
 *   pnpm exec tsx tools/mascot-cutout.ts <brand-sheet.png> [outDir]
 *
 * Only light, low-colour background that is connected to a crop's border is removed, so the white
 * bag, logo and apron letters inside the character stay. Run once when the sheet changes; the
 * results are committed under src/features/social/assets/mascot/.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

interface Pose {
  name: string;
  left: number;
  top: number;
  width: number;
  height: number;
  /** Areas of the crop that belong to the sheet's other content, painted out before the cut. */
  erase?: Box[];
  /** Areas that are part of the character even where they are white and touch the edge (the bag). */
  keep?: Box[];
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const inside = (box: Box, x: number, y: number) =>
  x >= box.left &&
  x < box.left + box.width &&
  y >= box.top &&
  y < box.top + box.height;

// Coordinates on the 1536×1024 sheet the owner approved on 28 Oct 2026.
const poses: Pose[] = [
  {
    name: "presenting",
    left: 0,
    top: 0,
    width: 470,
    height: 645,
    erase: [
      { left: 392, top: 0, width: 78, height: 335 },
      { left: 0, top: 0, width: 40, height: 645 },
    ],
    keep: [{ left: 345, top: 405, width: 108, height: 163 }],
  },
  { name: "wave", left: 732, top: 252, width: 118, height: 162 },
  { name: "wink", left: 864, top: 252, width: 118, height: 162 },
  { name: "delivery", left: 992, top: 252, width: 118, height: 162 },
  { name: "tip", left: 1124, top: 252, width: 118, height: 162 },
  { name: "shopping", left: 1257, top: 252, width: 118, height: 162 },
  { name: "love", left: 1387, top: 252, width: 118, height: 162 },
];

function isBackground(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return 0.299 * r + 0.587 * g + 0.114 * b > 168 && max - min < 64;
}

async function cut(sheet: string, pose: Pose, outDir: string) {
  const { data, info } = await sharp(sheet)
    .extract(pose)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  for (const box of pose.erase ?? []) {
    for (let y = box.top; y < box.top + box.height; y += 1) {
      for (let x = box.left; x < box.left + box.width; x += 1) {
        const i = (y * width + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 250;
      }
    }
  }
  // Flood fill from every border pixel through background-coloured pixels.
  const removed = new Uint8Array(width * height);
  const stack: number[] = [];
  for (let x = 0; x < width; x += 1) stack.push(x, (height - 1) * width + x);
  for (let y = 0; y < height; y += 1)
    stack.push(y * width, y * width + width - 1);
  while (stack.length) {
    const p = stack.pop()!;
    if (removed[p]) continue;
    const i = p * 4;
    const x = p % width;
    if (pose.keep?.some((box) => inside(box, x, Math.floor(p / width)))) {
      continue;
    }
    if (!isBackground(data[i]!, data[i + 1]!, data[i + 2]!)) continue;
    removed[p] = 1;
    if (x > 0) stack.push(p - 1);
    if (x < width - 1) stack.push(p + 1);
    if (p >= width) stack.push(p - width);
    if (p < width * (height - 1)) stack.push(p + width);
  }
  const mask = Buffer.alloc(width * height);
  for (let p = 0; p < width * height; p += 1) mask[p] = removed[p] ? 0 : 255;
  // A slight blur softens the cut edge; the mask then drops small specks it left behind.
  const soft = await sharp(mask, { raw: { width, height, channels: 1 } })
    .blur(0.8)
    .extractChannel(0)
    .raw()
    .toBuffer();
  for (let p = 0; p < width * height; p += 1) data[p * 4 + 3] = soft[p]!;
  await sharp(data, { raw: { width, height, channels: 4 } })
    .trim({ threshold: 1 })
    .png()
    .toFile(path.join(outDir, `${pose.name}.png`));
}

const [sheet, outDir = "src/features/social/assets/mascot"] =
  process.argv.slice(2);
if (!sheet) {
  console.error("Usage: tsx tools/mascot-cutout.ts <brand-sheet.png> [outDir]");
  process.exit(2);
}
await mkdir(outDir, { recursive: true });
for (const pose of poses) await cut(sheet, pose, outDir);
console.log(`Cut ${poses.length} poses into ${outDir}`);
