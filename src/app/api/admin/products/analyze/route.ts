import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { authorizeAdminApi } from "@/features/admin/auth/authorize-admin-api";
import { PostgresRateLimiter } from "@/features/admin/auth/postgres-rate-limiter";
import {
  analyzeProductPhoto,
  cleanProductPhotoWithAi,
  normalizeProductPhoto,
  uploadProductPhoto,
} from "@/features/admin/product-capture/product-capture-service";
import { db } from "@/server/db/db";
import { getServerEnv } from "@/server/env/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const limiter = new PostgresRateLimiter(db);
const noStore = { "Cache-Control": "no-store, max-age=0" };

export async function POST(request: Request) {
  const actor = await authorizeAdminApi(request, true);
  if (!actor) {
    return NextResponse.json({ ok: false }, { status: 401, headers: noStore });
  }

  const keyHash = createHash("sha256")
    .update(`${actor.id}:${getServerEnv().ORDER_RATE_LIMIT_PEPPER}`)
    .digest("hex");
  const rate = await limiter.hit({
    scope: "admin_product_ai",
    keyHash,
    limit: 20,
    windowMs: 60 * 60 * 1_000,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      { ok: false, message: "تم استخدام التحليل عدة مرات. حاولي لاحقاً." },
      { status: 429, headers: noStore },
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get("photo");
    if (!(file instanceof File)) throw new Error("INVALID_IMAGE");
    const normalized = await normalizeProductPhoto(file);
    const [draft, cleaned] = await Promise.all([
      analyzeProductPhoto(normalized),
      formData.get("clean") === "true"
        ? cleanProductPhotoWithAi(normalized)
        : normalized,
    ]);
    const image = await uploadProductPhoto(cleaned);
    return NextResponse.json({ ok: true, draft, image }, { headers: noStore });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    const message =
      code === "AI_NOT_CONFIGURED"
        ? "ميزة الذكاء الاصطناعي غير مهيأة بعد."
        : code === "STORAGE_NOT_CONFIGURED"
          ? "تخزين الصور غير مهيأ بعد."
          : code === "INVALID_IMAGE"
            ? "اختاري صورة JPG أو PNG أو WebP بحجم أقل من 10MB."
            : "تعذّر تحليل الصورة الآن. حاولي بصورة أوضح.";
    return NextResponse.json(
      { ok: false, message },
      { status: 400, headers: noStore },
    );
  }
}
