/**
 * Point original catalog products at real packaging photos (not redesigned AI art).
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

const IMAGE_SIZE = 1600;

const photoUpdates: Array<{
  domainId: string;
  imageSrc: string;
  imageAlt: string;
}> = [
  {
    domainId: "degreaser-8",
    imageSrc: "/products/venecia-degreaser-real.png",
    imageAlt: "مزيل دهون فينيسيا",
  },
  {
    domainId: "degreaser-10",
    imageSrc: "/products/arar-oven-cleaner-real.png",
    imageAlt: "منظف أفران عرار",
  },
  {
    domainId: "arar-dish-liquid",
    imageSrc: "/products/arar-dish-real.png",
    imageAlt: "سائل جلي عرار 4 لتر",
  },
  {
    domainId: "general-cleaner",
    imageSrc: "/products/home-secret-real.png",
    imageAlt: "منظف عام هوم سيكرت",
  },
  {
    domainId: "smart-floor-cleaner",
    imageSrc: "/products/smart-floor-real.png",
    imageAlt: "منظف أرضيات سمارت",
  },
  {
    domainId: "musk-floor-cleaner",
    imageSrc: "/products/misk-floor-real.png",
    imageAlt: "معطر ومنظف أرضيات مسك",
  },
  {
    domainId: "lilac-floor-cleaner",
    imageSrc: "/products/laylak-floor-real.png",
    imageAlt: "منظف ومعطر أرضيات ليلك",
  },
  {
    domainId: "lilac-air-freshener",
    imageSrc: "/products/lilac-freshener-real.png",
    imageAlt: "منعم ومعطر ملابس لويال Soft Pink",
  },
  {
    domainId: "lamis-air-freshener",
    imageSrc: "/products/lamis-freshener-real.png",
    imageAlt: "معطر لمياس Velvet Musk",
  },
  {
    domainId: "nadren-tissues",
    imageSrc: "/products/nadren-tissues-real.png",
    imageAlt: "محارم نادرين",
  },
  {
    domainId: "dolphin-bleach",
    imageSrc: "/products/dolphin-bleach-real.png",
    imageAlt: "كلور دولفين 4 لتر",
  },
  {
    domainId: "carpet-brush",
    imageSrc: "/products/carpet-brush-real.png",
    imageAlt: "فرشاة تنظيف السجاد",
  },
];

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("Skipping catalog photo refresh: DATABASE_URL is not set.");
  process.exit(0);
}

if (!shouldRun(databaseUrl)) {
  console.log(
    "Skipping catalog photo refresh outside Vercel/remote apply mode.",
  );
  process.exit(0);
}

const sessionUrl = toSessionPoolerUrl(databaseUrl);
const parsed = new URL(sessionUrl);
console.log(
  `Refreshing catalog photos on ${parsed.hostname}:${parsed.port || "(default)"}${parsed.pathname}`,
);

const sql = postgres(sessionUrl, { max: 1, prepare: false });

try {
  for (const photo of photoUpdates) {
    const updated = await sql`
      update products
      set
        image_kind = 'image',
        image_src = ${photo.imageSrc},
        image_alt = ${photo.imageAlt},
        image_width = ${IMAGE_SIZE},
        image_height = ${IMAGE_SIZE},
        placeholder_variant = null,
        updated_at = now()
      where domain_id = ${photo.domainId}
      returning domain_id
    `;

    if (updated.length === 0) {
      console.log(`skip missing product ${photo.domainId}`);
      continue;
    }

    await sql`
      update product_variants
      set
        image_kind = 'image',
        image_src = ${photo.imageSrc},
        image_alt = ${photo.imageAlt},
        image_width = ${IMAGE_SIZE},
        image_height = ${IMAGE_SIZE},
        placeholder_variant = null,
        updated_at = now()
      where product_id = (
        select id from products where domain_id = ${photo.domainId} limit 1
      )
        and is_default = true
    `;

    console.log(`refreshed photo ${photo.domainId} → ${photo.imageSrc}`);
  }
} finally {
  await sql.end({ timeout: 5 });
}

console.log(`Catalog photo refresh complete (${photoUpdates.length} targets).`);
