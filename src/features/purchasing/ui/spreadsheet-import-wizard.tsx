"use client";

import { Download, FileSpreadsheet, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";

import { createSpreadsheetJobAction } from "@/features/inventory/application/inventory-actions";
import type { SpreadsheetSheetSummary } from "@/features/purchasing/application/extraction-service";
import {
  importFieldLabels,
  importFields,
  type ColumnMapping,
  type ImportField,
} from "@/features/purchasing/domain/spreadsheet";

interface Upload {
  documentId: string;
  sheets: SpreadsheetSheetSummary[];
}

const requiredHint: Partial<Record<ImportField, string>> = {
  name: "مطلوب (أو الباركود)",
  quantity: "مطلوب",
  unitCost: "مطلوب (أو إجمالي السطر)",
};

function columnLetter(index: number): string {
  let value = index + 1;
  let letters = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    value = Math.floor((value - 1) / 26);
  }
  return letters;
}

function uploadFile(
  file: File,
  onProgress: (percent: number) => void,
): Promise<{ ok: true; upload: Upload } | { ok: false; message: string }> {
  return new Promise((resolve) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/admin/api/imports");
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });
    const fail = (message: string) => resolve({ ok: false, message });
    request.addEventListener("error", () =>
      fail("انقطع الاتصال أثناء الرفع. تحققي من الإنترنت وأعيدي المحاولة."),
    );
    request.addEventListener("load", () => {
      try {
        const body = JSON.parse(request.responseText) as
          ({ ok: true } & Upload) | { ok: false; message?: string };
        if (body.ok) {
          resolve({
            ok: true,
            upload: { documentId: body.documentId, sheets: body.sheets },
          });
        } else {
          fail(body.message ?? "تعذّر رفع الملف.");
        }
      } catch {
        fail("انتهت الجلسة أو تعذّر رفع الملف. حدّثي الصفحة وحاولي مجدداً.");
      }
    });
    const body = new FormData();
    body.set("file", file);
    request.send(body);
  });
}

export function SpreadsheetImportWizard() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [upload, setUpload] = useState<Upload | null>(null);
  const [sheetName, setSheetName] = useState("");
  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const sheet = upload?.sheets.find((item) => item.name === sheetName) ?? null;
  const headerCells = useMemo(
    () => sheet?.preview[headerRow] ?? [],
    [sheet, headerRow],
  );
  const sampleRow = sheet?.preview[headerRow + 1] ?? [];

  function selectSheet(next: SpreadsheetSheetSummary) {
    setSheetName(next.name);
    setHeaderRow(next.headerRow);
    setMapping(next.mapping);
  }

  async function send(selected: File) {
    setError(null);
    setProgress(0);
    const result = await uploadFile(selected, setProgress);
    setProgress(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setUpload(result.upload);
    setIdempotencyKey(crypto.randomUUID());
    const first = result.upload.sheets[0];
    if (first) selectSheet(first);
  }

  function restart() {
    setUpload(null);
    setFile(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function analyze() {
    if (!upload || !sheet || !idempotencyKey) return;
    const hasProduct =
      mapping.name !== undefined ||
      mapping.barcode !== undefined ||
      mapping.sku !== undefined;
    const hasCost =
      mapping.unitCost !== undefined || mapping.totalCost !== undefined;
    if (!hasProduct || mapping.quantity === undefined || !hasCost) {
      setError("حدّدي أعمدة المنتج والكمية والسعر على الأقل.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const response = await createSpreadsheetJobAction({
        documentId: upload.documentId,
        sheetName: sheet.name,
        headerRow,
        mapping,
        idempotencyKey,
      });
      if (!response.ok) {
        setError(response.message);
        return;
      }
      router.push(`/admin/inventory/review/${response.jobId}`);
    });
  }

  if (!upload || !sheet) {
    return (
      <section className="admin-panel" aria-labelledby="upload-title">
        <p className="admin-steps">
          <span aria-current="step">1. رفع الملف</span>
          <span>2. مطابقة الأعمدة</span>
          <span>3. المراجعة والتأكيد</span>
        </p>
        <h2 id="upload-title">ارفعي ملف فاتورة الشراء</h2>
        <div className="admin-upload-zone">
          <FileSpreadsheet size={36} aria-hidden="true" />
          <label
            htmlFor="spreadsheet-file"
            className="admin-btn admin-btn-primary"
          >
            اختيار ملف Excel أو CSV
          </label>
          <input
            ref={inputRef}
            id="spreadsheet-file"
            className="sr-only"
            type="file"
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            onChange={(event) => {
              const selected = event.target.files?.[0] ?? null;
              setFile(selected);
              if (selected) void send(selected);
            }}
          />
          <p className="admin-muted">
            xlsx أو csv حتى 5MB و1000 صف. لن يتغيّر المخزون قبل التأكيد.
          </p>
          {file ? (
            <p className="admin-muted">
              <bdi>{file.name}</bdi>
            </p>
          ) : null}
          {progress !== null ? (
            <>
              <progress
                className="admin-progress"
                max={100}
                value={progress}
                aria-label="تقدّم رفع الملف"
              />
              <p role="status">
                جارٍ الرفع… <bdi dir="ltr">{progress}%</bdi>
              </p>
            </>
          ) : null}
        </div>
        {error ? (
          <>
            <p className="admin-form-error" role="alert">
              {error}
            </p>
            {file ? (
              <button
                type="button"
                className="admin-btn admin-btn-secondary"
                onClick={() => void send(file)}
              >
                <RotateCcw size={18} aria-hidden="true" />
                إعادة المحاولة
              </button>
            ) : null}
          </>
        ) : null}
        <a
          className="admin-btn admin-btn-ghost"
          href="/admin/api/imports/template"
          download
        >
          <Download size={18} aria-hidden="true" />
          تنزيل قالب Excel جاهز
        </a>
      </section>
    );
  }

  // Detected columns stay visible; the rest are tucked away so the screen stays short.
  const primaryFields = importFields.filter(
    (field) => field in requiredHint || sheet.mapping[field] !== undefined,
  );
  const extraFields = importFields.filter(
    (field) => !primaryFields.includes(field),
  );
  const renderField = (field: ImportField) => (
    <li key={field}>
      <label>
        <span>
          {importFieldLabels[field]}{" "}
          {requiredHint[field] ? <small>{requiredHint[field]}</small> : null}
        </span>
        <select
          aria-label={importFieldLabels[field]}
          value={mapping[field] ?? ""}
          onChange={(event) =>
            setMapping((current) => ({
              ...current,
              [field]:
                event.target.value === ""
                  ? undefined
                  : Number(event.target.value),
            }))
          }
        >
          <option value="">غير موجود في الملف</option>
          {headerCells.map((header, index) => (
            <option key={index} value={index}>
              {`${columnLetter(index)}: ${header || "بدون عنوان"}${sampleRow[index] ? ` (مثال: ${sampleRow[index]})` : ""}`}
            </option>
          ))}
        </select>
      </label>
    </li>
  );

  return (
    <section className="admin-panel" aria-labelledby="mapping-title">
      <p className="admin-steps">
        <span>1. رفع الملف</span>
        <span aria-current="step">2. مطابقة الأعمدة</span>
        <span>3. المراجعة والتأكيد</span>
      </p>
      <h2 id="mapping-title">طابقي أعمدة الملف</h2>
      <div className="admin-form">
        {upload.sheets.length > 1 ? (
          <label>
            ورقة العمل
            <select
              aria-label="ورقة العمل"
              value={sheetName}
              onChange={(event) => {
                const next = upload.sheets.find(
                  (item) => item.name === event.target.value,
                );
                if (next) selectSheet(next);
              }}
            >
              {upload.sheets.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          صف العناوين
          <select
            aria-label="صف العناوين"
            value={headerRow}
            onChange={(event) => setHeaderRow(Number(event.target.value))}
          >
            {sheet.preview.slice(0, 10).map((row, index) => (
              <option key={index} value={index}>
                {`الصف ${index + 1}: ${row.filter(Boolean).slice(0, 4).join("، ") || "فارغ"}`}
              </option>
            ))}
          </select>
        </label>

        <ul className="admin-mapping-list">{primaryFields.map(renderField)}</ul>
        {extraFields.length ? (
          <details className="admin-disclosure">
            <summary>أعمدة إضافية (اختياري)</summary>
            <ul className="admin-mapping-list">
              {extraFields.map(renderField)}
            </ul>
          </details>
        ) : null}

        <p className="admin-muted">
          عدد الصفوف في الورقة: <bdi dir="ltr">{sheet.rowCount}</bdi>
        </p>
        {error ? (
          <p className="admin-form-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="admin-form-actions">
          <button
            type="button"
            className="admin-btn admin-btn-primary"
            disabled={pending}
            onClick={analyze}
          >
            {pending ? "جارٍ تحليل الملف…" : "تحليل الملف ومطابقة المنتجات"}
          </button>
          <button
            type="button"
            className="admin-btn admin-btn-secondary"
            disabled={pending}
            onClick={restart}
          >
            ملف آخر
          </button>
        </div>
      </div>
    </section>
  );
}
