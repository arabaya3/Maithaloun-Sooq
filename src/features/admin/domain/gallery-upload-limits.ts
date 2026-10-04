// Shared by the browser pre-check and the upload route so both refuse the same files.
export const MAX_GALLERY_UPLOAD_BYTES = 8 * 1024 * 1024;
export const GALLERY_UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp"];

export const galleryUploadMessages = {
  too_large: "الصورة أكبر من 8 ميغابايت.",
  unsupported: "الملف ليس صورة JPEG أو PNG أو WebP صالحة.",
  too_many_pixels: "أبعاد الصورة كبيرة جداً.",
  failed: "تعذّر رفع الصور. حاول مرة أخرى.",
} as const;

export function galleryFileProblem(file: {
  size: number;
  type: string;
}): string | null {
  if (file.size > MAX_GALLERY_UPLOAD_BYTES)
    return galleryUploadMessages.too_large;
  if (file.type && !GALLERY_UPLOAD_TYPES.includes(file.type)) {
    return galleryUploadMessages.unsupported;
  }
  return null;
}
