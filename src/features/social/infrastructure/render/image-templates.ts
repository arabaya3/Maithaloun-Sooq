import sharp, { type OverlayOptions, type Sharp } from "sharp";

import {
  postKindLabels,
  shoppingTips,
  type PostKind,
  type ShoppingTipId,
} from "@/features/social/domain/captions";
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

/** 4:5 is the tallest ratio the Facebook feed shows uncropped on phones. */
export const FEED_WIDTH = 1080;
export const FEED_HEIGHT = 1350;

export interface FeedRenderInput {
  kind: PostKind;
  products: readonly SocialProduct[];
  photos: ReadonlyMap<string, Buffer>;
  store: StoreFacts;
  /** The storefront address as shown to people, e.g. maithaloun-sooq.vercel.app. */
  siteLabel: string;
  tipId?: ShoppingTipId | null;
  /** A single-category collection's title. */
  categoryName?: string | null;
}

type Layer = OverlayOptions;

const titles: Partial<Record<PostKind, string>> = {
  new_arrivals: "وصل حديثاً",
  weekly_highlights: "مختارات الأسبوع",
};

export async function header(
  width: number,
  top: number,
  tag: string | null,
): Promise<Layer[]> {
  const layers: Layer[] = [];
  const logoSize = 120;
  layers.push({
    input: await logo(logoSize),
    left: width - 48 - logoSize,
    top,
  });
  const name = await renderText("مايثا ماركت", {
    size: 40,
    weight: "bold",
    color: brand.green,
    width: 420,
  });
  layers.push(
    placeText(name, {
      left: 0,
      top: top + 18,
      width: width - 60 - logoSize - 16,
    }),
  );
  const sub = await renderText("ميثلون • جنين", {
    size: 26,
    color: brand.muted,
    width: 420,
  });
  layers.push(
    placeText(sub, {
      left: 0,
      top: top + 72,
      width: width - 60 - logoSize - 16,
    }),
  );
  if (tag) {
    const label = await renderText(tag, {
      size: 30,
      weight: "bold",
      color: brand.surface,
      width: 400,
    });
    const pillWidth = label.width + 56;
    layers.push({
      input: pill(pillWidth, 64, brand.amber),
      left: 48,
      top: top + 28,
    });
    layers.push({
      input: label.input,
      left: 48 + 28,
      top: top + 28 + Math.round((64 - label.height) / 2),
    });
  }
  return layers;
}

export async function footer(
  width: number,
  height: number,
  store: StoreFacts,
  siteLabel: string,
  bandHeight = 170,
): Promise<Layer[]> {
  const top = height - bandHeight;
  const layers: Layer[] = [
    {
      input: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${bandHeight}"><rect width="${width}" height="${bandHeight}" fill="${brand.green}"/></svg>`,
      ),
      left: 0,
      top,
    },
  ];
  const delivery = await renderText(
    `توصيل داخل ${store.deliveryAreaAr} • مجاني من ${formatIls(store.freeDeliveryFromAgorot)}`,
    {
      size: 32,
      weight: "bold",
      color: brand.surface,
      width: width - 96,
      align: "center",
    },
  );
  layers.push(
    placeText(
      delivery,
      { left: 48, top: top + 26, width: width - 96 },
      "center",
    ),
  );
  const contact = await renderText(
    store.whatsAppE164
      ? `${ltr(siteLabel)}  •  واتساب ${ltr(store.whatsAppE164)}`
      : ltr(siteLabel),
    { size: 28, color: brand.greenTint, width: width - 96, align: "center" },
  );
  layers.push(
    placeText(
      contact,
      { left: 48, top: top + 92, width: width - 96 },
      "center",
    ),
  );
  return layers;
}

function canvas(width: number, height: number): Sharp {
  return sharp({
    create: { width, height, channels: 4, background: brand.canvas },
  });
}

async function priceTag(
  text: string,
  size: number,
): Promise<{ layer: Buffer; width: number; height: number }> {
  const label = await renderText(text, {
    size,
    weight: "heavy",
    color: brand.surface,
    width: 700,
  });
  const width = label.width + size * 1.6;
  const height = Math.round(label.height + size * 0.7);
  const layer = await sharp(pill(Math.round(width), height, brand.green))
    .composite([
      {
        input: label.input,
        left: Math.round(size * 0.8),
        top: Math.round((height - label.height) / 2),
      },
    ])
    .png()
    .toBuffer();
  return { layer, width: Math.round(width), height };
}

async function singleProduct(input: FeedRenderInput): Promise<Layer[]> {
  const product = input.products[0]!;
  const photo = input.photos.get(product.id);
  if (!photo) throw new Error("PRODUCT_PHOTO_MISSING");
  const cardWidth = 760;
  const cardHeight = 650;
  const layers: Layer[] = [
    {
      input: await productCard(photo, cardWidth, cardHeight),
      left: (FEED_WIDTH - cardWidth) / 2,
      top: 190,
    },
  ];
  const name = await renderText(product.name, {
    size: 48,
    weight: "bold",
    color: brand.text,
    width: 940,
    align: "center",
    maxHeight: 190,
  });
  layers.push(placeText(name, { left: 70, top: 870, width: 940 }, "center"));
  const tag = await priceTag(formatSocialPrice(product), 44);
  layers.push({
    input: tag.layer,
    left: Math.round((FEED_WIDTH - tag.width) / 2),
    top: 870 + name.height + 24,
  });
  return layers;
}

function gridCells(
  count: number,
): Array<{ left: number; top: number; width: number; height: number }> {
  const gap = 28;
  const top = 270;
  const width = (FEED_WIDTH - 96 - gap) / 2;
  if (count <= 2) {
    return Array.from({ length: count }, (_, index) => ({
      left: 48 + index * (width + gap),
      top: top + 60,
      width,
      height: 520,
    }));
  }
  const cells = [];
  for (let index = 0; index < Math.min(count, 4); index += 1) {
    const row = Math.floor(index / 2);
    const column = index % 2;
    const lastAlone = count === 3 && index === 2;
    cells.push({
      left: lastAlone
        ? Math.round((FEED_WIDTH - width) / 2)
        : 48 + column * (width + gap),
      top: top + row * 456,
      width,
      height: 300,
    });
  }
  return cells;
}

async function productGrid(
  input: FeedRenderInput,
  title: string,
): Promise<Layer[]> {
  const layers: Layer[] = [];
  const heading = await renderText(title, {
    size: 50,
    weight: "heavy",
    color: brand.green,
    width: 980,
    align: "center",
    maxHeight: 80,
  });
  layers.push(placeText(heading, { left: 50, top: 180, width: 980 }, "center"));
  const products = input.products.slice(0, 4);
  const cells = gridCells(products.length);
  for (const [index, product] of products.entries()) {
    const cell = cells[index]!;
    const photo = input.photos.get(product.id);
    if (!photo) throw new Error("PRODUCT_PHOTO_MISSING");
    layers.push({
      input: await productCard(photo, Math.round(cell.width), cell.height, 18),
      left: Math.round(cell.left),
      top: cell.top,
    });
    const name = await renderText(product.name, {
      size: 26,
      weight: "semibold",
      color: brand.text,
      width: Math.round(cell.width) - 16,
      align: "center",
      maxHeight: 76,
    });
    layers.push(
      placeText(
        name,
        {
          left: Math.round(cell.left) + 8,
          top: cell.top + cell.height + 10,
          width: Math.round(cell.width) - 16,
        },
        "center",
      ),
    );
    const price = await renderText(formatSocialPrice(product), {
      size: 30,
      weight: "heavy",
      color: brand.amber,
      width: Math.round(cell.width),
      align: "center",
    });
    layers.push(
      placeText(
        price,
        {
          left: Math.round(cell.left),
          top: cell.top + cell.height + 14 + Math.min(name.height, 76),
          width: Math.round(cell.width),
        },
        "center",
      ),
    );
  }
  return layers;
}

async function infoCard(
  rows: Array<{
    icon: Parameters<typeof iconBadge>[0];
    title: string;
    body: string;
  }>,
  heading: string,
  width: number,
  top: number,
): Promise<Layer[]> {
  const layers: Layer[] = [];
  const title = await renderText(heading, {
    size: 58,
    weight: "heavy",
    color: brand.green,
    width: width - 120,
    align: "center",
    maxHeight: 170,
  });
  layers.push(
    placeText(title, { left: 60, top, width: width - 120 }, "center"),
  );
  let y = top + title.height + 50;
  for (const row of rows) {
    const cardHeight = 170;
    layers.push({
      input: roundedRect(
        width - 120,
        cardHeight,
        32,
        brand.surface,
        brand.sand,
      ),
      left: 60,
      top: y,
    });
    layers.push({
      input: iconBadge(row.icon, 104, brand.greenTint, brand.green),
      left: width - 60 - 32 - 104,
      top: y + 33,
    });
    const rowTitle = await renderText(row.title, {
      size: 34,
      weight: "bold",
      color: brand.text,
      width: width - 340,
    });
    layers.push(
      placeText(rowTitle, { left: 90, top: y + 26, width: width - 340 }),
    );
    const body = await renderText(row.body, {
      size: 27,
      color: brand.muted,
      width: width - 340,
      maxHeight: 76,
    });
    layers.push(
      placeText(body, {
        left: 90,
        top: y + 30 + rowTitle.height,
        width: width - 340,
      }),
    );
    y += cardHeight + 26;
  }
  return layers;
}

async function tipLayers(input: FeedRenderInput): Promise<Layer[]> {
  const tip =
    shoppingTips.find((candidate) => candidate.id === input.tipId) ??
    shoppingTips[0];
  const layers: Layer[] = [
    {
      input: iconBadge("lightbulb", 220, brand.greenTint, brand.green),
      left: (FEED_WIDTH - 220) / 2,
      top: 300,
    },
  ];
  const title = await renderText(tip.title, {
    size: 66,
    weight: "heavy",
    color: brand.green,
    width: 940,
    align: "center",
    maxHeight: 190,
  });
  layers.push(placeText(title, { left: 70, top: 580, width: 940 }, "center"));
  const body = await renderText(tip.body(input.store), {
    size: 42,
    color: brand.text,
    width: 900,
    align: "center",
    maxHeight: 420,
    lineSpacing: 0.2,
  });
  layers.push(
    placeText(
      body,
      { left: 90, top: 580 + title.height + 50, width: 900 },
      "center",
    ),
  );
  return layers;
}

export function deliveryRows(store: StoreFacts) {
  return [
    {
      icon: "mapPin" as const,
      title: `داخل ${store.deliveryAreaAr}`,
      body: "التوصيل حالياً داخل البلد فقط.",
    },
    {
      icon: "truck" as const,
      title: `${formatIls(store.deliveryFeeAgorot)} أجرة التوصيل`,
      body: `ومجاني للطلبات من ${formatIls(store.freeDeliveryFromAgorot)} وفوق.`,
    },
    ...(store.cashOnDelivery
      ? [
          {
            icon: "banknote" as const,
            title: "الدفع عند الاستلام",
            body: "نقداً لما يوصلكم الطلب.",
          },
        ]
      : []),
    {
      icon: "cart" as const,
      title: "اطلبوا بسهولة",
      body: store.whatsAppE164
        ? `من الموقع أو على واتساب ${ltr(store.whatsAppE164)}`
        : "من الموقع مباشرة.",
    },
  ];
}

export async function renderFeedImage(input: FeedRenderInput): Promise<Buffer> {
  // Grids carry their own heading; the tag would only repeat it.
  const tag =
    input.kind === "product" ||
    input.kind === "shopping_tip" ||
    input.kind === "delivery_info"
      ? postKindLabels[input.kind]
      : null;
  const layers: Layer[] = [
    { input: leafDecoration(FEED_WIDTH, FEED_HEIGHT), left: 0, top: 0 },
    ...(await header(FEED_WIDTH, 40, tag)),
  ];
  switch (input.kind) {
    case "product":
      layers.push(...(await singleProduct(input)));
      break;
    case "collection":
    case "new_arrivals":
    case "weekly_highlights":
      layers.push(
        ...(await productGrid(
          input,
          input.kind === "collection" && input.categoryName
            ? `من قسم ${input.categoryName}`
            : (titles[input.kind] ?? "من مايثا ماركت"),
        )),
      );
      break;
    case "shopping_tip":
      layers.push(...(await tipLayers(input)));
      break;
    case "delivery_info":
      layers.push(
        ...(await infoCard(
          deliveryRows(input.store),
          "التوصيل من مايثا ماركت",
          FEED_WIDTH,
          200,
        )),
      );
      break;
  }
  layers.push(
    ...(await footer(FEED_WIDTH, FEED_HEIGHT, input.store, input.siteLabel)),
  );
  return canvas(FEED_WIDTH, FEED_HEIGHT)
    .composite(layers)
    .flatten({ background: brand.canvas })
    .jpeg({ quality: 90, chromaSubsampling: "4:4:4" })
    .toBuffer();
}
