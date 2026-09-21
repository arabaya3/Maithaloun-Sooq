import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function createIcon(size) {
  const stride = size * 4 + 1;
  const pixels = Buffer.alloc(stride * size);

  for (let y = 0; y < size; y += 1) {
    pixels[y * stride] = 0;
    for (let x = 0; x < size; x += 1) {
      const offset = y * stride + 1 + x * 4;
      const nx = (x - size / 2) / size;
      const ny = (y - size / 2) / size;
      const leafA = ((nx + 0.1) / 0.24) ** 2 + ((ny + 0.08) / 0.36) ** 2 < 1;
      const leafB = ((nx - 0.14) / 0.2) ** 2 + ((ny - 0.07) / 0.29) ** 2 < 1;
      const stem = Math.abs(nx + ny * 0.45) < 0.018 && ny > -0.22 && ny < 0.3;
      const color = leafA || leafB || stem ? [223, 244, 237] : [13, 74, 67];
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
      pixels[offset + 3] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const outputDirectory = resolve(root, "public", "icons");
await mkdir(outputDirectory, { recursive: true });
await Promise.all(
  [192, 512].map((size) =>
    writeFile(resolve(outputDirectory, `icon-${size}.png`), createIcon(size)),
  ),
);
