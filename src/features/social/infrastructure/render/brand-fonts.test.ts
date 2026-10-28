import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { formatIls } from "@/shared/lib/format-currency";

import { fallbackFontFiles, fontFile, textFont } from "./brand";

const SHEKEL = 0x20aa;

/** Whether a TrueType font maps a code point, read from its cmap (formats 4 and 12). */
function fontHasGlyph(file: string, codePoint: number): boolean {
  const font = readFileSync(file);
  const tables = font.readUInt16BE(4);
  let cmap = -1;
  for (let i = 0; i < tables; i += 1) {
    const record = 12 + i * 16;
    if (font.toString("latin1", record, record + 4) === "cmap") {
      cmap = font.readUInt32BE(record + 8);
    }
  }
  if (cmap < 0) return false;
  const subtables = font.readUInt16BE(cmap + 2);
  for (let i = 0; i < subtables; i += 1) {
    const table = cmap + font.readUInt32BE(cmap + 4 + i * 8 + 4);
    const format = font.readUInt16BE(table);
    if (format === 4) {
      const segments = font.readUInt16BE(table + 6) / 2;
      const ends = table + 14;
      const starts = ends + segments * 2 + 2;
      for (let s = 0; s < segments; s += 1) {
        const end = font.readUInt16BE(ends + s * 2);
        const start = font.readUInt16BE(starts + s * 2);
        if (codePoint >= start && codePoint <= end && start !== 0xffff) {
          return true;
        }
      }
    } else if (format === 12) {
      const groups = font.readUInt32BE(table + 12);
      for (let g = 0; g < groups; g += 1) {
        const group = table + 16 + g * 12;
        if (
          codePoint >= font.readUInt32BE(group) &&
          codePoint <= font.readUInt32BE(group + 4)
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

describe("social image fonts", () => {
  it("prices use the shekel sign, which Cairo lacks", () => {
    expect(formatIls(1500)).toContain("₪");
    expect(fontHasGlyph(fontFile(), "ب".codePointAt(0)!)).toBe(true);
    expect(fontHasGlyph(fontFile(), SHEKEL)).toBe(false);
  });

  it("every bundled fallback font draws the shekel sign, so it never renders as a box", () => {
    const files = fallbackFontFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) expect(fontHasGlyph(file, SHEKEL)).toBe(true);
  });

  it("keeps Cairo first and uses the fallback only for missing glyphs", () => {
    expect(textFont(40)).toBe("Cairo, Noto Sans Hebrew 40");
  });
});
