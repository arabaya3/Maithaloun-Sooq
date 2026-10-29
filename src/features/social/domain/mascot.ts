/**
 * ميثو's pose library. Campaigns ask for a pose by id; only poses with approved artwork are ever
 * drawn, and small artwork is never enlarged past what it can carry. New artwork is added by
 * dropping a file in src/features/social/assets/mascot and moving its pose to «approved».
 */
export const mascotPoseIds = [
  "presenting",
  "wave",
  "wink",
  "delivery",
  "tip",
  "love",
  "shopping",
  "kitchen_cleaning",
  "laundry",
  "celebrating",
  "pointing",
  "reacting",
  "welcoming",
] as const;
export type MascotPose = (typeof mascotPoseIds)[number];

export type MascotPoseStatus =
  /** Full-size artwork: may be drawn large. */
  | "approved"
  /** Approved character, but the only artwork is a small crop: drawn small, never enlarged. */
  | "small_only"
  /** Artwork exists but must not be used until the owner reviews it. */
  | "blocked"
  /**
   * No artwork yet: a campaign planned with it uses the approved presenting pose when that fits,
   * and is flagged as needing artwork (MASCOT_ARTWORK_REQUIRED) when nothing approved fits.
   */
  | "artwork_required";

export interface MascotPoseInfo {
  labelAr: string;
  status: MascotPoseStatus;
  /** Height of the source artwork in pixels, when there is one. */
  sourceHeight: number | null;
  note: string | null;
}

export const mascotLibrary: Record<MascotPose, MascotPoseInfo> = {
  presenting: {
    labelAr: "ميثو يقدّم ويحمل كيس مايثا",
    status: "approved",
    sourceHeight: 635,
    note: "من لوحة الهوية المعتمدة، أكبر وضعية متوفرة",
  },
  wave: {
    labelAr: "ميثو يلوّح",
    status: "small_only",
    sourceHeight: 154,
    note: null,
  },
  wink: {
    labelAr: "ميثو يغمز",
    status: "small_only",
    sourceHeight: 152,
    note: null,
  },
  delivery: {
    labelAr: "ميثو يحمل صندوق التوصيل",
    status: "small_only",
    sourceHeight: 146,
    note: null,
  },
  tip: {
    labelAr: "ميثو ومعه فكرة (لمبة)",
    status: "small_only",
    sourceHeight: 151,
    note: null,
  },
  love: {
    labelAr: "ميثو يحضن قلباً",
    status: "small_only",
    sourceHeight: 150,
    note: null,
  },
  shopping: {
    labelAr: "ميثو مع عربة تسوق",
    status: "blocked",
    sourceHeight: 153,
    note: "محتويات العربة غير واضحة وقد تبدو مواد غذائية؛ تحتاج مراجعة المالك",
  },
  kitchen_cleaning: {
    labelAr: "ميثو ينظّف المطبخ",
    status: "artwork_required",
    sourceHeight: null,
    note: null,
  },
  laundry: {
    labelAr: "ميثو يغسل الملابس",
    status: "artwork_required",
    sourceHeight: null,
    note: null,
  },
  celebrating: {
    labelAr: "ميثو يحتفل",
    status: "artwork_required",
    sourceHeight: null,
    note: null,
  },
  pointing: {
    labelAr: "ميثو يشير",
    status: "artwork_required",
    sourceHeight: null,
    note: null,
  },
  reacting: {
    labelAr: "ميثو متفاجئ من مشكلة تنظيف",
    status: "artwork_required",
    sourceHeight: null,
    note: null,
  },
  welcoming: {
    labelAr: "ميثو يرحّب",
    status: "artwork_required",
    sourceHeight: null,
    note: null,
  },
};

/** Whether a pose may be drawn at all. */
export function poseIsUsable(pose: MascotPose | null): pose is MascotPose {
  return (
    pose !== null &&
    (mascotLibrary[pose].status === "approved" ||
      mascotLibrary[pose].status === "small_only")
  );
}

/** Largest on-image height a pose may take: small crops at most 1.6× their source, never enlarged further. */
export function maxPoseHeight(pose: MascotPose, wanted: number): number {
  const info = mascotLibrary[pose];
  // Approved art is drawn up to its own size, never enlarged past it.
  if (info.status === "approved") {
    return Math.min(wanted, info.sourceHeight ?? wanted);
  }
  return Math.min(wanted, Math.floor((info.sourceHeight ?? 0) * 1.6));
}
