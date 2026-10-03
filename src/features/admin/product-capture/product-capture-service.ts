import "server-only";

import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { z } from "zod";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const productDraftSchema = z.object({
  nameAr: z.string().trim().min(1).max(160),
  latinName: z.string().trim().max(120),
  description: z.string().trim().max(600),
  unit: z.string().trim().max(80),
  categoryId: z.string().max(40),
  brand: z.string().trim().max(80),
  sizeValue: z.string().trim().max(40),
  sizeUnit: z.string().trim().max(30),
  barcode: z.string().trim().max(64),
  confidence: z.number().min(0).max(1),
});

export type ProductCaptureDraft = z.infer<typeof productDraftSchema>;

function productSchema(categoryCodes: readonly string[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "nameAr",
      "latinName",
      "description",
      "unit",
      "categoryId",
      "brand",
      "sizeValue",
      "sizeUnit",
      "barcode",
      "confidence",
    ],
    properties: {
      nameAr: { type: "string" },
      latinName: { type: "string" },
      description: { type: "string" },
      unit: { type: "string" },
      categoryId: {
        type: "string",
        enum: [...categoryCodes],
      },
      brand: { type: "string" },
      sizeValue: { type: "string" },
      sizeUnit: { type: "string" },
      barcode: { type: "string" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
  } as const;
}

function extractResponseText(response: unknown): string {
  const parsed = z
    .object({
      output: z.array(
        z.object({
          type: z.string(),
          content: z
            .array(z.object({ type: z.string(), text: z.string().optional() }))
            .optional(),
        }),
      ),
    })
    .safeParse(response);
  if (!parsed.success) throw new Error("AI_RESPONSE_INVALID");
  for (const item of parsed.data.output) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  throw new Error("AI_RESPONSE_EMPTY");
}

export async function normalizeProductPhoto(file: File): Promise<Buffer> {
  if (!ACCEPTED_IMAGE_TYPES.has(file.type) || file.size > MAX_IMAGE_BYTES) {
    throw new Error("INVALID_IMAGE");
  }
  const input = Buffer.from(await file.arrayBuffer());
  const metadata = await sharp(input).metadata();
  if (
    !metadata.width ||
    !metadata.height ||
    metadata.width * metadata.height > 40_000_000
  ) {
    throw new Error("INVALID_IMAGE");
  }
  return sharp(input)
    .rotate()
    .resize(1_600, 1_600, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .sharpen({ sigma: 0.8 })
    .webp({ quality: 88, effort: 5 })
    .toBuffer();
}

export async function analyzeProductPhoto(
  image: Buffer,
  categories: ReadonlyArray<{ code: string; nameAr: string }>,
): Promise<ProductCaptureDraft> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("AI_NOT_CONFIGURED");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_VISION_MODEL ?? "gpt-4.1-mini",
      store: false,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `اقرأ عبوة منتج تنظيف من صورة حقيقية. اقترح بيانات عربية قصيرة ومحايدة دون اختراع مكونات أو ادعاءات. استخدم categoryId من: ${categories
                .map((category) => `${category.code}=${category.nameAr}`)
                .join(
                  ", ",
                )}. إذا لم يظهر حقل بوضوح أعد نصاً فارغاً وخفّض confidence.`,
            },
            {
              type: "input_image",
              image_url: `data:image/webp;base64,${image.toString("base64")}`,
              detail: "high",
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "cleaning_product_draft",
          strict: true,
          schema: productSchema(categories.map((category) => category.code)),
        },
      },
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error("AI_REQUEST_FAILED");
  return productDraftSchema.parse(
    JSON.parse(extractResponseText(await response.json())),
  );
}

export async function cleanProductPhotoWithAi(image: Buffer): Promise<Buffer> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return image;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_VISION_MODEL ?? "gpt-4.1-mini",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Edit this product photo into a centered ecommerce cutout on a transparent background. Preserve the exact package, logo, colors, proportions, and all visible text. Do not redesign or invent anything.",
            },
            {
              type: "input_image",
              image_url: `data:image/webp;base64,${image.toString("base64")}`,
            },
          ],
        },
      ],
      tools: [
        {
          type: "image_generation",
          model: process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1-mini",
          action: "edit",
          background: "transparent",
          size: "1024x1024",
          quality: "medium",
          output_format: "webp",
        },
      ],
      tool_choice: { type: "image_generation" },
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) return image;
  const body = (await response.json()) as {
    output?: Array<{ type?: string; result?: string }>;
  };
  const result = body.output?.find(
    (item) => item.type === "image_generation_call",
  )?.result;
  if (!result) return image;
  return sharp(Buffer.from(result, "base64"))
    .resize(1_200, 1_200, { fit: "contain" })
    .webp({ quality: 90 })
    .toBuffer();
}

export async function uploadProductPhoto(image: Buffer): Promise<{
  src: string;
  width: number;
  height: number;
}> {
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new Error("STORAGE_NOT_CONFIGURED");
  const client = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const bucket = "product-images";
  const bucketResult = await client.storage.getBucket(bucket);
  if (bucketResult.error) {
    const created = await client.storage.createBucket(bucket, {
      public: true,
      allowedMimeTypes: ["image/webp"],
      fileSizeLimit: "5MB",
    });
    if (created.error) throw new Error("STORAGE_BUCKET_FAILED");
  }
  const path = `products/${randomUUID()}.webp`;
  const upload = await client.storage.from(bucket).upload(path, image, {
    contentType: "image/webp",
    cacheControl: "31536000",
    upsert: false,
  });
  if (upload.error) throw new Error("STORAGE_UPLOAD_FAILED");
  const metadata = await sharp(image).metadata();
  const publicUrl = client.storage.from(bucket).getPublicUrl(path)
    .data.publicUrl;
  return {
    src: publicUrl,
    width: metadata.width ?? 1_024,
    height: metadata.height ?? 1_024,
  };
}

const PUBLIC_PRODUCT_PATH =
  /\/storage\/v1\/object\/public\/product-images\/(products\/[0-9a-f-]{36}\.webp)$/;

// Only files this store created can be removed; any other URL is ignored.
export async function removeProductPhoto(src: string): Promise<boolean> {
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) return false;
  let path: string | undefined;
  try {
    const parsed = new URL(src);
    if (parsed.origin !== new URL(url).origin) return false;
    path = PUBLIC_PRODUCT_PATH.exec(parsed.pathname)?.[1];
  } catch {
    return false;
  }
  if (!path) return false;
  const client = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const removed = await client.storage.from("product-images").remove([path]);
  return !removed.error;
}
