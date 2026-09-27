/**
 * Idempotent catalog upsert for invoice-priced products (2026-09-27 ink prices).
 * Runs on Vercel production builds only (same gate as ensure-order-contact-columns).
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

type CatalogProduct = {
  domainId: string;
  slug: string;
  nameAr: string;
  latinName: string | null;
  priceAgorot: number;
  sortOrder: number;
  categoryId: "laundry" | "kitchen" | "bathroom" | "tools" | "home";
  imageSrc: string;
  imageAlt: string;
  description: string;
  usageNotes: string | null;
  unit: string | null;
  variants?: Array<{
    domainId: string;
    labelAr: string;
    attributes: Record<string, string>;
    priceAgorot: number;
    sortOrder: number;
    isDefault: boolean;
    imageSrc: string;
    imageAlt: string;
  }>;
};

const IMAGE_SIZE = 1024;

/** Retail prices from handwritten ink on the 2026-09-27 sales invoice (₪ → agorot). */
const products: CatalogProduct[] = [
  {
    domainId: "swipe-magic-cloths",
    slug: "swipe-magic-cloths",
    nameAr: "الفوطة السحرية SWIPE",
    latinName: "SWIPE",
    priceAgorot: 500,
    sortOrder: 20,
    categoryId: "tools",
    imageSrc: "/products/swipe-magic-cloths.png",
    imageAlt: "علبة فوط سحرية SWIPE بألوان متعددة",
    description:
      "فوط تنظيف من الألياف الدقيقة (SWIPE) — مغناطيس الغبار السحري. تمتص السوائل بسرعة، لا تترك آثارًا، وتُستخدم رطبة أو جافة.",
    usageNotes:
      "مناسبة لتنظيف الرخام، السيراميك، الفرن، الستانلس، المرايا، الشبابيك، والتلفزيون.",
    unit: "علبة",
  },
  {
    domainId: "loyal-furniture-polish",
    slug: "loyal-furniture-polish",
    nameAr: "ملمع أثاث لويال 500 مل",
    latinName: "LOYAL",
    priceAgorot: 1000,
    sortOrder: 21,
    categoryId: "home",
    imageSrc: "/products/loyal-furniture-polish.png",
    imageAlt: "ملمع أثاث لويال للخشب والجلد",
    description: "ملمع أثاث لويال للخشب والجلد — نظافة، حماية، ولمعان.",
    usageNotes: "رشّ خفيف وامسح بقطعة ناعمة.",
    unit: "500 مل",
  },
  {
    domainId: "neka-toilet-blocks",
    slug: "neka-toilet-blocks",
    nameAr: "حجر حمام نيكلا BON ثلاثي",
    latinName: "Neka BON",
    priceAgorot: 1300,
    sortOrder: 22,
    categoryId: "bathroom",
    imageSrc: "/products/neka-toilet-blocks.png",
    imageAlt: "حجر حمام نيكلا BON عبوة ثلاثية",
    description:
      "حجر / معطر مرحاض للتعليق على حافة التواليت — عبوة ثلاثية (الثلاثي).",
    usageNotes: "علّق الوحدة داخل حوض المرحاض حسب التعليمات على العبوة.",
    unit: "3 قطع",
    variants: [
      {
        domainId: "neka-toilet-blocks--blue",
        labelAr: "أزرق",
        attributes: { اللون: "أزرق" },
        priceAgorot: 1300,
        sortOrder: 0,
        isDefault: true,
        imageSrc: "/products/neka-toilet-blocks.png",
        imageAlt: "حجر حمام نيكلا BON أزرق",
      },
      {
        domainId: "neka-toilet-blocks--green",
        labelAr: "أخضر",
        attributes: { اللون: "أخضر" },
        priceAgorot: 1300,
        sortOrder: 1,
        isDefault: false,
        imageSrc: "/products/neka-toilet-blocks.png",
        imageAlt: "حجر حمام نيكلا BON أخضر",
      },
    ],
  },
  {
    domainId: "loyal-air-freshener",
    slug: "loyal-air-freshener",
    nameAr: "معطر جو لويال 450 مل",
    latinName: "LOYAL",
    priceAgorot: 1000,
    sortOrder: 23,
    categoryId: "home",
    imageSrc: "/products/loyal-air-fresheners.png",
    imageAlt: "معطرات جو لويال بعدة روائح",
    description: "معطر جو لويال بخاخ 450 مل — روائح متنوعة.",
    usageNotes: "رشّ في الهواء أو على الأقمشة حسب تعليمات العبوة.",
    unit: "450 مل",
    variants: [
      {
        domainId: "loyal-air-freshener--lavender",
        labelAr: "خشب أبيض ولافندر",
        attributes: { الرائحة: "خشب أبيض ولافندر" },
        priceAgorot: 1000,
        sortOrder: 0,
        isDefault: true,
        imageSrc: "/products/loyal-air-fresheners.png",
        imageAlt: "معطر جو لويال برائحة الخشب الأبيض واللافندر",
      },
      {
        domainId: "loyal-air-freshener--dahlia",
        labelAr: "داليا حمراء وأوركيد",
        attributes: { الرائحة: "داليا حمراء وأوركيد" },
        priceAgorot: 1000,
        sortOrder: 1,
        isDefault: false,
        imageSrc: "/products/loyal-air-fresheners.png",
        imageAlt: "معطر جو لويال برائحة الداليا والأوركيد",
      },
      {
        domainId: "loyal-air-freshener--amber",
        labelAr: "باتشولي وعنبر",
        attributes: { الرائحة: "باتشولي وعنبر" },
        priceAgorot: 1000,
        sortOrder: 2,
        isDefault: false,
        imageSrc: "/products/loyal-air-fresheners.png",
        imageAlt: "معطر جو لويال برائحة الباتشولي والعنبر",
      },
    ],
  },
  {
    domainId: "lsj-scouring-pads",
    slug: "lsj-scouring-pads",
    nameAr: "ليف جلي LSJ 3 قطع",
    latinName: "LSJ",
    priceAgorot: 500,
    sortOrder: 24,
    categoryId: "kitchen",
    imageSrc: "/products/lsj-scouring-pads.png",
    imageAlt: "ليف جلي LSJ ثلاث قطع مع مقبض",
    description:
      "ليف جلي / إسفنج تنظيف LSJ — وجه إسفنج للمسح ووجه خشن للأوساخ الصعبة. عبوة 3 قطع.",
    usageNotes: "لتنظيف الأواني والمقالي؛ استخدم الوجه الخشن للأوساخ العنيدة.",
    unit: "3 قطع",
  },
  {
    domainId: "super-pink-wipes",
    slug: "super-pink-wipes",
    nameAr: "مناديل تنظيف SUPER PINK 400",
    latinName: "SUPER PINK",
    priceAgorot: 1000,
    sortOrder: 25,
    categoryId: "home",
    imageSrc: "/products/super-pink-wipes.png",
    imageAlt: "دلو مناديل تنظيف عامة SUPER PINK عدد 400",
    description:
      "مناديل تنظيف عامة SUPER PINK — 400 منديل في دلو بغطاء. للتنظيف السريع في المطبخ، الحمام، الزجاج، والسيارة.",
    usageNotes: "اسحب المنديل من الغطاء وأعد الإغلاق للحفاظ على الرطوبة.",
    unit: "400 منديل",
  },
  {
    domainId: "lamis-air-freshener-assortment",
    slug: "lamis-air-freshener-assortment",
    nameAr: "معطر جو ليس — روائح متنوعة",
    latinName: "Lamis",
    priceAgorot: 1000,
    sortOrder: 26,
    categoryId: "home",
    imageSrc: "/products/lamis-air-fresheners.png",
    imageAlt: "معطرات جو ليس بعدة روائح",
    description:
      "معطر جو ليس (Lamis) للأقمشة والهواء — يزيل الروائح ويعيد الانتعاش.",
    usageNotes: "مناسب للجو والأقمشة حسب تعليمات العبوة.",
    unit: "بخاخ",
    variants: [
      {
        domainId: "lamis-air-freshener-assortment--granada",
        labelAr: "غرناطة",
        attributes: { الرائحة: "غرناطة" },
        priceAgorot: 1000,
        sortOrder: 0,
        isDefault: true,
        imageSrc: "/products/lamis-air-fresheners.png",
        imageAlt: "معطر جو ليس برائحة غرناطة",
      },
      {
        domainId: "lamis-air-freshener-assortment--rose",
        labelAr: "حدائق الورود",
        attributes: { الرائحة: "حدائق الورود" },
        priceAgorot: 1000,
        sortOrder: 1,
        isDefault: false,
        imageSrc: "/products/lamis-air-fresheners.png",
        imageAlt: "معطر جو ليس برائحة حدائق الورود",
      },
      {
        domainId: "lamis-air-freshener-assortment--original",
        labelAr: "أوريجينال",
        attributes: { الرائحة: "أوريجينال" },
        priceAgorot: 1000,
        sortOrder: 2,
        isDefault: false,
        imageSrc: "/products/lamis-air-fresheners.png",
        imageAlt: "معطر جو ليس أوريجينال",
      },
      {
        domainId: "lamis-air-freshener-assortment--suede",
        labelAr: "اللمسة المنعشة",
        attributes: { الرائحة: "اللمسة المنعشة" },
        priceAgorot: 1000,
        sortOrder: 3,
        isDefault: false,
        imageSrc: "/products/lamis-air-fresheners.png",
        imageAlt: "معطر جو ليس اللمسة المنعشة",
      },
    ],
  },
  {
    domainId: "lilac-ultra-hand-soap",
    slug: "lilac-ultra-hand-soap",
    nameAr: "صابون سائل لليدين ليلك ألترا — 3×500 مل",
    latinName: "Lilac ULTRA",
    priceAgorot: 1000,
    sortOrder: 27,
    categoryId: "bathroom",
    imageSrc: "/products/lilac-ultra-hand-soap.png",
    imageAlt: "عرض صابون سائل لليدين ليلك ألترا ثلاث عبوات 500 مل",
    description:
      "صابون سائل عالي الجودة لغسل اليدين من ليلك ألترا (عرار) — عبوة ثلاثية بألوان وروائح مختلفة، كل عبوة 500 مل.",
    usageNotes: "للغسيل اليومي لليدين؛ رجّ العبوة قبل الاستخدام عند الحاجة.",
    unit: "3×500 مل",
  },
];

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("Skipping invoice catalog upsert: DATABASE_URL is not set.");
  process.exit(0);
}

if (!shouldRun(databaseUrl)) {
  console.log(
    "Skipping invoice catalog upsert outside Vercel/remote apply mode.",
  );
  process.exit(0);
}

const sessionUrl = toSessionPoolerUrl(databaseUrl);
const parsed = new URL(sessionUrl);
console.log(
  `Upserting invoice catalog on ${parsed.hostname}:${parsed.port || "(default)"}${parsed.pathname}`,
);

const sql = postgres(sessionUrl, { max: 1, prepare: false });

try {
  const [{ variantsTable }] = await sql<{ variantsTable: string | null }[]>`
    select to_regclass('public.product_variants') as "variantsTable"
  `;
  if (!variantsTable) {
    throw new Error(
      "product_variants table is missing; apply migrations before catalog upsert",
    );
  }

  for (const product of products) {
    await sql.begin(async (tx) => {
      const [row] = await tx<{ id: string }[]>`
      insert into products (
        domain_id, slug, name_ar, latin_name, price_agorot, sort_order,
        category_id, availability, image_kind, image_src, image_alt,
        image_width, image_height, placeholder_variant, description,
        usage_notes, unit, details_status, updated_at
      ) values (
        ${product.domainId}, ${product.slug}, ${product.nameAr},
        ${product.latinName}, ${product.priceAgorot}, ${product.sortOrder},
        ${product.categoryId}, 'available', 'image', ${product.imageSrc},
        ${product.imageAlt}, ${IMAGE_SIZE}, ${IMAGE_SIZE}, null,
        ${product.description}, ${product.usageNotes}, ${product.unit},
        'verified', now()
      )
      on conflict (domain_id) do update set
        slug = excluded.slug,
        name_ar = excluded.name_ar,
        latin_name = excluded.latin_name,
        price_agorot = excluded.price_agorot,
        sort_order = excluded.sort_order,
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

      const productId = row.id;
      const variants =
        product.variants ??
        ([
          {
            domainId: `${product.domainId}--default`,
            labelAr: product.unit?.trim() || "الافتراضي",
            attributes: product.unit?.trim()
              ? { الوحدة: product.unit.trim() }
              : {},
            priceAgorot: product.priceAgorot,
            sortOrder: 0,
            isDefault: true,
            imageSrc: product.imageSrc,
            imageAlt: product.imageAlt,
          },
        ] as NonNullable<CatalogProduct["variants"]>);

      for (const variant of variants) {
        await tx`
        insert into product_variants (
          product_id, domain_id, label_ar, attributes, price_agorot,
          availability, image_kind, image_src, image_alt, image_width,
          image_height, placeholder_variant, sort_order, is_default, updated_at
        ) values (
          ${productId}, ${variant.domainId}, ${variant.labelAr},
          ${tx.json(variant.attributes)}, ${variant.priceAgorot},
          'available', 'image', ${variant.imageSrc}, ${variant.imageAlt},
          ${IMAGE_SIZE}, ${IMAGE_SIZE}, null, ${variant.sortOrder},
          ${variant.isDefault}, now()
        )
        on conflict (domain_id) do update set
          product_id = excluded.product_id,
          label_ar = excluded.label_ar,
          attributes = excluded.attributes,
          price_agorot = excluded.price_agorot,
          availability = 'available',
          image_kind = 'image',
          image_src = excluded.image_src,
          image_alt = excluded.image_alt,
          image_width = excluded.image_width,
          image_height = excluded.image_height,
          placeholder_variant = null,
          sort_order = excluded.sort_order,
          is_default = excluded.is_default,
          updated_at = now()
      `;
      }
    });

    console.log(`upserted ${product.domainId} @ ${product.priceAgorot} agorot`);
  }
} finally {
  await sql.end({ timeout: 5 });
}

console.log(`Invoice catalog upsert complete (${products.length} products).`);
