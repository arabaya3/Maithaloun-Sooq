import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp, { type OverlayOptions } from "sharp";

import type { ReelTemplate } from "@/features/social/domain/captions";
import {
  formatSocialPrice,
  type SocialProduct,
  type StoreFacts,
} from "@/features/social/domain/social-catalog";
import { formatIls } from "@/shared/lib/format-currency";

import {
  brand,
  leafDecoration,
  logo,
  ltr,
  pill,
  placeText,
  productCard,
  renderText,
  roundedRect,
} from "./brand";
import { iconBadge } from "./icons";
import { deliveryRows, footer, header } from "./image-templates";

export const REEL_WIDTH = 1080;
export const REEL_HEIGHT = 1920;
const FPS = 30;
const TRANSITION_SECONDS = 0.6;

export interface ReelRenderInput {
  template: ReelTemplate;
  products: readonly SocialProduct[];
  photos: ReadonlyMap<string, Buffer>;
  store: StoreFacts;
  siteLabel: string;
}

interface Scene {
  png: Buffer;
  seconds: number;
  zoom: "in" | "out" | "none";
  transition: string;
}

type Layer = OverlayOptions;

async function compose(background: string, layers: Layer[]): Promise<Buffer> {
  return sharp({
    create: { width: REEL_WIDTH, height: REEL_HEIGHT, channels: 4, background },
  })
    .composite(layers)
    .flatten({ background })
    .png()
    .toBuffer();
}

async function introScene(title: string, subtitle: string): Promise<Buffer> {
  const logoSize = 420;
  const heading = await renderText(title, {
    size: 84,
    weight: "heavy",
    color: brand.surface,
    width: 960,
    align: "center",
    maxHeight: 280,
  });
  const sub = await renderText(subtitle, {
    size: 46,
    color: brand.greenTint,
    width: 960,
    align: "center",
    maxHeight: 200,
  });
  const logoCard = await sharp(
    roundedRect(logoSize + 40, logoSize + 40, 60, brand.surface),
  )
    .composite([{ input: await logo(logoSize), left: 20, top: 20 }])
    .png()
    .toBuffer();
  return compose(brand.green, [
    { input: leafDecoration(REEL_WIDTH, REEL_HEIGHT, 0.18), left: 0, top: 0 },
    { input: logoCard, left: (REEL_WIDTH - logoSize - 40) / 2, top: 420 },
    placeText(heading, { left: 60, top: 980, width: 960 }, "center"),
    placeText(
      sub,
      { left: 60, top: 1000 + heading.height + 30, width: 960 },
      "center",
    ),
  ]);
}

async function productScene(
  product: SocialProduct,
  input: ReelRenderInput,
  label: string,
): Promise<Buffer> {
  const photo = input.photos.get(product.id);
  if (!photo) throw new Error("PRODUCT_PHOTO_MISSING");
  const cardWidth = 900;
  const cardHeight = 980;
  const name = await renderText(product.name, {
    size: 54,
    weight: "bold",
    color: brand.text,
    width: 960,
    align: "center",
    maxHeight: 230,
  });
  const priceLabel = await renderText(formatSocialPrice(product), {
    size: 56,
    weight: "heavy",
    color: brand.surface,
    width: 800,
  });
  const priceWidth = priceLabel.width + 100;
  const priceHeight = priceLabel.height + 44;
  const priceTop = 300 + cardHeight + 40 + name.height + 30;
  return compose(brand.canvas, [
    { input: leafDecoration(REEL_WIDTH, REEL_HEIGHT), left: 0, top: 0 },
    ...(await header(REEL_WIDTH, 90, label)),
    {
      input: await productCard(photo, cardWidth, cardHeight, 36),
      left: (REEL_WIDTH - cardWidth) / 2,
      top: 300,
    },
    placeText(
      name,
      { left: 60, top: 300 + cardHeight + 40, width: 960 },
      "center",
    ),
    {
      input: pill(priceWidth, priceHeight, brand.green),
      left: Math.round((REEL_WIDTH - priceWidth) / 2),
      top: priceTop,
    },
    {
      input: priceLabel.input,
      left: Math.round((REEL_WIDTH - priceLabel.width) / 2),
      top: priceTop + 22,
    },
    ...(await footer(
      REEL_WIDTH,
      REEL_HEIGHT,
      input.store,
      input.siteLabel,
      200,
    )),
  ]);
}

/** Variants are shown only by their own labels, as the owner wrote them. */
async function variantsScene(
  product: SocialProduct,
  input: ReelRenderInput,
): Promise<Buffer | null> {
  if (product.variants.length < 2) return null;
  const layers: Layer[] = [
    { input: leafDecoration(REEL_WIDTH, REEL_HEIGHT), left: 0, top: 0 },
    ...(await header(REEL_WIDTH, 90, "الخيارات المتوفرة")),
  ];
  const title = await renderText("متوفر بأكثر من خيار", {
    size: 70,
    weight: "heavy",
    color: brand.green,
    width: 960,
    align: "center",
  });
  layers.push(placeText(title, { left: 60, top: 360, width: 960 }, "center"));
  let y = 360 + title.height + 40;
  const samePrice = product.variants.every(
    (variant) => variant.priceAgorot === product.variants[0]!.priceAgorot,
  );
  if (samePrice) {
    const price = await renderText(
      `كل الخيارات بـ ${formatIls(product.priceAgorot)}`,
      {
        size: 46,
        weight: "bold",
        color: brand.amber,
        width: 960,
        align: "center",
      },
    );
    layers.push(placeText(price, { left: 60, top: y, width: 960 }, "center"));
    y += price.height + 50;
  } else {
    y += 20;
  }
  for (const variant of product.variants.slice(0, 5)) {
    const labelWidth = samePrice ? 860 : 640;
    const row = await renderText(variant.label, {
      size: 38,
      weight: "semibold",
      color: brand.text,
      width: labelWidth,
      maxHeight: 110,
    });
    const height = row.height + 60;
    layers.push({
      input: roundedRect(960, height, 32, brand.surface, brand.sand),
      left: 60,
      top: y,
    });
    layers.push(
      placeText(
        row,
        { left: 980 - labelWidth, top: y + 30, width: labelWidth },
        samePrice ? "center" : "right",
      ),
    );
    if (!samePrice) {
      const price = await renderText(formatIls(variant.priceAgorot), {
        size: 40,
        weight: "heavy",
        color: brand.amber,
        width: 220,
      });
      layers.push({
        input: price.input,
        left: 100,
        top: y + Math.round((height - price.height) / 2),
      });
    }
    y += height + 28;
  }
  layers.push(
    ...(await footer(
      REEL_WIDTH,
      REEL_HEIGHT,
      input.store,
      input.siteLabel,
      200,
    )),
  );
  return compose(brand.canvas, layers);
}

async function deliveryScene(input: ReelRenderInput): Promise<Buffer> {
  const layers: Layer[] = [
    { input: leafDecoration(REEL_WIDTH, REEL_HEIGHT), left: 0, top: 0 },
    ...(await header(REEL_WIDTH, 90, "التوصيل")),
  ];
  const title = await renderText("كيف بنوصّلكم؟", {
    size: 76,
    weight: "heavy",
    color: brand.green,
    width: 960,
    align: "center",
  });
  layers.push(placeText(title, { left: 60, top: 380, width: 960 }, "center"));
  let y = 380 + title.height + 70;
  for (const row of deliveryRows(input.store)) {
    const cardHeight = 210;
    layers.push({
      input: roundedRect(960, cardHeight, 36, brand.surface, brand.sand),
      left: 60,
      top: y,
    });
    layers.push({
      input: iconBadge(row.icon, 130, brand.greenTint, brand.green),
      left: 1020 - 40 - 130,
      top: y + 40,
    });
    const rowTitle = await renderText(row.title, {
      size: 42,
      weight: "bold",
      color: brand.text,
      width: 740,
    });
    layers.push(placeText(rowTitle, { left: 100, top: y + 36, width: 740 }));
    const body = await renderText(row.body, {
      size: 32,
      color: brand.muted,
      width: 740,
      maxHeight: 90,
    });
    layers.push(
      placeText(body, { left: 100, top: y + 44 + rowTitle.height, width: 740 }),
    );
    y += cardHeight + 34;
  }
  return compose(brand.canvas, layers);
}

async function callToActionScene(input: ReelRenderInput): Promise<Buffer> {
  const logoSize = 300;
  const logoCard = await sharp(
    roundedRect(logoSize + 30, logoSize + 30, 48, brand.surface),
  )
    .composite([{ input: await logo(logoSize), left: 15, top: 15 }])
    .png()
    .toBuffer();
  const heading = await renderText("اطلبوا هلأ", {
    size: 96,
    weight: "heavy",
    color: brand.surface,
    width: 960,
    align: "center",
  });
  const site = await renderText(ltr(input.siteLabel), {
    size: 44,
    weight: "bold",
    color: brand.surface,
    width: 900,
    align: "center",
  });
  const whatsapp = input.store.whatsAppE164
    ? await renderText(`واتساب ${ltr(input.store.whatsAppE164)}`, {
        size: 50,
        weight: "bold",
        color: brand.surface,
        width: 900,
        align: "center",
      })
    : null;
  const delivery = await renderText(
    `توصيل داخل ${input.store.deliveryAreaAr} • مجاني من ${formatIls(input.store.freeDeliveryFromAgorot)}`,
    {
      size: 40,
      color: brand.greenTint,
      width: 960,
      align: "center",
      maxHeight: 140,
    },
  );
  const layers: Layer[] = [
    { input: leafDecoration(REEL_WIDTH, REEL_HEIGHT, 0.18), left: 0, top: 0 },
    { input: logoCard, left: (REEL_WIDTH - logoSize - 30) / 2, top: 360 },
    placeText(heading, { left: 60, top: 760, width: 960 }, "center"),
  ];
  let y = 760 + heading.height + 60;
  for (const block of [site, whatsapp].filter((value) => value !== null)) {
    const width = Math.min(1000, block.width + 120);
    const height = block.height + 50;
    layers.push({
      input: pill(width, height, brand.greenDeep),
      left: Math.round((REEL_WIDTH - width) / 2),
      top: y,
    });
    layers.push(
      placeText(block, { left: 0, top: y + 25, width: REEL_WIDTH }, "center"),
    );
    y += height + 30;
  }
  layers.push(
    placeText(delivery, { left: 60, top: y + 40, width: 960 }, "center"),
  );
  return compose(brand.green, layers);
}

const transitions = [
  "fade",
  "slideleft",
  "smoothup",
  "circleopen",
  "slideright",
  "fadeblack",
];

export async function buildReelScenes(
  input: ReelRenderInput,
): Promise<Scene[]> {
  const scenes: Array<Omit<Scene, "transition">> = [];
  if (input.template === "spotlight") {
    const product = input.products[0];
    if (!product) throw new Error("REEL_NEEDS_PRODUCT");
    scenes.push({
      png: await introScene(
        "من رفوف مايثا ماركت",
        product.categoryName || "لبيتكم",
      ),
      seconds: 3,
      zoom: "none",
    });
    scenes.push({
      png: await productScene(product, input, "منتج الأسبوع"),
      seconds: 6,
      zoom: "in",
    });
    const variants = await variantsScene(product, input);
    if (variants) scenes.push({ png: variants, seconds: 4.5, zoom: "none" });
    scenes.push({
      png: await callToActionScene(input),
      seconds: 4.5,
      zoom: "out",
    });
  } else if (input.template === "collection") {
    if (input.products.length < 2) throw new Error("REEL_NEEDS_PRODUCTS");
    scenes.push({
      png: await introScene("مختارات الأسبوع", "أغراض للبيت متوفرة هلأ"),
      seconds: 3,
      zoom: "none",
    });
    for (const [index, product] of input.products.slice(0, 4).entries()) {
      scenes.push({
        png: await productScene(product, input, "مختارات الأسبوع"),
        seconds: 3.6,
        zoom: index % 2 ? "out" : "in",
      });
    }
    scenes.push({
      png: await callToActionScene(input),
      seconds: 4,
      zoom: "out",
    });
  } else {
    scenes.push({
      png: await introScene(
        `التوصيل داخل ${input.store.deliveryAreaAr}`,
        "من مايثا ماركت لباب البيت",
      ),
      seconds: 3,
      zoom: "none",
    });
    scenes.push({ png: await deliveryScene(input), seconds: 6, zoom: "in" });
    for (const [index, product] of input.products.slice(0, 3).entries()) {
      scenes.push({
        png: await productScene(product, input, "متوفر هلأ"),
        seconds: 3,
        zoom: index % 2 ? "out" : "in",
      });
    }
    scenes.push({
      png: await callToActionScene(input),
      seconds: 4,
      zoom: "out",
    });
  }
  return scenes.map((scene, index) => ({
    ...scene,
    transition: transitions[index % transitions.length]!,
  }));
}

export function reelDurationSeconds(
  scenes: readonly Pick<Scene, "seconds">[],
): number {
  const total = scenes.reduce((sum, scene) => sum + scene.seconds, 0);
  return total - TRANSITION_SECONDS * Math.max(0, scenes.length - 1);
}

function zoomExpression(zoom: Scene["zoom"], frames: number): string {
  const step = (0.07 / frames).toFixed(6);
  if (zoom === "in") return `min(1+on*${step},1.07)`;
  if (zoom === "out") return `max(1.07-on*${step},1)`;
  return "1";
}

/** The ffmpeg filter graph: each still gets a slow zoom, then neighbours cross with an xfade. */
export function ffmpegArgs(
  sceneFiles: readonly string[],
  scenes: readonly Pick<Scene, "seconds" | "zoom" | "transition">[],
  output: string,
): string[] {
  const args = ["-y", "-hide_banner", "-loglevel", "error"];
  for (const file of sceneFiles) args.push("-i", file);
  args.push(
    "-f",
    "lavfi",
    "-t",
    String(reelDurationSeconds(scenes)),
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=48000",
  );
  const filters: string[] = [];
  scenes.forEach((scene, index) => {
    const frames = Math.round(scene.seconds * FPS);
    filters.push(
      `[${index}:v]scale=${REEL_WIDTH * 2}:${REEL_HEIGHT * 2},zoompan=z='${zoomExpression(scene.zoom, frames)}':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${REEL_WIDTH}x${REEL_HEIGHT}:fps=${FPS},setsar=1,format=yuv420p[s${index}]`,
    );
  });
  let previous = "s0";
  let elapsed = scenes[0]!.seconds;
  for (let index = 1; index < scenes.length; index += 1) {
    const offset = (elapsed - TRANSITION_SECONDS).toFixed(3);
    const label = index === scenes.length - 1 ? "vout" : `x${index}`;
    filters.push(
      `[${previous}][s${index}]xfade=transition=${scenes[index]!.transition}:duration=${TRANSITION_SECONDS}:offset=${offset}[${label}]`,
    );
    previous = label;
    elapsed += scenes[index]!.seconds - TRANSITION_SECONDS;
  }
  const videoOut = scenes.length > 1 ? "vout" : "s0";
  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    `[${videoOut}]`,
    "-map",
    `${sceneFiles.length}:a`,
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-preset",
    "medium",
    "-crf",
    "20",
    // Meta's Reels spec: fixed frame rate, closed GOP of 2-5 s, AAC-LC 48 kHz at 128 kbps or more.
    "-g",
    String(FPS * 2),
    "-keyint_min",
    String(FPS * 2),
    "-sc_threshold",
    "0",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(FPS),
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ar",
    "48000",
    "-shortest",
    "-movflags",
    "+faststart",
    output,
  );
  return args;
}

export function ffmpegBinary(): string {
  return process.env.FFMPEG_PATH || "ffmpeg";
}

function run(binary: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4_000);
    });
    child.on("error", () => reject(new Error("FFMPEG_NOT_AVAILABLE")));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else
        reject(Object.assign(new Error("FFMPEG_FAILED"), { detail: stderr }));
    });
  });
}

export async function isFfmpegAvailable(): Promise<boolean> {
  try {
    await run(ffmpegBinary(), ["-version"]);
    return true;
  } catch {
    return false;
  }
}

export interface RenderedReel {
  mp4: Buffer;
  poster: Buffer;
  seconds: number;
}

export async function renderReel(
  input: ReelRenderInput,
): Promise<RenderedReel> {
  const scenes = await buildReelScenes(input);
  const workdir = await mkdtemp(path.join(tmpdir(), "maytha-reel-"));
  try {
    const files: string[] = [];
    for (const [index, scene] of scenes.entries()) {
      const file = path.join(workdir, `scene-${index}.png`);
      await writeFile(file, scene.png);
      files.push(file);
    }
    const output = path.join(workdir, "reel.mp4");
    await run(ffmpegBinary(), ffmpegArgs(files, scenes, output));
    const poster = await sharp(scenes[1]?.png ?? scenes[0]!.png)
      .jpeg({ quality: 85 })
      .toBuffer();
    return {
      mp4: await readFile(output),
      poster,
      seconds: reelDurationSeconds(scenes),
    };
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}
