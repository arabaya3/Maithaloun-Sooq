import { FileText } from "lucide-react";

import type { DocumentKind } from "@/features/purchasing/domain/purchase-constants";

// Originals stay private: each src goes through the authorized document route.
export function InvoiceDocuments({
  documents,
}: {
  documents: ReadonlyArray<{ id: string; kind: DocumentKind; pageNo: number }>;
}) {
  const images = documents.filter((item) => item.kind === "invoice_image");
  const files = documents.filter((item) => item.kind !== "invoice_image");
  if (!documents.length) return null;

  return (
    <section className="admin-panel" aria-labelledby="original-title">
      <h2 id="original-title">الأصل المرفوع</h2>
      {images.length ? (
        <ul className="admin-invoice-pages">
          {images.map((image) => (
            <li key={image.id}>
              <a
                href={`/admin/api/documents/${image.id}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- private, short-lived URL that must not pass through the image optimizer cache */}
                <img
                  src={`/admin/api/documents/${image.id}`}
                  alt={`صفحة الفاتورة ${image.pageNo}`}
                  loading="lazy"
                />
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {files.map((file) => (
        <a
          key={file.id}
          className="admin-btn admin-btn-secondary"
          href={`/admin/api/documents/${file.id}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <FileText size={18} aria-hidden="true" />
          {file.kind === "spreadsheet" ? "تنزيل الملف الأصلي" : "فتح ملف PDF"}
        </a>
      ))}
    </section>
  );
}
