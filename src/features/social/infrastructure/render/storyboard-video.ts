import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";

import { poseIsUsable } from "@/features/social/domain/mascot";
import type {
  LayerMotion,
  StoryLayer,
  StoryScene,
  Storyboard,
} from "@/features/social/domain/reels";
import type { StoreFacts } from "@/features/social/domain/social-catalog";

import {
  brand,
  leafDecoration,
  logo,
  pill,
  renderText,
  roundedRect,
  type TextOptions,
} from "./brand";
import { mascot } from "./campaign-templates";
import { ffmpegBinary } from "./reel-templates";

export const STORY_WIDTH = 1080;
export const STORY_HEIGHT = 1920;
const FPS = 30;
const TRANSITION = 0.5;
/** Reels' own buttons and captions cover the top and bottom; nothing important goes there. */
export const SAFE_TOP = 260;
export const SAFE_BOTTOM = STORY_HEIGHT - 420;
const ENTER_SECONDS = 0.55;

interface PlacedLayer {
  png: Buffer;
  left: number;
  top: number;
  width: number;
  height: number;
  enter: LayerMotion;
  at: number;
}

export interface StoryRenderInput {
  board: Storyboard;
  photos: ReadonlyMap<string, Buffer>;
  store: StoreFacts;
  siteLabel: string;
}

/** Pango mirrors left and right for Arabic paragraphs, so a right-hugging block asks for «left». */
function arabic(text: string, options: TextOptions) {
  const align = options.align ?? "center";
  return renderText(text, {
    ...options,
    align: align === "right" ? "left" : align === "left" ? "right" : align,
  });
}

async function background(scene: StoryScene): Promise<Buffer> {
  const fill = scene.background === "green" ? brand.green : brand.canvas;
  return sharp({
    create: {
      width: STORY_WIDTH,
      height: STORY_HEIGHT,
      channels: 4,
      background: fill,
    },
  })
    .composite(
      scene.background === "green"
        ? []
        : [
            {
              input: leafDecoration(STORY_WIDTH, STORY_HEIGHT, 0.25),
              left: 0,
              top: 0,
            },
          ],
    )
    .png()
    .toBuffer();
}

/** Lays a scene's layers out top to bottom inside the safe area, centred. */
async function placeLayers(
  scene: StoryScene,
  input: StoryRenderInput,
): Promise<PlacedLayer[]> {
  const onGreen = scene.background === "green";
  const textColor = onGreen ? brand.surface : brand.text;
  const blocks: Array<Omit<PlacedLayer, "left" | "top">> = [];
  for (const layer of scene.layers) {
    const block = await renderLayer(layer, input, textColor, onGreen);
    if (block) blocks.push(block);
  }
  const gap = 48;
  const total =
    blocks.reduce((sum, block) => sum + block.height, 0) +
    gap * (blocks.length - 1);
  let top = Math.max(
    SAFE_TOP,
    Math.round((SAFE_TOP + SAFE_BOTTOM - total) / 2),
  );
  return blocks.map((block) => {
    const placed = {
      ...block,
      left: Math.round((STORY_WIDTH - block.width) / 2),
      top,
    };
    top += block.height + gap;
    return placed;
  });
}

async function renderLayer(
  layer: StoryLayer,
  input: StoryRenderInput,
  textColor: string,
  onGreen: boolean,
): Promise<Omit<PlacedLayer, "left" | "top"> | null> {
  const base = { enter: layer.enter, at: layer.at };
  switch (layer.kind) {
    case "mascot": {
      // Only approved artwork; small crops stay small. Without artwork the scene goes on without him.
      if (!poseIsUsable(layer.pose)) return null;
      const art = await mascot(layer.pose, 760, 820);
      return { ...base, png: art.input, width: art.width, height: art.height };
    }
    case "product": {
      const photo = input.photos.get(layer.productId);
      if (!photo) throw new Error("PRODUCT_PHOTO_MISSING");
      const size = 640;
      const inner = await sharp(photo)
        .resize(size - 80, size - 80, {
          fit: "contain",
          background: brand.surface,
        })
        .flatten({ background: brand.surface })
        .png()
        .toBuffer();
      const png = await sharp(
        roundedRect(size, size, 48, brand.surface, brand.sand),
      )
        .composite([{ input: inner, left: 40, top: 40 }])
        .png()
        .toBuffer();
      return { ...base, png, width: size, height: size };
    }
    case "text": {
      const size =
        layer.size === "hook" ? 92 : layer.size === "title" ? 68 : 54;
      const block = await arabic(layer.text, {
        size,
        weight: layer.size === "body" ? "bold" : "heavy",
        color: layer.size === "hook" && !onGreen ? brand.green : textColor,
        width: 940,
        align: "center",
        maxHeight: size * 3,
      });
      return {
        ...base,
        png: block.input,
        width: block.width,
        height: block.height,
      };
    }
    case "price":
    case "cta": {
      const label = await arabic(layer.text, {
        size: layer.kind === "price" ? 64 : 56,
        weight: "heavy",
        color: layer.kind === "cta" && onGreen ? brand.green : brand.surface,
        width: 900,
      });
      const width = label.width + 120;
      const height = label.height + 60;
      const fill =
        layer.kind === "cta"
          ? onGreen
            ? brand.surface
            : brand.amber
          : brand.green;
      const png = await sharp(pill(width, height, fill))
        .composite([{ input: label.input, left: 60, top: 30 }])
        .png()
        .toBuffer();
      return { ...base, png, width, height };
    }
    case "logo": {
      const png = await logo(300);
      return { ...base, png, width: 300, height: 300 };
    }
  }
}

/** The x/y expression for a layer: it eases from off its mark into place, starting at `at`. */
function motionExpressions(layer: PlacedLayer): { x: string; y: string } {
  const progress = `clip((t-${layer.at.toFixed(2)})/${ENTER_SECONDS},0,1)`;
  const ease = `pow(1-${progress},3)`;
  const x =
    layer.enter === "slide-left"
      ? `${layer.left}-${STORY_WIDTH * 0.6}*${ease}`
      : layer.enter === "slide-right"
        ? `${layer.left}+${STORY_WIDTH * 0.6}*${ease}`
        : String(layer.left);
  const y =
    layer.enter === "rise" ? `${layer.top}+180*${ease}` : String(layer.top);
  return { x, y };
}

/** ffmpeg arguments for one scene: the background with a slow zoom, layers entering on cue. */
export function sceneArgs(
  backgroundFile: string,
  layerFiles: readonly string[],
  layers: readonly PlacedLayer[],
  seconds: number,
  output: string,
): string[] {
  const frames = Math.round(seconds * FPS);
  const args = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-loop",
    "1",
    "-t",
    seconds.toFixed(2),
    "-i",
    backgroundFile,
  ];
  for (const file of layerFiles)
    args.push("-loop", "1", "-t", seconds.toFixed(2), "-i", file);
  const filters = [
    `[0:v]scale=${STORY_WIDTH * 2}:${STORY_HEIGHT * 2},zoompan=z='min(1+on*${(0.05 / frames).toFixed(6)},1.05)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${STORY_WIDTH}x${STORY_HEIGHT}:fps=${FPS},setsar=1[b0]`,
  ];
  layers.forEach((layer, index) => {
    const { x, y } = motionExpressions(layer);
    filters.push(
      `[${index + 1}:v]format=rgba,fade=t=in:st=${layer.at.toFixed(2)}:d=${ENTER_SECONDS}:alpha=1[l${index}]`,
      `[b${index}][l${index}]overlay=x='${x}':y='${y}':eval=frame[b${index + 1}]`,
    );
  });
  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    `[b${layers.length}]`,
    "-r",
    String(FPS),
    "-frames:v",
    String(frames),
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    output,
  );
  return args;
}

/** Joins the scenes with crossfades and adds the silent stereo track Meta expects. */
export function joinArgs(
  sceneFiles: readonly string[],
  seconds: readonly number[],
  output: string,
): string[] {
  const args = ["-y", "-hide_banner", "-loglevel", "error"];
  for (const file of sceneFiles) args.push("-i", file);
  const total =
    seconds.reduce((sum, value) => sum + value, 0) -
    TRANSITION * (seconds.length - 1);
  args.push(
    "-f",
    "lavfi",
    "-t",
    total.toFixed(2),
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=48000",
  );
  const filters: string[] = [];
  let previous = "0:v";
  let elapsed = seconds[0]!;
  for (let index = 1; index < sceneFiles.length; index += 1) {
    const label = `x${index}`;
    filters.push(
      `[${previous}][${index}:v]xfade=transition=fade:duration=${TRANSITION}:offset=${(elapsed - TRANSITION).toFixed(2)}[${label}]`,
    );
    previous = label;
    elapsed += seconds[index]! - TRANSITION;
  }
  if (filters.length)
    args.push("-filter_complex", filters.join(";"), "-map", `[${previous}]`);
  else args.push("-map", "0:v");
  args.push(
    "-map",
    `${sceneFiles.length}:a`,
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-crf",
    "20",
    "-g",
    String(FPS * 2),
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

function run(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBinary(), args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4_000);
    });
    child.on("error", () => reject(new Error("FFMPEG_NOT_AVAILABLE")));
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(Object.assign(new Error("FFMPEG_FAILED"), { detail: stderr })),
    );
  });
}

/** A scene after its layers have entered. */
async function still(
  back: Buffer,
  layers: Awaited<ReturnType<typeof placeLayers>>,
  width = STORY_WIDTH,
): Promise<Buffer> {
  const image = sharp(back).composite(
    layers.map((layer) => ({
      input: layer.png,
      left: layer.left,
      top: layer.top,
    })),
  );
  if (width === STORY_WIDTH) return image.jpeg({ quality: 82 }).toBuffer();
  // Composite first, then scale: sharp resizes before compositing otherwise.
  return sharp(await image.png().toBuffer())
    .resize(width)
    .jpeg({ quality: 78 })
    .toBuffer();
}

/**
 * The storyboard as stills, one per scene, without FFmpeg: what the owner checks before asking
 * for a render. Runs wherever campaign images do.
 */
export async function renderStoryboardFrames(
  input: StoryRenderInput,
  width = STORY_WIDTH,
): Promise<Buffer[]> {
  const frames: Buffer[] = [];
  for (const scene of input.board.scenes) {
    frames.push(
      await still(
        await background(scene),
        await placeLayers(scene, input),
        width,
      ),
    );
  }
  return frames;
}

export interface RenderedStory {
  mp4: Buffer;
  /** One still per scene, after its layers have entered: the storyboard as pictures. */
  frames: Buffer[];
  seconds: number;
}

/** A storyboard as a vertical MP4. Needs FFmpeg, which the worker has and Vercel does not. */
export async function renderStoryboard(
  input: StoryRenderInput,
): Promise<RenderedStory> {
  const workdir = await mkdtemp(path.join(tmpdir(), "maytha-story-"));
  try {
    const sceneFiles: string[] = [];
    const sceneSeconds: number[] = [];
    const frames: Buffer[] = [];
    for (const [index, scene] of input.board.scenes.entries()) {
      // Every scene but the last is lengthened by the crossfade, so the Reel keeps its length.
      const seconds =
        scene.seconds +
        (index < input.board.scenes.length - 1 ? TRANSITION : 0);
      const back = await background(scene);
      const layers = await placeLayers(scene, input);
      const backFile = path.join(workdir, `s${index}-bg.png`);
      await writeFile(backFile, back);
      const layerFiles: string[] = [];
      for (const [layerIndex, layer] of layers.entries()) {
        const file = path.join(workdir, `s${index}-l${layerIndex}.png`);
        await writeFile(file, layer.png);
        layerFiles.push(file);
      }
      const output = path.join(workdir, `s${index}.mp4`);
      await run(sceneArgs(backFile, layerFiles, layers, seconds, output));
      sceneFiles.push(output);
      sceneSeconds.push(seconds);
      frames.push(await still(back, layers));
    }
    const output = path.join(workdir, "story.mp4");
    await run(joinArgs(sceneFiles, sceneSeconds, output));
    return {
      mp4: await readFile(output),
      frames,
      seconds:
        sceneSeconds.reduce((sum, value) => sum + value, 0) -
        TRANSITION * (sceneSeconds.length - 1),
    };
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}
