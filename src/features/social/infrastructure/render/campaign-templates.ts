import sharp, { type OverlayOptions } from "sharp";

import type { Bundle } from "@/features/social/domain/bundles";
import {
  campaignTypeLabels,
  type CampaignCopy,
  type CampaignLayout,
  type CampaignType,
  type MascotPose,
} from "@/features/social/domain/campaigns";
import {
  shoppingTips,
  type ShoppingTipId,
} from "@/features/social/domain/captions";
import type { StoreFacts } from "@/features/social/domain/social-catalog";
import { formatIls } from "@/shared/lib/format-currency";

import {
  assetPath,
  brand,
  leafDecoration,
  pill,
  placeText,
  renderText,
  roundedRect,
  type TextOptions,
} from "./brand";
import { iconBadge, type IconName } from "./icons";
import { FEED_HEIGHT, FEED_WIDTH, footer, header } from "./image-templates";

type Layer = OverlayOptions;

export const mascotFile = (pose: MascotPose) =>
  assetPath("src", "features", "social", "assets", "mascot", `${pose}.png`);

/** Poses that exist only as small art; they are shown small so they stay sharp. */
const smallPoses: ReadonlySet<MascotPose> = new Set([
  "wave",
  "wink",
  "delivery",
  "tip",
  "shopping",
  "love",
]);
/** Largest height a small pose is drawn at (about 1.6× its source). */
export const SMALL_POSE_MAX_HEIGHT = 270;

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Arabic text. Pango swaps left and right alignment for right-to-left paragraphs, so a block that
 * should hug the right edge is laid out with «left»; placement still uses the visual side.
 */
function arabic(text: string, options: TextOptions) {
  const align = options.align ?? "right";
  return renderText(text, {
    ...options,
    align: align === "right" ? "left" : align === "left" ? "right" : align,
  });
}

/** The core of a product name for a small card: the part before its size or variant details. */
export function shortName(name: string): string {
  const core = name.split(/\s[–—-]\s|\s\(|\s\|/u)[0]!.trim();
  return core.length > 28 ? `${core.slice(0, 27).trim()}…` : core;
}

/** Where the footer band starts; nothing but the footer is drawn below it. */
const FOOTER_TOP = FEED_HEIGHT - 170;

export interface CampaignRenderInput {
  type: CampaignType;
  layout: CampaignLayout;
  pose: MascotPose | null;
  copy: CampaignCopy;
  bundle: Bundle | null;
  tipId: ShoppingTipId | null;
  /** Product photos by product id. */
  photos: ReadonlyMap<string, Buffer>;
  store: StoreFacts;
  siteLabel: string;
}

export interface CampaignRender {
  image: Buffer;
  /** The area the mascot was drawn in, and the areas that carry products, prices and text. */
  mascotBox: Box | null;
  protectedBoxes: Box[];
}

/** What a layout draws between the header and the footer. */
interface LayoutResult {
  layers: Layer[];
  mascotBox: Box | null;
  protectedBoxes: Box[];
}

export async function mascot(
  pose: MascotPose,
  maxHeight: number,
  maxWidth = 1080,
): Promise<{ input: Buffer; width: number; height: number }> {
  const height = smallPoses.has(pose)
    ? Math.min(maxHeight, SMALL_POSE_MAX_HEIGHT)
    : maxHeight;
  const { data, info } = await sharp(mascotFile(pose))
    .resize({ height, width: maxWidth, fit: "inside" })
    .png()
    .toBuffer({ resolveWithObject: true });
  return { input: data, width: info.width, height: info.height };
}

async function ctaPill(text: string, center: number, top: number) {
  const label = await arabic(text, {
    size: 36,
    weight: "bold",
    color: brand.surface,
    width: 800,
  });
  const width = label.width + 96;
  const height = 84;
  const left = Math.round(center - width / 2);
  return {
    box: { left, top, width, height },
    layers: [
      { input: pill(width, height, brand.amber), left, top },
      {
        input: label.input,
        left: left + 48,
        top: top + Math.round((height - label.height) / 2),
      },
    ] as Layer[],
  };
}

async function headlineBlock(
  copy: CampaignCopy,
  box: { left: number; top: number; width: number },
  align: "right" | "center" = "center",
  size = 76,
) {
  const headline = await arabic(copy.headline, {
    size,
    weight: "heavy",
    color: brand.green,
    width: box.width,
    align,
    maxHeight: Math.round(size * 2.6),
  });
  const subline = await arabic(copy.subline, {
    size: 36,
    weight: "semibold",
    color: brand.muted,
    width: box.width,
    align,
    maxHeight: 120,
  });
  const subTop = box.top + headline.height + 14;
  return {
    bottom: subTop + subline.height,
    layers: [
      placeText(headline, box, align),
      placeText(subline, { ...box, top: subTop }, align),
    ] as Layer[],
  };
}

async function photoTile(photo: Buffer, size: number): Promise<Buffer> {
  const inner = Math.round(size * 0.82);
  const image = await sharp(photo)
    .resize(inner, inner, { fit: "contain", background: brand.surface })
    .flatten({ background: brand.surface })
    .png()
    .toBuffer();
  return sharp(roundedRect(size, size, 28, brand.surface, brand.sand))
    .composite([
      {
        input: image,
        left: Math.round((size - inner) / 2),
        top: Math.round((size - inner) / 2),
      },
    ])
    .png()
    .toBuffer();
}

/** A product card: photo, name (two lines at most) and its real price. */
async function productTile(
  item: Bundle["items"][number],
  photo: Buffer,
  width: number,
): Promise<{ input: Buffer; height: number }> {
  const tile = await photoTile(photo, width);
  const name = await arabic(shortName(item.name), {
    size: 24,
    weight: "semibold",
    color: brand.text,
    width,
    align: "center",
    maxHeight: 70,
  });
  const price = await arabic(formatIls(item.priceAgorot), {
    size: 30,
    weight: "heavy",
    color: brand.green,
    width,
    align: "center",
  });
  const height = width + 10 + name.height + 6 + price.height;
  const input = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: tile, left: 0, top: 0 },
      {
        input: name.input,
        left: Math.max(0, Math.round((width - name.width) / 2)),
        top: width + 10,
      },
      {
        input: price.input,
        left: Math.max(0, Math.round((width - price.width) / 2)),
        top: width + 16 + name.height,
      },
    ])
    .png()
    .toBuffer();
  return { input, height };
}

function photoOf(input: CampaignRenderInput, productId: string): Buffer {
  const photo = input.photos.get(productId);
  if (!photo) throw new Error("PRODUCT_PHOTO_MISSING");
  return photo;
}

async function bundleBoard(input: CampaignRenderInput): Promise<LayoutResult> {
  const bundle = input.bundle!;
  const layers: Layer[] = [];
  const protectedBoxes: Box[] = [];
  const head = await headlineBlock(input.copy, {
    left: 70,
    top: 200,
    width: 940,
  });
  layers.push(...head.layers);
  // One row for up to four products; five go as three over two.
  const items = bundle.items.slice(0, 5);
  const rows =
    items.length === 5 ? [items.slice(0, 3), items.slice(3)] : [items];
  const tileWidth =
    items.length <= 2
      ? 330
      : items.length === 3
        ? 290
        : items.length === 4
          ? 215
          : 240;
  const gap = items.length === 4 ? 26 : 36;
  let top = head.bottom + 40;
  for (const row of rows) {
    const rowWidth = row.length * tileWidth + (row.length - 1) * gap;
    const rowLeft = Math.round((FEED_WIDTH - rowWidth) / 2);
    let rowHeight = 0;
    for (const [column, item] of row.entries()) {
      const tile = await productTile(
        item,
        photoOf(input, item.productId),
        tileWidth,
      );
      // Right-to-left: the first product sits on the right.
      const left = rowLeft + (row.length - 1 - column) * (tileWidth + gap);
      layers.push({ input: tile.input, left, top });
      protectedBoxes.push({ left, top, width: tileWidth, height: tile.height });
      rowHeight = Math.max(rowHeight, tile.height);
    }
    top += rowHeight + 24;
  }
  const total = await totalBand(bundle, input, top + 10);
  layers.push(...total.layers);
  protectedBoxes.push(total.box);
  // The call to action moves right when the mascot takes the bottom-left corner.
  const cta = await ctaPill(
    input.copy.cta,
    input.pose ? FEED_WIDTH - 70 - 260 : FEED_WIDTH / 2,
    total.box.top + total.box.height + 36,
  );
  layers.push(...cta.layers);
  protectedBoxes.push(cta.box);
  settle(layers, protectedBoxes, cta.box.top + cta.box.height);
  return {
    mascotBox: await cornerMascot(input.pose, layers, protectedBoxes),
    protectedBoxes,
    layers,
  };
}

/**
 * Moves a layout down into the free space above the footer, so short content does not leave an
 * empty band at the bottom. Called before the mascot is placed; he stays anchored to the footer.
 */
function settle(layers: Layer[], boxes: Box[], bottom: number) {
  const shift = Math.max(
    0,
    Math.min(110, Math.floor((FOOTER_TOP - 40 - bottom) / 2)),
  );
  for (const layer of layers) layer.top = (layer.top ?? 0) + shift;
  for (const box of boxes) box.top += shift;
}

/** The mascot in the bottom-left corner, only as large as the free space there allows. */
async function cornerMascot(
  pose: MascotPose | null,
  layers: Layer[],
  protectedBoxes: Box[],
): Promise<Box | null> {
  if (!pose) return null;
  const width = 300;
  // The lowest content edge over the corner columns decides how tall he can be.
  const floor = protectedBoxes
    .filter((box) => box.left < 40 + width && box.top < FOOTER_TOP)
    .reduce((lowest, box) => Math.max(lowest, box.top + box.height), 0);
  const room = FOOTER_TOP - floor - 16;
  if (room < 150) return null;
  const art = await mascot(pose, Math.min(room, SMALL_POSE_MAX_HEIGHT), width);
  const box = {
    left: 40,
    top: FOOTER_TOP - art.height,
    width: art.width,
    height: art.height,
  };
  layers.push({ input: art.input, left: box.left, top: box.top });
  return box;
}

async function totalBand(
  bundle: Bundle,
  input: CampaignRenderInput,
  top: number,
) {
  const left = 70;
  const width = FEED_WIDTH - 70 - left;
  const height = 140;
  const total = await arabic(`المجموع ${formatIls(bundle.totalAgorot)}`, {
    size: 48,
    weight: "heavy",
    color: brand.green,
    width: width - 60,
    align: "right",
  });
  const note = await arabic(
    bundle.freeDelivery
      ? `التوصيل مجاني لأنه فوق ${formatIls(input.store.freeDeliveryFromAgorot)}`
      : `ضيفوا ${formatIls(bundle.missingAgorot)} والتوصيل مجاني`,
    {
      size: 28,
      weight: "semibold",
      color: brand.text,
      width: width - 60,
      align: "right",
    },
  );
  const box = { left, top, width, height };
  return {
    box,
    layers: [
      { input: roundedRect(width, height, 32, brand.greenTint), left, top },
      placeText(total, { left: left + 30, top: top + 18, width: width - 60 }),
      placeText(note, { left: left + 30, top: top + 84, width: width - 60 }),
    ] as Layer[],
  };
}

async function freeDeliveryMeter(
  input: CampaignRenderInput,
): Promise<LayoutResult> {
  const bundle = input.bundle!;
  const store = input.store;
  const layers: Layer[] = [];
  const protectedBoxes: Box[] = [];
  const head = await headlineBlock(
    input.copy,
    { left: 70, top: 200, width: 940 },
    "center",
    84,
  );
  layers.push(...head.layers);

  // The basket: small photo tiles with each real price.
  const items = bundle.items.slice(0, 5);
  const size = items.length > 4 ? 160 : 190;
  const gap = 22;
  const rowWidth = items.length * size + (items.length - 1) * gap;
  const rowLeft = Math.round((FEED_WIDTH - rowWidth) / 2);
  const rowTop = head.bottom + 50;
  let rowBottom = rowTop;
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]!;
    const left = rowLeft + (items.length - 1 - i) * (size + gap);
    layers.push({
      input: await photoTile(photoOf(input, item.productId), size),
      left,
      top: rowTop,
    });
    const price = await arabic(formatIls(item.priceAgorot), {
      size: 28,
      weight: "heavy",
      color: brand.green,
      width: size,
      align: "center",
    });
    layers.push(
      placeText(price, { left, top: rowTop + size + 8, width: size }, "center"),
    );
    protectedBoxes.push({
      left,
      top: rowTop,
      width: size,
      height: size + 8 + price.height,
    });
    rowBottom = Math.max(rowBottom, rowTop + size + 8 + price.height);
  }

  // The meter: the basket's real total against the threshold, filled from the right (RTL).
  const meterTop = rowBottom + 60;
  const meterLeft = 110;
  const meterWidth = FEED_WIDTH - 2 * meterLeft;
  const scale = Math.max(bundle.totalAgorot, store.freeDeliveryFromAgorot);
  const fill = Math.round((meterWidth * bundle.totalAgorot) / scale);
  const mark = Math.round((meterWidth * store.freeDeliveryFromAgorot) / scale);
  const barHeight = 44;
  layers.push({
    input: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${meterWidth}" height="${barHeight + 40}">
        <rect x="0" y="20" width="${meterWidth}" height="${barHeight}" rx="${barHeight / 2}" fill="${brand.sand}"/>
        <rect x="${meterWidth - fill}" y="20" width="${fill}" height="${barHeight}" rx="${barHeight / 2}" fill="${brand.green}"/>
        <rect x="${meterWidth - mark - 3}" y="0" width="6" height="${barHeight + 40}" rx="3" fill="${brand.amber}"/>
      </svg>`,
    ),
    left: meterLeft,
    top: meterTop,
  });
  const markLabel = await arabic(
    `${formatIls(store.freeDeliveryFromAgorot)} توصيل مجاني`,
    {
      size: 28,
      weight: "bold",
      color: brand.amber,
      width: 400,
      align: "center",
    },
  );
  const markCenter = meterLeft + meterWidth - mark;
  layers.push({
    input: markLabel.input,
    left: Math.min(
      FEED_WIDTH - 40 - markLabel.width,
      Math.max(40, Math.round(markCenter - markLabel.width / 2)),
    ),
    top: meterTop + barHeight + 52,
  });
  const totalLine = await arabic(
    bundle.freeDelivery
      ? `سلتكم ${formatIls(bundle.totalAgorot)}، والتوصيل علينا`
      : `سلتكم ${formatIls(bundle.totalAgorot)}، ناقصها ${formatIls(bundle.missingAgorot)}`,
    {
      size: 40,
      weight: "heavy",
      color: brand.text,
      width: 900,
      align: "center",
    },
  );
  const totalTop = meterTop + barHeight + 110;
  layers.push(
    placeText(totalLine, { left: 90, top: totalTop, width: 900 }, "center"),
  );
  protectedBoxes.push({
    left: meterLeft,
    top: meterTop,
    width: meterWidth,
    height: totalTop + totalLine.height - meterTop,
  });

  const cta = await ctaPill(
    input.copy.cta,
    FEED_WIDTH / 2,
    totalTop + totalLine.height + 40,
  );
  layers.push(...cta.layers);
  protectedBoxes.push(cta.box);
  settle(layers, protectedBoxes, cta.box.top + cta.box.height);
  return {
    mascotBox: await cornerMascot(input.pose, layers, protectedBoxes),
    protectedBoxes,
    layers,
  };
}

const benefitIcons: IconName[] = ["mapPin", "banknote", "cart"];

async function mascotHero(input: CampaignRenderInput): Promise<LayoutResult> {
  const store = input.store;
  const layers: Layer[] = [];
  const protectedBoxes: Box[] = [];
  // The large art is the presenting pose; smaller poses join as a badge so they stay sharp.
  const art = await mascot("presenting", 720, 520);
  const mascotBox: Box = {
    left: 20,
    top: FOOTER_TOP - art.height + 10,
    width: art.width,
    height: art.height - 10,
  };
  layers.push({
    input: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="560"><circle cx="280" cy="280" r="280" fill="${brand.greenTint}"/></svg>`,
    ),
    left: 0,
    top: FOOTER_TOP - 560,
  });
  layers.push({
    input: art.input,
    left: mascotBox.left,
    top: FOOTER_TOP - art.height,
  });

  const textLeft = 520;
  const textWidth = FEED_WIDTH - textLeft - 60;
  const head = await headlineBlock(
    input.copy,
    { left: textLeft, top: 230, width: textWidth },
    "right",
    72,
  );
  layers.push(...head.layers);
  protectedBoxes.push({
    left: textLeft,
    top: 230,
    width: textWidth,
    height: head.bottom - 230,
  });

  const benefits = [
    `توصيل داخل ${store.deliveryAreaAr}`,
    store.cashOnDelivery ? "الدفع عند الاستلام" : "دفع سهل",
    `مجاني من ${formatIls(store.freeDeliveryFromAgorot)}`,
  ];
  let top = head.bottom + 50;
  for (let i = 0; i < benefits.length; i += 1) {
    const badge = 72;
    const label = await arabic(benefits[i]!, {
      size: 32,
      weight: "bold",
      color: brand.text,
      width: textWidth - badge - 20,
      align: "right",
    });
    layers.push({
      input: iconBadge(benefitIcons[i]!, badge, brand.greenTint, brand.green),
      left: FEED_WIDTH - 60 - badge,
      top,
    });
    layers.push(
      placeText(label, {
        left: textLeft,
        top: top + Math.round((badge - label.height) / 2),
        width: textWidth - badge - 20,
      }),
    );
    protectedBoxes.push({
      left: textLeft,
      top,
      width: textWidth,
      height: badge,
    });
    top += badge + 26;
  }
  const cta = await ctaPill(input.copy.cta, textLeft + textWidth / 2, top + 30);
  layers.push(...cta.layers);
  protectedBoxes.push(cta.box);

  if (input.pose && input.pose !== "presenting") {
    const badge = await mascot(input.pose, 230);
    const badgeLeft = textLeft + Math.round((textWidth - badge.width) / 2);
    const badgeTop = Math.min(
      FOOTER_TOP - badge.height,
      cta.box.top + cta.box.height + 30,
    );
    if (
      badgeTop + badge.height <= FOOTER_TOP &&
      badgeTop > cta.box.top + cta.box.height
    ) {
      layers.push({ input: badge.input, left: badgeLeft, top: badgeTop });
    }
  }
  return { mascotBox, protectedBoxes, layers };
}

async function mascotTip(input: CampaignRenderInput): Promise<LayoutResult> {
  const layers: Layer[] = [];
  const protectedBoxes: Box[] = [];
  const head = await headlineBlock(
    input.copy,
    { left: 70, top: 210, width: 940 },
    "center",
    80,
  );
  layers.push(...head.layers);
  const cardTop = head.bottom + 40;
  const cardWidth = 940;
  const steps =
    input.type === "shopping_tutorial"
      ? [
          "اختاروا اللي بدكم إياه من الموقع",
          "ضيفوه للسلة",
          "أكّدوا الطلب بعنوانكم",
        ]
      : [
          (
            shoppingTips.find((tip) => tip.id === input.tipId) ??
            shoppingTips[0]
          ).body(input.store),
        ];
  let top = cardTop + 40;
  const bodyLayers: Layer[] = [];
  for (let i = 0; i < steps.length; i += 1) {
    const numbered = steps.length > 1;
    const text = await arabic(steps[i]!, {
      size: numbered ? 38 : 40,
      weight: numbered ? "bold" : "semibold",
      color: brand.text,
      width: cardWidth - (numbered ? 200 : 100),
      align: "right",
      lineSpacing: 0.25,
    });
    if (numbered) {
      const number = await arabic(String(i + 1), {
        size: 40,
        weight: "heavy",
        color: brand.surface,
        width: 80,
        align: "center",
      });
      bodyLayers.push({
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="76" height="76"><circle cx="38" cy="38" r="38" fill="${brand.green}"/></svg>`,
        ),
        left: 70 + cardWidth - 50 - 76,
        top: top + Math.round((text.height - 76) / 2),
      });
      bodyLayers.push({
        input: number.input,
        left: 70 + cardWidth - 50 - 38 - Math.round(number.width / 2),
        top: top + Math.round((text.height - number.height) / 2),
      });
    }
    bodyLayers.push(
      placeText(text, {
        left: 70 + 50,
        top,
        width: cardWidth - (numbered ? 200 : 100),
      }),
    );
    top += text.height + 46;
  }
  const cardHeight = top - cardTop;
  layers.push({
    input: roundedRect(cardWidth, cardHeight, 40, brand.surface, brand.sand),
    left: 70,
    top: cardTop,
  });
  layers.push(...bodyLayers);
  protectedBoxes.push({
    left: 70,
    top: cardTop,
    width: cardWidth,
    height: cardHeight,
  });

  const cta = await ctaPill(
    input.copy.cta,
    FEED_WIDTH - 70 - 260,
    cardTop + cardHeight + 50,
  );
  layers.push(...cta.layers);
  protectedBoxes.push(cta.box);
  settle(layers, protectedBoxes, cta.box.top + cta.box.height);
  return {
    mascotBox: await cornerMascot(input.pose, layers, protectedBoxes),
    protectedBoxes,
    layers,
  };
}

const layouts: Record<
  CampaignLayout,
  (input: CampaignRenderInput) => Promise<LayoutResult>
> = {
  bundle_board: bundleBoard,
  free_delivery_meter: freeDeliveryMeter,
  mascot_hero: mascotHero,
  mascot_tip: mascotTip,
};

/** One campaign image, 1080×1350, with the store header and footer around the layout. */
export async function renderCampaignImage(
  input: CampaignRenderInput,
): Promise<CampaignRender> {
  if (
    (input.layout === "bundle_board" ||
      input.layout === "free_delivery_meter") &&
    !input.bundle
  ) {
    throw new Error("BUNDLE_MISSING");
  }
  const body = await layouts[input.layout](input);
  const layers: Layer[] = [
    { input: leafDecoration(FEED_WIDTH, FEED_HEIGHT), left: 0, top: 0 },
    ...(await header(FEED_WIDTH, 40, campaignTypeLabels[input.type])),
    ...body.layers,
    ...(await footer(FEED_WIDTH, FEED_HEIGHT, input.store, input.siteLabel)),
  ];
  const image = await sharp({
    create: {
      width: FEED_WIDTH,
      height: FEED_HEIGHT,
      channels: 4,
      background: brand.canvas,
    },
  })
    .composite(layers)
    .flatten({ background: brand.canvas })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
  return {
    image,
    mascotBox: body.mascotBox,
    protectedBoxes: [
      ...body.protectedBoxes,
      {
        left: 0,
        top: FOOTER_TOP,
        width: FEED_WIDTH,
        height: FEED_HEIGHT - FOOTER_TOP,
      },
      { left: FEED_WIDTH - 48 - 120, top: 40, width: 120, height: 120 },
    ],
  };
}

/** True when two boxes share any area. */
export function overlaps(a: Box, b: Box): boolean {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  );
}
