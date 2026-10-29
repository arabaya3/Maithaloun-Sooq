import sharp, { type OverlayOptions } from "sharp";

import {
  shortProductName,
  type Bundle,
} from "@/features/social/domain/bundles";
import {
  campaignTypeLabels,
  itemCount,
  type CampaignCopy,
  type CampaignLayout,
  type CampaignType,
  type MascotPose,
} from "@/features/social/domain/campaigns";
import { maxPoseHeight, poseIsUsable } from "@/features/social/domain/mascot";
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

/** Largest height the corner mascot takes; small artwork is held lower by its own limit. */
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
  /** The one product a product-discovery campaign shows, with its price as the store states it. */
  product?: {
    id: string;
    name: string;
    priceLabel: string;
    categoryName: string | null;
  } | null;
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
  // Only approved artwork is drawn, and small crops are never enlarged past what they carry.
  if (!poseIsUsable(pose)) throw new Error("MASCOT_POSE_UNAVAILABLE");
  const height = maxPoseHeight(pose, maxHeight);
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
  const name = await arabic(shortProductName(item.name), {
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
  const gridWidth = rows[0]!.length * tileWidth + (rows[0]!.length - 1) * gap;
  const gridLeft = Math.round((FEED_WIDTH - gridWidth) / 2);
  // Five products leave the last row's left slot free: Meetho stands there.
  let slot: Box | null = null;
  for (const row of rows) {
    const rowWidth = row.length * tileWidth + (row.length - 1) * gap;
    const rowLeft =
      items.length === 5
        ? gridLeft + gridWidth - rowWidth
        : Math.round((FEED_WIDTH - rowWidth) / 2);
    if (items.length === 5 && row !== rows[0]) {
      slot = { left: gridLeft, top, width: tileWidth, height: 0 };
    }
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
    if (slot && slot.top === top) slot.height = rowHeight;
    top += rowHeight + 24;
  }
  let slotMascot: Box | null = null;
  if (slot && input.pose) {
    const art = await mascot(
      input.pose,
      Math.min(slot.height, SMALL_POSE_MAX_HEIGHT),
      slot.width,
    );
    slotMascot = {
      left: slot.left + Math.round((slot.width - art.width) / 2),
      top: slot.top + slot.height - art.height,
      width: art.width,
      height: art.height,
    };
    layers.push({
      input: art.input,
      left: slotMascot.left,
      top: slotMascot.top,
    });
  }
  const total = await totalBand(bundle, input, top + 10);
  layers.push(...total.layers);
  protectedBoxes.push(total.box);
  // The call to action moves right when the mascot takes the bottom-left corner.
  const cta = await ctaPill(
    input.copy.cta,
    input.pose && !slotMascot ? FEED_WIDTH - 70 - 260 : FEED_WIDTH / 2,
    total.box.top + total.box.height + 36,
  );
  layers.push(...cta.layers);
  protectedBoxes.push(cta.box);
  settle(
    layers,
    slotMascot ? [...protectedBoxes, slotMascot] : protectedBoxes,
    cta.box.top + cta.box.height,
  );
  return {
    mascotBox:
      slotMascot ?? (await cornerMascot(input.pose, layers, protectedBoxes)),
    protectedBoxes,
    layers,
  };
}

/**
 * Moves a layout down into the free space above the footer, so short content does not leave an
 * empty band at the bottom. Called before the mascot is placed; he stays anchored to the footer.
 */
function settleShift(_boxes: Box[], bottom: number): number {
  return Math.max(0, Math.min(110, Math.floor((FOOTER_TOP - 40 - bottom) / 2)));
}

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

/** One product, large: a tinted photo stage, its category, its name and its real price. */
async function productSpotlight(
  input: CampaignRenderInput,
): Promise<LayoutResult> {
  const product = input.product;
  if (!product) throw new Error("PRODUCT_MISSING");
  const layers: Layer[] = [];
  const protectedBoxes: Box[] = [];
  const stage = { left: 70, top: 190, width: 940, height: 620 };
  const photoSize = 520;
  const photo = await sharp(photoOf(input, product.id))
    .resize(photoSize, photoSize, { fit: "contain", background: brand.surface })
    .flatten({ background: brand.surface })
    .png()
    .toBuffer();
  const card = await sharp(
    roundedRect(photoSize + 60, photoSize + 60, 36, brand.surface),
  )
    .composite([{ input: photo, left: 30, top: 30 }])
    .png()
    .toBuffer();
  layers.push({
    input: roundedRect(stage.width, stage.height, 48, brand.greenTint),
    left: stage.left,
    top: stage.top,
  });
  const withMascot = poseIsUsable(input.pose);
  const cardLeft = withMascot
    ? stage.left + stage.width - (photoSize + 60) - 30
    : stage.left + Math.round((stage.width - (photoSize + 60)) / 2);
  const cardTop = stage.top + Math.round((stage.height - (photoSize + 60)) / 2);
  layers.push({ input: card, left: cardLeft, top: cardTop });
  protectedBoxes.push({
    left: cardLeft,
    top: cardTop,
    width: photoSize + 60,
    height: photoSize + 60,
  });
  if (product.categoryName) {
    const chip = await arabic(product.categoryName, {
      size: 28,
      weight: "bold",
      color: brand.surface,
      width: 420,
    });
    const chipWidth = chip.width + 48;
    const chipLeft = stage.left + stage.width - 28 - chipWidth;
    layers.push({
      input: pill(chipWidth, 56, brand.green),
      left: chipLeft,
      top: stage.top + 28,
    });
    layers.push({
      input: chip.input,
      left: chipLeft + 24,
      top: stage.top + 28 + Math.round((56 - chip.height) / 2),
    });
  }

  const name = await arabic(input.copy.headline, {
    size: 60,
    weight: "heavy",
    color: brand.text,
    width: 940,
    align: "center",
    maxHeight: 170,
  });
  const nameTop = stage.top + stage.height + 30;
  layers.push(
    placeText(name, { left: 70, top: nameTop, width: 940 }, "center"),
  );
  protectedBoxes.push({
    left: 70,
    top: nameTop,
    width: 940,
    height: name.height,
  });

  // The price and the call to action share one row: price on the right, button on the left.
  const rowTop = nameTop + name.height + 26;
  const price = await arabic(product.priceLabel, {
    size: 52,
    weight: "heavy",
    color: brand.surface,
    width: 600,
  });
  const priceWidth = price.width + 80;
  const priceLeft = FEED_WIDTH - 70 - priceWidth;
  layers.push({
    input: pill(priceWidth, 96, brand.green),
    left: priceLeft,
    top: rowTop,
  });
  layers.push({
    input: price.input,
    left: priceLeft + 40,
    top: rowTop + Math.round((96 - price.height) / 2),
  });
  protectedBoxes.push({
    left: priceLeft,
    top: rowTop,
    width: priceWidth,
    height: 96,
  });
  const cta = await ctaPill(input.copy.cta, 70 + 230, rowTop + 6);
  layers.push(...cta.layers);
  protectedBoxes.push(cta.box);
  let mascotBox: Box | null = null;
  if (withMascot) {
    const art = await mascot(input.pose!, 420, cardLeft - stage.left - 20);
    mascotBox = {
      left: stage.left + 10,
      top: stage.top + stage.height - art.height,
      width: art.width,
      height: art.height,
    };
    layers.push({ input: art.input, left: mascotBox.left, top: mascotBox.top });
  }
  const shift = settleShift(protectedBoxes, rowTop + 96);
  for (const layer of layers) layer.top = (layer.top ?? 0) + shift;
  for (const box of protectedBoxes) box.top += shift;
  if (mascotBox) mascotBox.top += shift;
  return { layers, mascotBox, protectedBoxes };
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
  product_spotlight: productSpotlight,
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
  // Meetho is in every campaign: an unusable pose falls back to the approved presenting pose,
  // and a layout with no room for him fails visibly instead of quietly leaving him out.
  const usable = {
    ...input,
    pose: poseIsUsable(input.pose) ? input.pose : ("presenting" as const),
  };
  const body = await layouts[usable.layout](usable);
  if (!body.mascotBox) throw new Error("MASCOT_ARTWORK_REQUIRED");
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

export const STORY_EXPORT_WIDTH = 1080;
export const STORY_EXPORT_HEIGHT = 1920;
/** Stories cover the top 13% and bottom 17% with the app's own controls. */
const STORY_SAFE_TOP = 250;
const STORY_SAFE_BOTTOM = 330;

export type CampaignFormat = "square" | "story";

const formatSizes: Record<
  CampaignFormat,
  { height: number; top: number; bottom: number; headline: number }
> = {
  // 1:1: the same story in less height, with a smaller headline and one row of products.
  square: { height: 1080, top: 30, bottom: 0, headline: 60 },
  // 9:16: everything that matters sits between the Story's safe zones.
  story: {
    height: STORY_EXPORT_HEIGHT,
    top: STORY_SAFE_TOP,
    bottom: STORY_SAFE_BOTTOM,
    headline: 84,
  },
};

/**
 * A campaign composed for another shape, from the same approved copy, products and prices: a 1:1
 * post or a 9:16 Story. The layout is built for the shape (nothing is stretched or cropped), and
 * Meetho is always in it; when the layout cannot hold him at a readable size it fails with
 * MASCOT_ARTWORK_REQUIRED.
 */
export async function renderCampaignFormat(
  input: CampaignRenderInput,
  format: CampaignFormat,
): Promise<CampaignRender> {
  const size = formatSizes[format];
  const width = FEED_WIDTH;
  const height = size.height;
  const footerTop = height - size.bottom - 150;
  const contentTop = size.top + 150;
  const pose = poseIsUsable(input.pose) ? input.pose : ("presenting" as const);

  // The content is laid out once at full size, as one block: headline, then Meetho in his own
  // column beside the products (or large, when the campaign is about him), then the total or
  // price, then the call to action. The block is then fitted between header and footer.
  const block: Layer[] = [];
  const blockBoxes: Box[] = [];
  const head = await headlineBlock(
    input.copy,
    { left: 70, top: 0, width: width - 140 },
    "center",
    size.headline,
  );
  block.push(...head.layers);
  let top = head.bottom + (format === "story" ? 50 : 30);
  let mascotBox: Box | null = null;

  const items = input.bundle ? input.bundle.items.slice(0, 3) : [];
  const column = 260;
  const visualLeft = 70 + column + 30;
  const visualWidth = width - 70 - visualLeft;
  if (items.length || input.product) {
    let rowHeight = 0;
    if (items.length) {
      const gap = 24;
      const tileWidth = Math.min(
        format === "story" ? 220 : 190,
        Math.floor((visualWidth - (items.length - 1) * gap) / items.length),
      );
      const rowWidth = items.length * tileWidth + (items.length - 1) * gap;
      const rowLeft = visualLeft + Math.round((visualWidth - rowWidth) / 2);
      for (const [index, item] of items.entries()) {
        const tile = await productTile(
          item,
          photoOf(input, item.productId),
          tileWidth,
        );
        // Right-to-left: the first product sits on the right.
        const left = rowLeft + (items.length - 1 - index) * (tileWidth + gap);
        block.push({ input: tile.input, left, top });
        blockBoxes.push({ left, top, width: tileWidth, height: tile.height });
        rowHeight = Math.max(rowHeight, tile.height);
      }
    } else {
      const photoSize = Math.min(visualWidth, format === "story" ? 600 : 420);
      const tile = await photoTile(
        photoOf(input, input.product!.id),
        photoSize,
      );
      const left = visualLeft + Math.round((visualWidth - photoSize) / 2);
      block.push({ input: tile, left, top });
      blockBoxes.push({ left, top, width: photoSize, height: photoSize });
      rowHeight = photoSize;
    }
    const art = await mascot(
      pose,
      Math.min(rowHeight, format === "story" ? 420 : 340),
      column,
    );
    mascotBox = {
      left: 70 + Math.round((column - art.width) / 2),
      top: top + rowHeight - art.height,
      width: art.width,
      height: art.height,
    };
    block.push({ input: art.input, left: mascotBox.left, top: mascotBox.top });
    top += rowHeight + 24;

    if (input.bundle) {
      const hidden = input.bundle.items.length - items.length;
      if (hidden > 0) {
        // A count word, not a digit: «و2» would be reordered by the bidi algorithm.
        const more = await arabic(`و${itemCount(hidden)} كمان بالسلة`, {
          size: 28,
          weight: "semibold",
          color: brand.muted,
          width: 600,
          align: "center",
        });
        block.push(placeText(more, { left: 240, top, width: 600 }, "center"));
        top += more.height + 12;
      }
      const total = await totalBand(input.bundle, input, top);
      block.push(...total.layers);
      blockBoxes.push(total.box);
      top = total.box.top + total.box.height + 28;
    } else {
      const price = await arabic(input.product!.priceLabel, {
        size: 48,
        weight: "heavy",
        color: brand.green,
        width: 900,
        align: "center",
      });
      const box = { left: 90, top, width: 900, height: price.height };
      block.push(placeText(price, box, "center"));
      blockBoxes.push(box);
      top += price.height + 24;
    }
  } else {
    // A campaign about Meetho or the store: he takes the stage under the headline.
    const art = await mascot(pose, format === "story" ? 600 : 400, width - 200);
    mascotBox = {
      left: Math.round((width - art.width) / 2),
      top,
      width: art.width,
      height: art.height,
    };
    block.push({ input: art.input, left: mascotBox.left, top });
    top += art.height + 28;
  }
  const cta = await ctaPill(input.copy.cta, width / 2, top);
  block.push(...cta.layers);
  blockBoxes.push(cta.box);
  const blockHeight = cta.box.top + cta.box.height;

  // Fitted between the header and the footer: shrunk only when it would not fit, never enlarged.
  const room = footerTop - 20 - contentTop;
  const scale = Math.min(1, room / blockHeight);
  if (scale < 0.7) throw new Error("MASCOT_ARTWORK_REQUIRED");
  const blockImage = await sharp({
    create: {
      width,
      height: blockHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(block)
    .png()
    .toBuffer();
  const scaledWidth = Math.round(width * scale);
  const scaledHeight = Math.round(blockHeight * scale);
  const offsetLeft = Math.round((width - scaledWidth) / 2);
  const offsetTop = contentTop + Math.round((room - scaledHeight) / 2);
  const place = (box: Box): Box => ({
    left: offsetLeft + Math.round(box.left * scale),
    top: offsetTop + Math.round(box.top * scale),
    width: Math.round(box.width * scale),
    height: Math.round(box.height * scale),
  });

  const layers: Layer[] = [
    { input: leafDecoration(width, height), left: 0, top: 0 },
    // Under a Story's reply bar: the footer's green continues to the edge.
    ...(size.bottom
      ? [
          {
            input: roundedRect(
              width,
              size.bottom + 10,
              0,
              brand.green,
              brand.green,
            ),
            left: 0,
            top: height - size.bottom - 10,
          },
        ]
      : []),
    ...(await header(width, size.top, campaignTypeLabels[input.type])),
    {
      input:
        scale < 1
          ? await sharp(blockImage).resize(scaledWidth, scaledHeight).toBuffer()
          : blockImage,
      left: offsetLeft,
      top: offsetTop,
    },
    ...(await footer(
      width,
      height - size.bottom,
      input.store,
      input.siteLabel,
      150,
    )),
  ];
  const image = await sharp({
    create: { width, height, channels: 4, background: brand.canvas },
  })
    .composite(layers)
    .flatten({ background: brand.canvas })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
  return {
    image,
    mascotBox: place(mascotBox),
    protectedBoxes: [
      ...blockBoxes.map(place),
      { left: 0, top: footerTop, width, height: 150 },
    ],
  };
}

/**
 * A carousel for a campaign with products: a cover with the hook and Meetho, one slide per
 * product with its photo and real price, and a closing slide with the total, delivery facts and
 * the call to action. Every slide is 1080×1350. Campaigns without products have no carousel.
 */
export async function renderCampaignCarousel(
  input: CampaignRenderInput,
): Promise<Buffer[] | null> {
  const items: Array<{ id: string; name: string; price: string }> = input.bundle
    ? input.bundle.items.map((item) => ({
        id: item.productId,
        name: item.name,
        price: formatIls(item.priceAgorot),
      }))
    : input.product
      ? [
          {
            id: input.product.id,
            name: input.product.name,
            price: input.product.priceLabel,
          },
        ]
      : [];
  if (!items.length) return null;
  const pose = poseIsUsable(input.pose) ? input.pose : ("presenting" as const);
  const shown = items.slice(0, 5);
  const slide = async (layers: Layer[]) =>
    sharp({
      create: {
        width: FEED_WIDTH,
        height: FEED_HEIGHT,
        channels: 4,
        background: brand.canvas,
      },
    })
      .composite([
        { input: leafDecoration(FEED_WIDTH, FEED_HEIGHT), left: 0, top: 0 },
        ...(await header(FEED_WIDTH, 40, campaignTypeLabels[input.type])),
        ...layers,
        ...(await footer(
          FEED_WIDTH,
          FEED_HEIGHT,
          input.store,
          input.siteLabel,
        )),
      ])
      .flatten({ background: brand.canvas })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();
  const slides: Buffer[] = [];

  // Cover: the hook, Meetho presenting, and a nudge to swipe.
  const cover: Layer[] = [];
  const head = await headlineBlock(
    input.copy,
    { left: 70, top: 200, width: 940 },
    "center",
    80,
  );
  cover.push(...head.layers);
  const art = await mascot(pose, FOOTER_TOP - head.bottom - 130, 700);
  cover.push({
    input: art.input,
    left: Math.round((FEED_WIDTH - art.width) / 2),
    top: FOOTER_TOP - art.height - 80,
  });
  // Words only: the brand font has no arrow glyph.
  const swipe = await arabic("اسحبوا لتشوفوا كل غرض", {
    size: 32,
    weight: "bold",
    color: brand.green,
    width: 600,
    align: "center",
  });
  cover.push(
    placeText(swipe, { left: 240, top: FOOTER_TOP - 64, width: 600 }, "center"),
  );
  slides.push(await slide(cover));

  // One slide per product.
  for (const [index, item] of shown.entries()) {
    const layers: Layer[] = [];
    const count = await arabic(`${index + 1} من ${shown.length}`, {
      size: 28,
      weight: "semibold",
      color: brand.muted,
      width: 300,
      align: "center",
    });
    layers.push(
      placeText(count, { left: 390, top: 190, width: 300 }, "center"),
    );
    const tile = await photoTile(photoOf(input, item.id), 680);
    layers.push({ input: tile, left: 200, top: 245 });
    const name = await arabic(shortProductName(item.name), {
      size: 44,
      weight: "heavy",
      color: brand.text,
      width: 900,
      align: "center",
      maxHeight: 120,
    });
    layers.push(placeText(name, { left: 90, top: 950, width: 900 }, "center"));
    const price = await arabic(item.price, {
      size: 52,
      weight: "heavy",
      color: brand.green,
      width: 900,
      align: "center",
    });
    layers.push(
      placeText(
        price,
        { left: 90, top: 960 + name.height + 10, width: 900 },
        "center",
      ),
    );
    slides.push(await slide(layers));
  }

  // Closing: the total (for a bundle) or the delivery facts, the call to action and Meetho.
  const close: Layer[] = [];
  let top = 230;
  if (input.bundle) {
    const total = await totalBand(input.bundle, input, top);
    close.push(...total.layers);
    top = total.box.top + total.box.height + 40;
  } else {
    const facts = await arabic(
      `توصيل داخل ${input.store.deliveryAreaAr} · مجاني من ${formatIls(input.store.freeDeliveryFromAgorot)}${input.store.cashOnDelivery ? " · الدفع عند الاستلام" : ""}`,
      {
        size: 38,
        weight: "bold",
        color: brand.green,
        width: 920,
        align: "center",
        maxHeight: 200,
      },
    );
    close.push(placeText(facts, { left: 80, top, width: 920 }, "center"));
    top += facts.height + 40;
  }
  const cta = await ctaPill(input.copy.cta, FEED_WIDTH / 2, top);
  close.push(...cta.layers);
  top = cta.box.top + cta.box.height + 30;
  const closing = await mascot(pose, Math.min(FOOTER_TOP - top - 20, 520), 700);
  close.push({
    input: closing.input,
    left: Math.round((FEED_WIDTH - closing.width) / 2),
    top,
  });
  // The group sits in the middle of the free space instead of leaving a gap above Meetho.
  const shift = Math.max(
    0,
    Math.floor((FOOTER_TOP - (top + closing.height) - 20) / 2),
  );
  for (const layer of close) layer.top = (layer.top ?? 0) + shift;
  slides.push(await slide(close));
  return slides;
}
