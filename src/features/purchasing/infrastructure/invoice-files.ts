import "server-only";

import sharp, { type Metadata } from "sharp";

export const MAX_INVOICE_PAGES = 6;
export const MAX_INVOICE_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_INVOICE_PDF_BYTES = 8 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
const ACCEPTED_FORMATS = new Set(["jpeg", "png", "webp"]);

export type InvoiceFileErrorCode =
  "unsupported_file" | "file_too_large" | "too_many_files" | "no_files";

export class InvoiceFileError extends Error {
  constructor(readonly code: InvoiceFileErrorCode) {
    super(code);
    this.name = "InvoiceFileError";
  }
}

export interface PreparedInvoiceFile {
  kind: "invoice_image" | "invoice_pdf";
  bytes: Buffer;
  mimeType: "image/jpeg" | "application/pdf";
  extension: "jpg" | "pdf";
  originalName: string;
}

function isPdf(bytes: Buffer): boolean {
  return bytes.subarray(0, 5).toString("latin1") === "%PDF-";
}

// The type comes from the bytes. Images are re-encoded, which drops EXIF and location metadata.
export async function prepareInvoiceFile(
  bytes: Buffer,
  originalName: string,
): Promise<PreparedInvoiceFile> {
  if (isPdf(bytes)) {
    if (bytes.byteLength > MAX_INVOICE_PDF_BYTES) {
      throw new InvoiceFileError("file_too_large");
    }
    return {
      kind: "invoice_pdf",
      bytes,
      mimeType: "application/pdf",
      extension: "pdf",
      originalName,
    };
  }
  if (bytes.byteLength > MAX_INVOICE_IMAGE_BYTES) {
    throw new InvoiceFileError("file_too_large");
  }
  let metadata: Metadata;
  try {
    metadata = await sharp(bytes).metadata();
  } catch {
    throw new InvoiceFileError("unsupported_file");
  }
  if (
    !metadata.format ||
    !ACCEPTED_FORMATS.has(metadata.format) ||
    !metadata.width ||
    !metadata.height ||
    metadata.width * metadata.height > MAX_PIXELS
  ) {
    throw new InvoiceFileError("unsupported_file");
  }
  const normalized = await sharp(bytes)
    .rotate()
    .resize(2_200, 2_200, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 86 })
    .toBuffer();
  return {
    kind: "invoice_image",
    bytes: normalized,
    mimeType: "image/jpeg",
    extension: "jpg",
    originalName,
  };
}

export async function prepareInvoiceFiles(
  files: ReadonlyArray<{ bytes: Buffer; name: string }>,
): Promise<PreparedInvoiceFile[]> {
  if (!files.length) throw new InvoiceFileError("no_files");
  if (files.length > MAX_INVOICE_PAGES) {
    throw new InvoiceFileError("too_many_files");
  }
  const prepared = await Promise.all(
    files.map((file) => prepareInvoiceFile(file.bytes, file.name)),
  );
  const pdfCount = prepared.filter(
    (file) => file.kind === "invoice_pdf",
  ).length;
  if (pdfCount > 1 || (pdfCount === 1 && prepared.length > 1)) {
    throw new InvoiceFileError("too_many_files");
  }
  return prepared;
}
