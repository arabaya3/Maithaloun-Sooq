/**
 * Align catalog names/images/variants with identified packaging photos.
 * Runs on Vercel production builds only.
 */
import postgres from "postgres";

function toSessionPoolerUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  if (url.hostname.includes("pooler.supabase.com") && url.port === "6543") {
    url.port = "5432";
  }
  return url.toString();
}

function shouldRun(databaseUrl: string): boolean {
  if (process.env.APPLY_INVOICE_CATALOG === "1") return true;
  const hostname = new URL(databaseUrl).hostname;
  if (["127.0.0.1", "localhost"].includes(hostname)) return false;
  return Boolean(process.env.VERCEL) || process.env.APPLY_DB_MIGRATIONS === "1";
}

const IMAGE_SIZE = 1400;

type ProductPatch = {
  domainId: string;
  nameAr: string;
  latinName: string | null;
  description: string;
  imageSrc: string;
  imageAlt: string;
  variants: Array<{
    domainId: string;
    labelAr: string;
    attributes: Record<string, string>;
    sortOrder: number;
    isDefault: boolean;
    imageSrc: string;
    imageAlt: string;
  }>;
};

const patches: ProductPatch[] = [
  {
    domainId: "degreaser-8",
    nameAr: "مزيل دهون وزيوت فينيسيا",
    latinName: "Venecia",
    description: "مزيل دهون وزيوت فينيسيا قوي وفعّال للمطابخ والأفران والأسطح.",
    imageSrc: "/products/venecia-degreaser-real.webp",
    imageAlt: "مزيل دهون فينيسيا",
    variants: [
      {
        domainId: "degreaser-8--default",
        labelAr: "750 مل",
        attributes: { الحجم: "750 مل" },
        sortOrder: 0,
        isDefault: true,
        imageSrc: "/products/venecia-degreaser-real.webp",
        imageAlt: "مزيل دهون فينيسيا",
      },
    ],
  },
  {
    domainId: "degreaser-10",
    nameAr: "منظف أفران عرار",
    latinName: "Arar",
    description: "منظف أفران عرار بتركيز مضاعف.",
    imageSrc: "/products/arar-oven-cleaner-real.webp",
    imageAlt: "منظف أفران عرار",
    variants: [
      {
        domainId: "degreaser-10--default",
        labelAr: "750 مل",
        attributes: { الحجم: "750 مل" },
        sortOrder: 0,
        isDefault: true,
        imageSrc: "/products/arar-oven-cleaner-real.webp",
        imageAlt: "منظف أفران عرار",
      },
    ],
  },
  {
    domainId: "arar-dish-liquid",
    nameAr: "سائل جلي عرار 2X بالليمون",
    latinName: "Arar",
    description: "سائل جلي عرار قوة مضاعفة بالليمون — عبوة 4 لتر.",
    imageSrc: "/products/arar-dish-real.webp",
    imageAlt: "سائل جلي عرار 4 لتر",
    variants: [
      {
        domainId: "arar-dish-liquid--default",
        labelAr: "4 لتر",
        attributes: { الحجم: "4 لتر" },
        sortOrder: 0,
        isDefault: true,
        imageSrc: "/products/arar-dish-real.webp",
        imageAlt: "سائل جلي عرار 4 لتر",
      },
    ],
  },
  {
    domainId: "general-cleaner",
    nameAr: "منظف عام هوم سيكرت",
    latinName: "Home Secret",
    description:
      "هوم سيكرت منظف عام للمطابخ والحمامات والأسطح والزجاج وداخل السيارة.",
    imageSrc: "/products/home-secret-real.webp",
    imageAlt: "منظف عام هوم سيكرت",
    variants: [
      {
        domainId: "general-cleaner--default",
        labelAr: "750 مل",
        attributes: { الحجم: "750 مل" },
        sortOrder: 0,
        isDefault: true,
        imageSrc: "/products/home-secret-real.webp",
        imageAlt: "منظف عام هوم سيكرت",
      },
    ],
  },
  {
    domainId: "smart-floor-cleaner",
    nameAr: "منظف أرضيات سمارت — روائح متعددة",
    latinName: "SMART",
    description:
      "منظف ومعطر وملمع أرضيات سمارت (البريق) — اختر الرائحة/اللون المناسب.",
    imageSrc: "/products/smart-floor-group.webp",
    imageAlt: "منظفات أرضيات سمارت بعدة روائح",
    variants: [
      {
        domainId: "smart-floor-cleaner--green",
        labelAr: "أخضر Golden Collection",
        attributes: { الرائحة: "أخضر" },
        sortOrder: 0,
        isDefault: true,
        imageSrc: "/products/smart-green-real.webp",
        imageAlt: "سمارت أخضر Golden Collection",
      },
      {
        domainId: "smart-floor-cleaner--purple",
        labelAr: "بنفسجي Golden Collection",
        attributes: { الرائحة: "بنفسجي" },
        sortOrder: 1,
        isDefault: false,
        imageSrc: "/products/smart-purple-real.webp",
        imageAlt: "سمارت بنفسجي Golden Collection",
      },
      {
        domainId: "smart-floor-cleaner--yellow",
        labelAr: "أصفر 4 في 1",
        attributes: { الرائحة: "أصفر" },
        sortOrder: 2,
        isDefault: false,
        imageSrc: "/products/smart-yellow-real.webp",
        imageAlt: "سمارت أصفر 4 في 1",
      },
    ],
  },
  {
    domainId: "musk-floor-cleaner",
    nameAr: "معطر ومنظف أرضيات مسك Pink Rose",
    latinName: "MISK",
    description: "مسك معطر ومنظف أرضيات برائحة الورد الوردي.",
    imageSrc: "/products/misk-floor-real.webp",
    imageAlt: "معطر أرضيات مسك Pink Rose",
    variants: [
      {
        domainId: "musk-floor-cleaner--default",
        labelAr: "Pink Rose",
        attributes: { الرائحة: "Pink Rose" },
        sortOrder: 0,
        isDefault: true,
        imageSrc: "/products/misk-floor-real.webp",
        imageAlt: "معطر أرضيات مسك Pink Rose",
      },
    ],
  },
  {
    domainId: "lilac-floor-cleaner",
    nameAr: "منظف ومعطر أرضيات ليلك ٤ في ١",
    latinName: "Laylak",
    description: "ليلك منظف ومعطر وملمع ومعقم للأرضيات من عرار.",
    imageSrc: "/products/laylak-floor-real.webp",
    imageAlt: "منظف أرضيات ليلك",
    variants: [
      {
        domainId: "lilac-floor-cleaner--default",
        labelAr: "مركز",
        attributes: { النوع: "مركز" },
        sortOrder: 0,
        isDefault: true,
        imageSrc: "/products/laylak-floor-real.webp",
        imageAlt: "منظف أرضيات ليلك",
      },
    ],
  },
  {
    domainId: "lilac-air-freshener",
    nameAr: "معطر ليلاك للجو والملابس والأثاث",
    latinName: "Lilac",
    description: "معطر ليلاك (عرار) للجو والملابس والأثاث — روائح متعددة.",
    imageSrc: "/products/lilac-air-group.webp",
    imageAlt: "معطرات ليلاك للجو والملابس",
    variants: [
      {
        domainId: "lilac-air-freshener--navy",
        labelAr: "كحلي — أزهار وردية",
        attributes: { اللون: "كحلي" },
        sortOrder: 0,
        isDefault: true,
        imageSrc: "/products/lilac-air-navy-real.webp",
        imageAlt: "معطر ليلاك كحلي",
      },
      {
        domainId: "lilac-air-freshener--blue",
        labelAr: "أزرق — أزهار صفراء",
        attributes: { اللون: "أزرق" },
        sortOrder: 1,
        isDefault: false,
        imageSrc: "/products/lilac-air-blue-real.webp",
        imageAlt: "معطر ليلاك أزرق",
      },
    ],
  },
  {
    domainId: "lamis-air-freshener",
    nameAr: "معطر لمياس للأقمشة والهواء",
    latinName: "Lamis",
    description: "معطر لمياس للهواء والأقمشة — اختر الرائحة.",
    imageSrc: "/products/lamis-air-group.webp",
    imageAlt: "معطرات لمياس بعدة روائح",
    variants: [
      {
        domainId: "lamis-air-freshener--velvet-musk",
        labelAr: "المسك المخملي",
        attributes: { الرائحة: "المسك المخملي" },
        sortOrder: 0,
        isDefault: true,
        imageSrc: "/products/lamis-velvet-musk-real.webp",
        imageAlt: "معطر لمياس المسك المخملي",
      },
      {
        domainId: "lamis-air-freshener--sweet-lavender",
        labelAr: "سويت لافندر",
        attributes: { الرائحة: "سويت لافندر" },
        sortOrder: 1,
        isDefault: false,
        imageSrc: "/products/lamis-lavender-real.webp",
        imageAlt: "معطر لمياس سويت لافندر",
      },
    ],
  },
  {
    domainId: "salima-tissues",
    nameAr: "محارم سليمة — منى الناعمة",
    latinName: "Salima",
    description: "محارم سليمة ورقية ناعمة (منى الناعمة).",
    imageSrc: "/products/salima-tissues.webp",
    imageAlt: "محارم سليمة",
    variants: [
      {
        domainId: "salima-tissues--default",
        labelAr: "عبوة",
        attributes: { النوع: "محارم" },
        sortOrder: 0,
        isDefault: true,
        imageSrc: "/products/salima-tissues.webp",
        imageAlt: "محارم سليمة",
      },
    ],
  },
  {
    domainId: "nadren-tissues",
    nameAr: "محارم نادرين",
    latinName: "Nadeen",
    description: "محارم نادرين ورقية — عبوة متعددة.",
    imageSrc: "/products/nadren-tissues-real.webp",
    imageAlt: "محارم نادرين",
    variants: [
      {
        domainId: "nadren-tissues--default",
        labelAr: "5 علب",
        attributes: { الكمية: "5" },
        sortOrder: 0,
        isDefault: true,
        imageSrc: "/products/nadren-tissues-real.webp",
        imageAlt: "محارم نادرين",
      },
    ],
  },
  {
    domainId: "dolphin-bleach",
    nameAr: "كلور دولفين للتبييض والتنظيف ٤ لتر",
    latinName: "Dolphin",
    description: "كلور دولفين (هيبوكلوريت الصوديوم) تركيز 4.5٪ — 4 لتر.",
    imageSrc: "/products/dolphin-bleach-real.webp",
    imageAlt: "كلور دولفين 4 لتر",
    variants: [
      {
        domainId: "dolphin-bleach--default",
        labelAr: "4 لتر",
        attributes: { الحجم: "4 لتر" },
        sortOrder: 0,
        isDefault: true,
        imageSrc: "/products/dolphin-bleach-real.webp",
        imageAlt: "كلور دولفين 4 لتر",
      },
    ],
  },
  {
    domainId: "carpet-brush",
    nameAr: "فرشاة تنظيف السجاد بعدة ألوان",
    latinName: null,
    description: "فرشاة تنظيف السجاد — ألوان متعددة.",
    imageSrc: "/products/carpet-brush-real.webp",
    imageAlt: "فرشاة تنظيف السجاد",
    variants: [
      {
        domainId: "carpet-brush--default",
        labelAr: "متعدد الألوان",
        attributes: { الألوان: "متعدد" },
        sortOrder: 0,
        isDefault: true,
        imageSrc: "/products/carpet-brush-real.webp",
        imageAlt: "فرشاة تنظيف السجاد",
      },
    ],
  },
];

/** LOYAL Soft Pink was wrongly shown as Lilac air — keep as its own product. */
const loyalSoftPink = {
  domainId: "loyal-fabric-softener",
  slug: "loyal-fabric-softener",
  nameAr: "منعم ومعطر ملابس لويال Soft Pink 750 مل",
  latinName: "LOYAL",
  priceAgorot: 1000,
  sortOrder: 28,
  categoryId: "laundry" as const,
  imageSrc: "/products/loyal-soft-pink-clean.webp",
  imageAlt: "منعم ملابس لويال Soft Pink",
  description: "منعم ومعطر ملابس لويال Soft Pink — 750 مل.",
  usageNotes: "يُستخدم مع الغسيل حسب تعليمات العبوة.",
  unit: "750 مل",
};

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("Skipping catalog photo sync: DATABASE_URL is not set.");
  process.exit(0);
}

if (!shouldRun(databaseUrl)) {
  console.log("Skipping catalog photo sync outside Vercel/remote apply mode.");
  process.exit(0);
}

const sessionUrl = toSessionPoolerUrl(databaseUrl);
const parsed = new URL(sessionUrl);
console.log(
  `Syncing catalog photo match on ${parsed.hostname}:${parsed.port || "(default)"}${parsed.pathname}`,
);

const sql = postgres(sessionUrl, { max: 1, prepare: false });

try {
  for (const patch of patches) {
    const [product] = await sql<{ id: string; price_agorot: number }[]>`
      update products
      set
        name_ar = ${patch.nameAr},
        latin_name = ${patch.latinName},
        description = ${patch.description},
        image_kind = 'image',
        image_src = ${patch.imageSrc},
        image_alt = ${patch.imageAlt},
        image_width = ${IMAGE_SIZE},
        image_height = ${IMAGE_SIZE},
        placeholder_variant = null,
        details_status = 'verified',
        updated_at = now()
      where domain_id = ${patch.domainId}
      returning id, price_agorot
    `;

    if (!product) {
      console.log(`skip missing ${patch.domainId}`);
      continue;
    }

    // Replace variants for this product to avoid sort_order uniqueness clashes.
    await sql`delete from product_variants where product_id = ${product.id}`;

    for (const variant of patch.variants) {
      await sql`
        insert into product_variants (
          product_id, domain_id, label_ar, attributes, price_agorot,
          availability, image_kind, image_src, image_alt, image_width,
          image_height, placeholder_variant, sort_order, is_default, updated_at
        ) values (
          ${product.id}, ${variant.domainId}, ${variant.labelAr},
          ${sql.json(variant.attributes)}, ${product.price_agorot},
          'available', 'image', ${variant.imageSrc}, ${variant.imageAlt},
          ${IMAGE_SIZE}, ${IMAGE_SIZE}, null, ${variant.sortOrder},
          ${variant.isDefault}, now()
        )
      `;
    }

    console.log(`synced ${patch.domainId} (${patch.variants.length} variants)`);
  }

  // Hide duplicate Lamis assortment listing (scents live on lamis-air-freshener now).
  await sql`
    update products
    set availability = 'unavailable', updated_at = now()
    where domain_id = 'lamis-air-freshener-assortment'
  `;

  // Upsert LOYAL Soft Pink as its own laundry product.
  const [loyal] = await sql<{ id: string }[]>`
    insert into products (
      domain_id, slug, name_ar, latin_name, price_agorot, sort_order,
      category_id, availability, image_kind, image_src, image_alt,
      image_width, image_height, placeholder_variant, description,
      usage_notes, unit, details_status, updated_at
    ) values (
      ${loyalSoftPink.domainId}, ${loyalSoftPink.slug}, ${loyalSoftPink.nameAr},
      ${loyalSoftPink.latinName}, ${loyalSoftPink.priceAgorot}, ${loyalSoftPink.sortOrder},
      ${loyalSoftPink.categoryId}, 'available', 'image', ${loyalSoftPink.imageSrc},
      ${loyalSoftPink.imageAlt}, ${IMAGE_SIZE}, ${IMAGE_SIZE}, null,
      ${loyalSoftPink.description}, ${loyalSoftPink.usageNotes}, ${loyalSoftPink.unit},
      'verified', now()
    )
    on conflict (domain_id) do update set
      name_ar = excluded.name_ar,
      latin_name = excluded.latin_name,
      price_agorot = excluded.price_agorot,
      category_id = excluded.category_id,
      availability = 'available',
      image_kind = 'image',
      image_src = excluded.image_src,
      image_alt = excluded.image_alt,
      image_width = excluded.image_width,
      image_height = excluded.image_height,
      placeholder_variant = null,
      description = excluded.description,
      usage_notes = excluded.usage_notes,
      unit = excluded.unit,
      details_status = 'verified',
      updated_at = now()
    returning id
  `;

  await sql`
    insert into product_variants (
      product_id, domain_id, label_ar, attributes, price_agorot,
      availability, image_kind, image_src, image_alt, image_width,
      image_height, placeholder_variant, sort_order, is_default, updated_at
    ) values (
      ${loyal.id}, ${loyalSoftPink.domainId + "--default"}, '750 مل',
      ${sql.json({ الحجم: "750 مل" })}, ${loyalSoftPink.priceAgorot},
      'available', 'image', ${loyalSoftPink.imageSrc}, ${loyalSoftPink.imageAlt},
      ${IMAGE_SIZE}, ${IMAGE_SIZE}, null, 0, true, now()
    )
    on conflict (domain_id) do update set
      product_id = excluded.product_id,
      label_ar = excluded.label_ar,
      attributes = excluded.attributes,
      price_agorot = excluded.price_agorot,
      image_src = excluded.image_src,
      image_alt = excluded.image_alt,
      image_kind = 'image',
      image_width = excluded.image_width,
      image_height = excluded.image_height,
      placeholder_variant = null,
      is_default = true,
      updated_at = now()
  `;

  console.log("upserted loyal-fabric-softener");
} finally {
  await sql.end({ timeout: 5 });
}

console.log("Catalog photo match sync complete.");
