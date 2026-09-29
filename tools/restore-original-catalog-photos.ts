/**
 * Restore original flyer WebP catalog photos (pre studio/AI/group work).
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

const IMAGE_WIDTH = 576;
const IMAGE_HEIGHT = 1024;

type PhotoRestore = {
  domainId: string;
  nameAr: string;
  latinName: string | null;
  description: string;
  imageSrc: string;
  imageAlt: string;
  defaultVariantDomainId: string;
  defaultLabelAr: string;
};

const restores: PhotoRestore[] = [
  {
    domainId: "degreaser-8",
    nameAr: "مزيل دهون وزيوت فينيسيا",
    latinName: "Venecia",
    description: "مزيل زيوت ودهون قوي وفعّال للمطابخ والأفران والأسطح.",
    imageSrc: "/products/venecia-degreaser.webp",
    imageAlt: "فينيسيا مزيل دهون وزيوت قوي وفعّال",
    defaultVariantDomainId: "degreaser-8--default",
    defaultLabelAr: "750 مل",
  },
  {
    domainId: "degreaser-10",
    nameAr: "منظف أفران عرار",
    latinName: "Arar",
    description:
      "مزيل قوي للدهون بتركيز مضاعف، يزيل الدهون العنيدة ويمنح لمعاناً ونظافة فائقة.",
    imageSrc: "/products/arar-oven-cleaner.webp",
    imageAlt: "عرار منظف أفران ومزيل دهون قوي",
    defaultVariantDomainId: "degreaser-10--default",
    defaultLabelAr: "750 مل",
  },
  {
    domainId: "arar-dish-liquid",
    nameAr: "سائل جلي عرار",
    latinName: "Arar",
    description: "سائل جلي بالليمون بقوة مضاعفة لإزالة الدهون.",
    imageSrc: "/products/arar-dish.webp",
    imageAlt: "سائل جلي عرار بالليمون قوة مضاعفة",
    defaultVariantDomainId: "arar-dish-liquid--default",
    defaultLabelAr: "4 لتر",
  },
  {
    domainId: "general-cleaner",
    nameAr: "منظف عام هوم سيكرت",
    latinName: "Home Secret",
    description: "منظف عام للمطابخ والحمامات والأسطح المختلفة.",
    imageSrc: "/products/home-secret.webp",
    imageAlt: "هوم سيكرت منظف عام للمطابخ والحمامات والأسطح",
    defaultVariantDomainId: "general-cleaner--default",
    defaultLabelAr: "750 مل",
  },
  {
    domainId: "smart-floor-cleaner",
    nameAr: "منظف أرضيات سمارت",
    latinName: "Smart",
    description: "منظف أرضيات يلمع وينظف ويعطّر، متوفر بخمس روائح مختلفة.",
    imageSrc: "/products/smart-floor.webp",
    imageAlt: "منظف أرضيات سمارت بخمس روائح مختلفة",
    defaultVariantDomainId: "smart-floor-cleaner--default",
    defaultLabelAr: "روائح متعددة",
  },
  {
    domainId: "musk-floor-cleaner",
    nameAr: "معطر ومنظف أرضيات مسك",
    latinName: "MISK",
    description: "معطر ومنظف للأرضيات برائحة الورد، للمسح والتعطير.",
    imageSrc: "/products/misk-floor.webp",
    imageAlt: "مسك معطر ومنظف أرضيات برائحة الورد",
    defaultVariantDomainId: "musk-floor-cleaner--default",
    defaultLabelAr: "Pink Rose",
  },
  {
    domainId: "lilac-floor-cleaner",
    nameAr: "منظف ومعطر أرضيات ليلك",
    latinName: "Laylak",
    description: "منظف ومعطر البلاط المركز: ينظف، يعطّر، يلمع، ويعقّم.",
    imageSrc: "/products/laylak-floor.webp",
    imageAlt: "ليلك منظف ومعطر الأرضيات ٤ في ١",
    defaultVariantDomainId: "lilac-floor-cleaner--default",
    defaultLabelAr: "مركز",
  },
  {
    domainId: "lilac-air-freshener",
    nameAr: "معطر ليلاك",
    latinName: "Lilac",
    description: "معطر للجو والملابس والأثاث برائحتين منعشتين.",
    imageSrc: "/products/lilac-freshener.webp",
    imageAlt: "معطر ليلاك للجو والملابس والأثاث",
    defaultVariantDomainId: "lilac-air-freshener--default",
    defaultLabelAr: "رائحتان",
  },
  {
    domainId: "lamis-air-freshener",
    nameAr: "معطر لمياس",
    latinName: "Lamis",
    description:
      "معطر للأقمشة والهواء بثلاث روائح منعشة: سويت لافندر، أوريجينال، والمسك المخملي.",
    imageSrc: "/products/lamis-freshener.webp",
    imageAlt: "معطر لمياس للأقمشة والهواء بثلاث روائح",
    defaultVariantDomainId: "lamis-air-freshener--default",
    defaultLabelAr: "3 روائح",
  },
  {
    domainId: "salima-tissues",
    nameAr: "محارم سليمة",
    latinName: "Salima",
    description: "محارم ورقية ناعمة.",
    imageSrc: "/products/tissues-salima-nadren.webp",
    imageAlt: "محارم سليمة ورقية ناعمة",
    defaultVariantDomainId: "salima-tissues--default",
    defaultLabelAr: "عبوة",
  },
  {
    domainId: "nadren-tissues",
    nameAr: "محارم نادرين",
    latinName: "Nadren",
    description: "محارم ورقية بنفس الوزن.",
    imageSrc: "/products/tissues-salima-nadren.webp",
    imageAlt: "محارم نادرين ورقية",
    defaultVariantDomainId: "nadren-tissues--default",
    defaultLabelAr: "عبوة",
  },
  {
    domainId: "dolphin-bleach",
    nameAr: "كلور دولفين",
    latinName: "Dolphin",
    description:
      "محلول هيبوكلوريت الصوديوم للاستخدام المنزلي: يبيّض ويزيل البقع، ينظف ويعقّم.",
    imageSrc: "/products/dolphin-bleach.webp",
    imageAlt: "كلور دولفين للتبييض والتنظيف ٤ لتر",
    defaultVariantDomainId: "dolphin-bleach--default",
    defaultLabelAr: "4 لتر",
  },
  {
    domainId: "carpet-brush",
    nameAr: "فرشاة تنظيف السجاد",
    latinName: null,
    description: "فرشاة لتنظيف السجاد بعدة ألوان.",
    imageSrc: "/products/carpet-brush.webp",
    imageAlt: "فرشاة تنظيف السجاد بعدة ألوان",
    defaultVariantDomainId: "carpet-brush--default",
    defaultLabelAr: "متعدد الألوان",
  },
];

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("Skipping original photo restore: DATABASE_URL is not set.");
  process.exit(0);
}

if (!shouldRun(databaseUrl)) {
  console.log(
    "Skipping original photo restore outside Vercel/remote apply mode.",
  );
  process.exit(0);
}

const sessionUrl = toSessionPoolerUrl(databaseUrl);
const parsed = new URL(sessionUrl);
console.log(
  `Restoring original flyer photos on ${parsed.hostname}:${parsed.port || "(default)"}${parsed.pathname}`,
);

const sql = postgres(sessionUrl, { max: 1, prepare: false });

try {
  for (const item of restores) {
    const [product] = await sql<{ id: string; price_agorot: number }[]>`
      update products
      set
        name_ar = ${item.nameAr},
        latin_name = ${item.latinName},
        description = ${item.description},
        image_kind = 'image',
        image_src = ${item.imageSrc},
        image_alt = ${item.imageAlt},
        image_width = ${IMAGE_WIDTH},
        image_height = ${IMAGE_HEIGHT},
        placeholder_variant = null,
        details_status = 'verified',
        updated_at = now()
      where domain_id = ${item.domainId}
      returning id, price_agorot
    `;

    if (!product) {
      console.log(`skip missing ${item.domainId}`);
      continue;
    }

    await sql`delete from product_variants where product_id = ${product.id}`;

    await sql`
      insert into product_variants (
        product_id, domain_id, label_ar, attributes, price_agorot,
        availability, image_kind, image_src, image_alt, image_width,
        image_height, placeholder_variant, sort_order, is_default, updated_at
      ) values (
        ${product.id}, ${item.defaultVariantDomainId}, ${item.defaultLabelAr},
        ${sql.json({})}, ${product.price_agorot},
        'available', 'image', ${item.imageSrc}, ${item.imageAlt},
        ${IMAGE_WIDTH}, ${IMAGE_HEIGHT}, null, 0, true, now()
      )
    `;

    console.log(`restored ${item.domainId} → ${item.imageSrc}`);
  }

  await sql`
    update products
    set availability = 'unavailable', updated_at = now()
    where domain_id = 'loyal-fabric-softener'
  `;

  await sql`
    update products
    set availability = 'available', updated_at = now()
    where domain_id = 'lamis-air-freshener-assortment'
  `;

  console.log(
    "hid loyal-fabric-softener; restored lamis assortment availability",
  );
} finally {
  await sql.end({ timeout: 5 });
}

console.log(
  `Original flyer photo restore complete (${restores.length} products).`,
);
