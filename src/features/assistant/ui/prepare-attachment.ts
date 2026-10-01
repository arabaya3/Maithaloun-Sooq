"use client";

export const MAX_CLIENT_ATTACHMENT_BYTES = 3_500_000;
const STEPS = [
  { maxEdge: 2_000, quality: 0.85 },
  { maxEdge: 1_600, quality: 0.78 },
  { maxEdge: 1_200, quality: 0.7 },
] as const;

async function encode(file: File, maxEdge: number, quality: number) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality),
  );
  if (!blob) throw new Error("encode");
  return blob;
}

// Shrinks photos on the phone so one upload always fits under the platform's request limit.
export async function prepareAttachment(file: File): Promise<Blob> {
  if (file.type === "application/pdf") {
    if (file.size > MAX_CLIENT_ATTACHMENT_BYTES) throw new Error("too_large");
    return file;
  }
  if (!file.type.startsWith("image/")) throw new Error("unsupported");
  if (file.size <= 600_000 && file.type === "image/jpeg") return file;
  for (const step of STEPS) {
    const blob = await encode(file, step.maxEdge, step.quality);
    if (blob.size <= MAX_CLIENT_ATTACHMENT_BYTES) return blob;
  }
  throw new Error("too_large");
}
