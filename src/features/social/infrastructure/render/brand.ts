import path from "node:path";

import sharp, { type OverlayOptions } from "sharp";

/** MAYTHA MARKET's approved identity: the storefront's tokens, the store logo and Cairo (OFL). */
export const brand = {
  green: "#0e5a2f",
  greenDeep: "#0a4524",
  greenTint: "#e6efe4",
  sage: "#a3c49a",
  canvas: "#f7f8f3",
  surface: "#ffffff",
  sand: "#e5ebdd",
  text: "#15241b",
  muted: "#55635a",
  amber: "#8a5a1f",
  amberTint: "#f6eee2",
} as const;

export function assetPath(...parts: string[]): string {
  return path.join(process.cwd(), ...parts);
}

export const fontFile = () =>
  assetPath("src", "features", "social", "assets", "Cairo-Variable.ttf");
export const logoFile = () =>
  assetPath("public", "brand", "kit", "maytha-logo-rounded.png");

/**
 * Cairo has no shekel sign (₪). Noto Sans Hebrew (OFL) supplies that glyph only: it is listed after
 * Cairo, so every other character keeps Cairo. A server without system fonts (Vercel) otherwise
 * draws a missing-glyph box.
 */
export const fallbackFamily = "Noto Sans Hebrew";
export const fallbackFontFiles = () =>
  ["NotoSansHebrew-Regular.ttf", "NotoSansHebrew-Bold.ttf"].map((file) =>
    assetPath("src", "features", "social", "assets", file),
  );
export const textFont = (size: number) => `Cairo, ${fallbackFamily} ${size}`;

let fallbackRegistered: Promise<void> | null = null;

/** libvips adds each `fontfile` to the process's fontconfig once; later text can then fall back to it. */
function registerFallbackFonts(): Promise<void> {
  fallbackRegistered ??= (async () => {
    for (const fontfile of fallbackFontFiles()) {
      await sharp({ text: { text: "₪", font: fallbackFamily, fontfile } })
        .png()
        .toBuffer();
    }
  })();
  return fallbackRegistered;
}

export interface TextBlock {
  input: Buffer;
  width: number;
  height: number;
}

function escapeMarkup(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Keeps a phone number or address left-to-right inside Arabic text («+972…», not «…972+»). */
export function ltr(value: string): string {
  return `⁦${value}⁩`;
}

export interface TextOptions {
  size: number;
  color?: string;
  weight?: "regular" | "semibold" | "bold" | "heavy";
  width: number;
  align?: "right" | "center" | "left";
  /** Shrinks the font until the block fits this height. */
  maxHeight?: number;
  lineSpacing?: number;
}

const weights = { regular: 400, semibold: 600, bold: 700, heavy: 800 };

/** Arabic text shaped by Pango with the Cairo font; RTL and joining are handled by the shaper. */
export async function renderText(
  text: string,
  options: TextOptions,
): Promise<TextBlock> {
  await registerFallbackFonts();
  let size = options.size;
  for (;;) {
    const markup = `<span foreground="${options.color ?? brand.text}" font_weight="${weights[options.weight ?? "regular"]}">${escapeMarkup(text)}</span>`;
    const { data, info } = await sharp({
      text: {
        text: markup,
        font: textFont(size),
        fontfile: fontFile(),
        rgba: true,
        width: options.width,
        align: options.align ?? "right",
        wrap: "word",
        ...(options.lineSpacing
          ? { spacing: Math.round(size * options.lineSpacing) }
          : {}),
      },
    })
      .png()
      .toBuffer({ resolveWithObject: true });
    if (!options.maxHeight || info.height <= options.maxHeight || size <= 18) {
      return { input: data, width: info.width, height: info.height };
    }
    size = Math.floor(size * 0.9);
  }
}

/** Places a text block inside a box, honouring the alignment the block was laid out with. */
export function placeText(
  block: TextBlock,
  box: { left: number; top: number; width: number },
  align: "right" | "center" | "left" = "right",
): OverlayOptions {
  const left =
    align === "right"
      ? box.left + box.width - block.width
      : align === "center"
        ? box.left + Math.round((box.width - block.width) / 2)
        : box.left;
  return { input: block.input, left: Math.max(0, left), top: box.top };
}

export function roundedRect(
  width: number,
  height: number,
  radius: number,
  fill: string,
  stroke?: string,
): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="${radius}" ry="${radius}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="2"` : ""}/></svg>`,
  );
}

/** Soft leaf shapes in the brand's sage, drawn rather than copied, so no stock artwork is involved. */
export function leafDecoration(
  width: number,
  height: number,
  opacity = 0.35,
): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <g fill="${brand.sage}" fill-opacity="${opacity}">
        <path d="M0 ${height * 0.18} C ${width * 0.18} ${height * 0.02}, ${width * 0.34} ${height * 0.1}, ${width * 0.3} ${height * 0.26} C ${width * 0.18} ${height * 0.3}, ${width * 0.06} ${height * 0.27}, 0 ${height * 0.18} Z"/>
        <path d="M${width} ${height * 0.86} C ${width * 0.8} ${height * 0.98}, ${width * 0.64} ${height * 0.92}, ${width * 0.68} ${height * 0.78} C ${width * 0.82} ${height * 0.74}, ${width * 0.94} ${height * 0.78}, ${width} ${height * 0.86} Z"/>
      </g>
    </svg>`,
  );
}

export async function logo(size: number): Promise<Buffer> {
  return sharp(logoFile())
    .resize(size, size, { fit: "contain" })
    .png()
    .toBuffer();
}

export type ImageLoader = (url: string) => Promise<Buffer>;

/** Downloads a catalog photo; only https sources from the catalog are ever requested. */
export const fetchImage: ImageLoader = async (url) => {
  if (!url.startsWith("https://")) throw new Error("IMAGE_URL_REJECTED");
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error("IMAGE_FETCH_FAILED");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > 15_000_000) throw new Error("IMAGE_TOO_LARGE");
  return bytes;
};

/** A product photo on a white rounded card, never cropped: packaging text stays readable. */
export async function productCard(
  photo: Buffer,
  width: number,
  height: number,
  padding = 28,
): Promise<Buffer> {
  const inner = await sharp(photo)
    .rotate()
    .resize(width - padding * 2, height - padding * 2, {
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .flatten({ background: "#ffffff" })
    .png()
    .toBuffer();
  const mask = roundedRect(width, height, 36, "#000");
  return sharp(roundedRect(width, height, 36, brand.surface, brand.sand))
    .composite([
      { input: inner, left: padding, top: padding },
      { input: mask, blend: "dest-in" },
    ])
    .png()
    .toBuffer();
}

export function pill(width: number, height: number, fill: string): Buffer {
  return roundedRect(width, height, height / 2, fill);
}
