import { addDays, startOfStoreDay } from "@/shared/lib/store-time";

import {
  shoppingTips,
  type PostKind,
  type ReelTemplate,
  type ShoppingTipId,
} from "./captions";
import type { PostFormat } from "./post-lifecycle";
import type { SocialProduct } from "./social-catalog";

/**
 * The starting cadence: four feed posts and two Reels a week, at evening hours when people in
 * Maythaloun are home. Times are store-local (Asia/Hebron).
 */
export interface WeeklySlot {
  weekday: number; // 0 = Sunday
  time: string; // HH:MM store time
  format: PostFormat;
}

export const defaultWeeklySlots: readonly WeeklySlot[] = [
  { weekday: 0, time: "19:30", format: "image" },
  { weekday: 1, time: "20:30", format: "reel" },
  { weekday: 2, time: "19:30", format: "image" },
  { weekday: 4, time: "19:30", format: "image" },
  { weekday: 5, time: "17:00", format: "reel" },
  { weekday: 6, time: "11:30", format: "image" },
];

const postKindCycle: readonly PostKind[] = [
  "product",
  "weekly_highlights",
  "product",
  "shopping_tip",
  "product",
  "collection",
  "product",
  "delivery_info",
];

const reelCycle: readonly ReelTemplate[] = [
  "spotlight",
  "collection",
  "spotlight",
  "delivery",
];

export interface PlannedItem {
  date: string;
  time: string;
  scheduledFor: Date;
  format: PostFormat;
  kind: PostKind;
  reelTemplate: ReelTemplate | null;
  productIds: string[];
  tipId: ShoppingTipId | null;
  /** For a single-category collection, the category it shows. */
  categoryCode: string | null;
}

export interface PlanInput {
  startDate: string;
  days: number;
  products: readonly SocialProduct[];
  /** Products that appeared in posts recently; they go to the back of the queue. */
  recentProductIds?: ReadonlySet<string>;
  /** Products first seen in the catalog recently (from product discovery), for «وصل حديثاً». */
  newArrivalIds?: readonly string[];
  slots?: readonly WeeklySlot[];
  /** Where the kind rotations start, so consecutive plans continue instead of restarting. */
  cycleOffset?: { post: number; reel: number; tip: number };
}

export function weekdayOf(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
}

export function storeInstant(date: string, time: string): Date {
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(
    startOfStoreDay(date).getTime() + (hours! * 60 + minutes!) * 60_000,
  );
}

/** Products in a fair order: fresh before recent, and categories interleaved so no feed is one aisle. */
export function rotationOrder(
  products: readonly SocialProduct[],
  recent: ReadonlySet<string> = new Set(),
): SocialProduct[] {
  const byCategory = new Map<string, SocialProduct[]>();
  const sorted = [...products].sort(
    (a, b) =>
      Number(recent.has(a.id)) - Number(recent.has(b.id)) ||
      a.id.localeCompare(b.id),
  );
  for (const product of sorted) {
    const list = byCategory.get(product.categoryCode) ?? [];
    list.push(product);
    byCategory.set(product.categoryCode, list);
  }
  const queues = [...byCategory.values()];
  const order: SocialProduct[] = [];
  while (queues.some((queue) => queue.length)) {
    for (const queue of queues) {
      const next = queue.shift();
      if (next) order.push(next);
    }
  }
  // Fresh products first across all categories, then the recent ones.
  return [
    ...order.filter((product) => !recent.has(product.id)),
    ...order.filter((product) => recent.has(product.id)),
  ];
}

class ProductQueue {
  private index = 0;
  constructor(private readonly order: readonly SocialProduct[]) {}

  take(
    count: number,
    accept: (product: SocialProduct) => boolean = () => true,
  ) {
    const picked: SocialProduct[] = [];
    for (
      let scanned = 0;
      scanned < this.order.length && picked.length < count;
      scanned += 1
    ) {
      const product = this.order[this.index % this.order.length]!;
      this.index += 1;
      if (accept(product) && !picked.includes(product)) picked.push(product);
    }
    return picked;
  }
}

function largestCategory(products: readonly SocialProduct[]): string | null {
  const counts = new Map<string, number>();
  for (const product of products) {
    counts.set(
      product.categoryCode,
      (counts.get(product.categoryCode) ?? 0) + 1,
    );
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export function buildContentPlan(input: PlanInput): PlannedItem[] {
  const slots = input.slots ?? defaultWeeklySlots;
  const queue = new ProductQueue(
    rotationOrder(input.products, input.recentProductIds),
  );
  const newArrivals = input.products.filter((product) =>
    input.newArrivalIds?.includes(product.id),
  );
  let newArrivalsUsed = false;
  const collectionCategories = new Set<string>();
  let postIndex = input.cycleOffset?.post ?? 0;
  let reelIndex = input.cycleOffset?.reel ?? 0;
  let tipIndex = input.cycleOffset?.tip ?? 0;
  const items: PlannedItem[] = [];

  for (let offset = 0; offset < input.days; offset += 1) {
    const date = addDays(input.startDate, offset);
    const weekday = weekdayOf(date);
    for (const slot of slots.filter(
      (candidate) => candidate.weekday === weekday,
    )) {
      const base = {
        date,
        time: slot.time,
        scheduledFor: storeInstant(date, slot.time),
        format: slot.format,
        tipId: null,
        categoryCode: null,
      };
      if (slot.format === "reel") {
        const template = reelCycle[reelIndex % reelCycle.length]!;
        reelIndex += 1;
        const count =
          template === "spotlight" ? 1 : template === "collection" ? 4 : 3;
        const products = queue.take(count);
        if (!products.length && template !== "delivery") continue;
        items.push({
          ...base,
          kind:
            template === "spotlight"
              ? "product"
              : template === "delivery"
                ? "delivery_info"
                : "weekly_highlights",
          reelTemplate: template,
          productIds: products.map((product) => product.id),
        });
        continue;
      }

      let kind = postKindCycle[postIndex % postKindCycle.length]!;
      postIndex += 1;
      if (
        kind === "weekly_highlights" &&
        newArrivals.length >= 2 &&
        !newArrivalsUsed
      ) {
        kind = "new_arrivals";
      }
      if (kind === "shopping_tip") {
        const tip = shoppingTips[tipIndex % shoppingTips.length]!;
        tipIndex += 1;
        items.push({
          ...base,
          kind,
          reelTemplate: null,
          productIds: [],
          tipId: tip.id,
        });
        continue;
      }
      if (kind === "delivery_info") {
        items.push({ ...base, kind, reelTemplate: null, productIds: [] });
        continue;
      }
      if (kind === "new_arrivals") {
        newArrivalsUsed = true;
        items.push({
          ...base,
          kind,
          reelTemplate: null,
          productIds: newArrivals.slice(0, 4).map((product) => product.id),
        });
        continue;
      }
      if (kind === "collection") {
        const remaining = input.products.filter(
          (product) => !collectionCategories.has(product.categoryCode),
        );
        const category = largestCategory(remaining);
        if (category) {
          collectionCategories.add(category);
          const products = queue.take(
            4,
            (product) => product.categoryCode === category,
          );
          if (products.length >= 2) {
            items.push({
              ...base,
              kind,
              reelTemplate: null,
              productIds: products.map((product) => product.id),
              categoryCode: category,
            });
            continue;
          }
        }
        kind = "weekly_highlights";
      }
      const products = queue.take(kind === "product" ? 1 : 4);
      if (!products.length) continue;
      items.push({
        ...base,
        kind,
        reelTemplate: null,
        productIds: products.map((product) => product.id),
      });
    }
  }
  return items;
}
