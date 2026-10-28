import type { SocialProduct, StoreFacts } from "./social-catalog";

/**
 * Bundles are suggestions built from the live catalog: real, available products at their real
 * prices, summed in agorot. They carry no discount. A special bundle price can only be advertised
 * once checkout charges it, which is a separate storefront change.
 */

/** One role in a bundle, e.g. «the dish soap»; filled by the first matching product. */
interface Slot {
  categories: readonly string[];
  /** Words in the product's Arabic name that mark it for this role. */
  match?: RegExp;
}

export interface BundleTheme {
  id: string;
  nameAr: string;
  /** The room or job the bundle is for, as a shopper would say it. */
  forAr: string;
  slots: readonly Slot[];
}

export const bundleThemes: readonly BundleTheme[] = [
  {
    id: "kitchen",
    nameAr: "باكيج المطبخ",
    forAr: "مطبخ نظيف وجلي بلا تعب",
    slots: [
      { categories: ["kitchen-dishwashing"], match: /سائل جلي/ },
      { categories: ["kitchen-dishwashing"], match: /(^|\s)(إسفنج|ليف)/u },
      { categories: ["kitchen-dishwashing"], match: /الدهون|الأفران/ },
      { categories: ["kitchen-dishwashing"], match: /مناديل مبللة/ },
    ],
  },
  {
    id: "laundry",
    nameAr: "باكيج الغسيل",
    forAr: "غسيل نظيف وريحة حلوة",
    slots: [
      { categories: ["laundry"], match: /مسحوق|جل لغسيل|شامبو/ },
      { categories: ["laundry"], match: /منعّم|منعم/ },
      { categories: ["home-cleaners"], match: /البقع/ },
    ],
  },
  {
    id: "floors",
    nameAr: "باكيج الأرضيات",
    forAr: "بلاط يلمع وريحة تعبّي البيت",
    slots: [
      { categories: ["home-cleaners"], match: /البلاط|الأرضيات/ },
      { categories: ["cleaning-tools"], match: /مسّاحة|مساحة/ },
      { categories: ["cleaning-tools"], match: /مكنسة/ },
      { categories: ["cleaning-tools"], match: /مايكروفايبر|فوطة/ },
    ],
  },
  {
    id: "bathroom",
    nameAr: "باكيج الحمّام",
    forAr: "حمّام نظيف ومعقّم",
    slots: [
      { categories: ["bathroom", "home-cleaners"], match: /حمامات|مراحيض/ },
      { categories: ["home-cleaners"], match: /كلور/ },
      { categories: ["bathroom"], match: /صابونة مرحاض/ },
      { categories: ["home-fragrances"] },
    ],
  },
  {
    id: "fragrance",
    nameAr: "باكيج الريحة الحلوة",
    forAr: "بيت ريحته بتفتح النفس",
    slots: [
      { categories: ["home-fragrances"], match: /معطر الجو|معطر جو/ },
      { categories: ["carpet-upholstery"], match: /بودرة/ },
      { categories: ["home-fragrances"], match: /الروائح القوية/ },
    ],
  },
];

/** The core of a product name: the part before its size or variant details. */
export function coreProductName(name: string): string {
  return name.split(/\s[–—-]\s|\s\(|\s\|/u)[0]!.trim();
}

/** The core name cut to 28 letters, for a small card on an image. */
export function shortProductName(name: string): string {
  const core = coreProductName(name);
  return core.length > 28 ? `${core.slice(0, 27).trim()}…` : core;
}

export interface BundleItem {
  productId: string;
  /** The exact variant the price belongs to, so a cart link adds the same thing. */
  variantId: string;
  variantLabel: string | null;
  name: string;
  imageUrl: string;
  priceAgorot: number;
}

export interface Bundle {
  themeId: string;
  nameAr: string;
  forAr: string;
  items: BundleItem[];
  totalAgorot: number;
  /** Whether the real total reaches the store's free-delivery threshold. */
  freeDelivery: boolean;
  /** How much is still missing for free delivery, 0 when reached. */
  missingAgorot: number;
}

function itemOf(product: SocialProduct): BundleItem {
  // The cheapest available variant; its own price, never the product's «from» price on another.
  const variant = [...product.variants].sort(
    (a, b) => a.priceAgorot - b.priceAgorot,
  )[0]!;
  return {
    productId: product.id,
    variantId: variant.id,
    variantLabel: product.variants.length > 1 ? variant.label : null,
    name: product.name,
    imageUrl: variant.imageUrl ?? product.imageUrl,
    priceAgorot: variant.priceAgorot,
  };
}

export function bundleTotal(items: readonly BundleItem[]): number {
  return items.reduce((sum, item) => sum + item.priceAgorot, 0);
}

function summarize(
  theme: BundleTheme,
  items: BundleItem[],
  store: StoreFacts,
): Bundle {
  const totalAgorot = bundleTotal(items);
  const missingAgorot = Math.max(0, store.freeDeliveryFromAgorot - totalAgorot);
  return {
    themeId: theme.id,
    nameAr: theme.nameAr,
    forAr: theme.forAr,
    items,
    totalAgorot,
    freeDelivery: missingAgorot === 0,
    missingAgorot,
  };
}

/** A top-up item may pass the free-delivery threshold by at most this much. */
const TOP_UP_EXCESS_AGOROT = 1500;

/** A bundle needs at least this many products to be worth a post. */
export const MIN_BUNDLE_ITEMS = 3;

export interface BundleOptions {
  /** Products shown recently; they are used only when nothing else fills the role. */
  recentProductIds?: ReadonlySet<string>;
  /** Grow the bundle with more of the theme's products until it reaches free delivery. */
  reachFreeDelivery?: boolean;
  maxItems?: number;
}

/**
 * Fills each of the theme's roles with one available product. Returns null when fewer than two
 * roles can be filled: a «bundle» of one product is not a bundle.
 */
export function buildBundle(
  theme: BundleTheme,
  products: readonly SocialProduct[],
  store: StoreFacts,
  options: BundleOptions = {},
): Bundle | null {
  const recent = options.recentProductIds ?? new Set<string>();
  const maxItems = options.maxItems ?? 5;
  const used = new Set<string>();
  const candidates = (slot: Slot) =>
    products
      .filter(
        (product) =>
          slot.categories.includes(product.categoryCode) &&
          (!slot.match || slot.match.test(product.name)) &&
          !used.has(product.id),
      )
      // Fresh products first, then the more affordable one for the role (a bundle should suit a
      // household budget), then a stable order so the same catalog gives the same bundle.
      .sort(
        (a, b) =>
          Number(recent.has(a.id)) - Number(recent.has(b.id)) ||
          itemOf(a).priceAgorot - itemOf(b).priceAgorot ||
          a.id.localeCompare(b.id),
      );
  const items: BundleItem[] = [];
  for (const slot of theme.slots) {
    if (items.length >= maxItems) break;
    const product = candidates(slot)[0];
    if (!product) continue;
    used.add(product.id);
    items.push(itemOf(product));
  }
  if (items.length < 2) return null;
  if (options.reachFreeDelivery) {
    // Top up with the theme's other products the way a shopper would: one item that just
    // reaches the threshold, otherwise the largest that still fits below it, and again.
    const pool = products.filter(
      (product) =>
        theme.slots.some((slot) =>
          slot.categories.includes(product.categoryCode),
        ) && !used.has(product.id),
    );
    while (
      items.length < maxItems &&
      bundleTotal(items) < store.freeDeliveryFromAgorot &&
      pool.length
    ) {
      const missing = store.freeDeliveryFromAgorot - bundleTotal(items);
      const price = (product: SocialProduct) => itemOf(product).priceAgorot;
      pool.sort((a, b) => price(a) - price(b) || a.id.localeCompare(b.id));
      const reaching = pool.find((product) => price(product) >= missing);
      const below = pool.filter((product) => price(product) < missing).at(-1);
      const next =
        reaching &&
        (price(reaching) - missing <= TOP_UP_EXCESS_AGOROT || !below)
          ? reaching
          : (below ?? reaching)!;
      pool.splice(pool.indexOf(next), 1);
      used.add(next.id);
      items.push(itemOf(next));
    }
  }
  if (items.length < MIN_BUNDLE_ITEMS) return null;
  return summarize(theme, items, store);
}

/** Every theme that can be filled from today's catalog. */
export function availableBundles(
  products: readonly SocialProduct[],
  store: StoreFacts,
  options: BundleOptions = {},
): Bundle[] {
  return bundleThemes
    .map((theme) => buildBundle(theme, products, store, options))
    .filter((bundle): bundle is Bundle => bundle !== null);
}
