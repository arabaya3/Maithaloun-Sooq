import { parseQuantityToMilli } from "@/features/inventory/domain/quantity";
import type { StockUnit } from "@/features/inventory/domain/stock-constants";
import { toLatinDigits } from "@/shared/lib/digits";
import { lineTotalAgorot, unitAmountAgorot } from "@/shared/lib/money-math";
import { normalizeArabicText } from "@/shared/lib/normalize-arabic";

import type { PurchasePaymentStatus } from "./purchase-constants";

export const MAX_SPREADSHEET_BYTES = 5 * 1024 * 1024;
export const MAX_SPREADSHEET_ROWS = 1_000;
export const MAX_SPREADSHEET_COLUMNS = 40;
export const MAX_SPREADSHEET_SHEETS = 20;
export const MAX_CELL_LENGTH = 300;

export type SpreadsheetKind = "xlsx" | "csv";
export type SpreadsheetRejection =
  | "too_large"
  | "empty"
  | "macros"
  | "legacy_xls"
  | "unsupported"
  | "too_many_rows"
  | "unreadable";

export class SpreadsheetError extends Error {
  constructor(readonly code: SpreadsheetRejection) {
    super(code);
    this.name = "SpreadsheetError";
  }
}

export interface SheetData {
  name: string;
  rows: string[][];
}

export const importFields = [
  "name",
  "barcode",
  "sku",
  "size",
  "unit",
  "quantity",
  "unitCost",
  "totalCost",
  "supplier",
  "invoiceNumber",
  "invoiceDate",
  "paymentStatus",
] as const;
export type ImportField = (typeof importFields)[number];
export type ColumnMapping = Partial<Record<ImportField, number>>;

export const importFieldLabels: Record<ImportField, string> = {
  name: "اسم المنتج",
  barcode: "الباركود",
  sku: "رمز الصنف",
  size: "الحجم",
  unit: "الوحدة",
  quantity: "الكمية",
  unitCost: "سعر الوحدة",
  totalCost: "إجمالي السطر",
  supplier: "المورد",
  invoiceNumber: "رقم الفاتورة",
  invoiceDate: "تاريخ الفاتورة",
  paymentStatus: "حالة الدفع",
};

const headerSynonyms: Record<ImportField, string[]> = {
  name: [
    "اسم المنتج",
    "اسم الصنف",
    "المنتج",
    "الصنف",
    "البيان",
    "product name",
    "product",
    "item",
    "name",
    "description",
  ],
  barcode: ["الباركود", "باركود", "barcode", "ean"],
  sku: ["رمز الصنف", "رمز المنتج", "الرمز", "كود", "sku", "code"],
  size: ["الحجم", "المقاس", "الوزن", "size"],
  unit: ["الوحدة", "وحدة", "unit"],
  quantity: ["الكمية", "كمية", "العدد", "quantity", "qty"],
  unitCost: [
    "سعر الوحدة",
    "سعر الشراء",
    "تكلفة الوحدة",
    "التكلفة",
    "السعر",
    "unit cost",
    "unit price",
    "cost",
    "price",
  ],
  totalCost: [
    "إجمالي السطر",
    "الإجمالي",
    "المجموع",
    "total cost",
    "line total",
    "total",
  ],
  supplier: ["المورد", "اسم المورد", "supplier", "vendor"],
  invoiceNumber: ["رقم الفاتورة", "invoice number", "invoice no", "invoice"],
  invoiceDate: ["تاريخ الفاتورة", "التاريخ", "invoice date", "date"],
  paymentStatus: ["حالة الدفع", "الدفع", "payment status", "payment"],
};

const normalizedSynonyms = Object.fromEntries(
  importFields.map((field) => [
    field,
    headerSynonyms[field].map((value) => normalizeArabicText(value)),
  ]),
) as Record<ImportField, string[]>;

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0];
const MAX_UNZIPPED_BYTES = 60 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 400;

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

// Reads only the ZIP central directory, so nothing is inflated before the file is accepted.
function inspectZip(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let entries = 0;
  let unzipped = 0;
  for (let offset = 0; offset + 46 <= bytes.length; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    entries += 1;
    unzipped += view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const name = new TextDecoder("latin1")
      .decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
      .toLowerCase();
    if (name.includes("vbaproject")) {
      throw new SpreadsheetError("macros");
    }
    if (entries > MAX_ZIP_ENTRIES || unzipped > MAX_UNZIPPED_BYTES) {
      throw new SpreadsheetError("too_large");
    }
    offset += 45 + nameLength;
  }
  if (entries === 0) throw new SpreadsheetError("unreadable");
}

// The type is decided from the bytes; the file name and browser MIME type are not trusted.
export function detectSpreadsheetKind(bytes: Uint8Array): SpreadsheetKind {
  if (bytes.length === 0) throw new SpreadsheetError("empty");
  if (bytes.length > MAX_SPREADSHEET_BYTES) {
    throw new SpreadsheetError("too_large");
  }
  if (startsWith(bytes, ZIP_SIGNATURE)) {
    inspectZip(bytes);
    return "xlsx";
  }
  if (startsWith(bytes, CFB_SIGNATURE))
    throw new SpreadsheetError("legacy_xls");

  const sample = bytes.subarray(0, 4_096);
  if (sample.includes(0)) throw new SpreadsheetError("unsupported");
  const head = new TextDecoder("utf-8")
    .decode(sample)
    .trimStart()
    .toLowerCase();
  if (head.startsWith("<") || head.startsWith("%pdf")) {
    throw new SpreadsheetError("unsupported");
  }
  return "csv";
}

export function sanitizeFilename(input: string): string {
  const base = input.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 120);
  return cleaned || "file";
}

export function cleanCell(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CELL_LENGTH);
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const counts = [",", ";", "\t"].map((delimiter) => ({
    delimiter,
    total: firstLine.split(delimiter).length,
  }));
  counts.sort((a, b) => b.total - a.total);
  return counts[0]!.delimiter;
}

export function parseCsv(bytes: Uint8Array): SheetData {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new SpreadsheetError("unreadable");
  }
  text = text.replace(/^﻿/, "");
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  const endCell = () => {
    if (row.length < MAX_SPREADSHEET_COLUMNS) row.push(cleanCell(cell));
    cell = "";
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
    if (rows.length > MAX_SPREADSHEET_ROWS + 50) {
      throw new SpreadsheetError("too_many_rows");
    }
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"' && cell === "") {
      quoted = true;
    } else if (char === delimiter) {
      endCell();
    } else if (char === "\n") {
      endRow();
    } else if (char !== "\r") {
      cell += char;
    }
  }
  if (cell !== "" || row.length) endRow();
  return { name: "CSV", rows };
}

export function detectHeaderRow(rows: readonly string[][]): number {
  let best = { index: 0, score: 0 };
  rows.slice(0, 20).forEach((row, index) => {
    const score = Object.keys(suggestMapping(row)).length;
    if (score > best.score) best = { index, score };
  });
  return best.index;
}

export function suggestMapping(headerRow: readonly string[]): ColumnMapping {
  const headers = headerRow.map((cell) => normalizeArabicText(cell));
  const mapping: ColumnMapping = {};
  const taken = new Set<number>();
  for (const exact of [true, false]) {
    for (const field of importFields) {
      if (mapping[field] !== undefined) continue;
      const column = headers.findIndex(
        (header, index) =>
          header !== "" &&
          !taken.has(index) &&
          normalizedSynonyms[field].some((synonym) =>
            exact ? header === synonym : header.includes(synonym),
          ),
      );
      if (column >= 0) {
        mapping[field] = column;
        taken.add(column);
      }
    }
  }
  return mapping;
}

function parseDecimal(
  input: string,
): { whole: string; fraction: string } | null {
  let value = toLatinDigits(input)
    .replace(/[₪\s]|شيكل|ils|nis/gi, "")
    .trim();
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(value)) value = value.replace(/,/g, "");
  value = value.replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return { whole: whole!, fraction };
}

export function parseSpreadsheetMoney(input: string): number | null {
  const parts = parseDecimal(input);
  if (!parts) return null;
  const digits = `${parts.whole}${parts.fraction.padEnd(3, "0").slice(0, 3)}`;
  const milliAgorot = Number(digits) * 100;
  // Spreadsheet cells can carry more than two decimals; round half up to the agora.
  const agorot = Math.floor((milliAgorot + 500) / 1000);
  return Number.isSafeInteger(agorot) && agorot <= 1_000_000_000
    ? agorot
    : null;
}

export function parseSpreadsheetQuantity(input: string): number | null {
  const parts = parseDecimal(input);
  if (!parts || parts.fraction.length > 3) return null;
  return parseQuantityToMilli(
    parts.fraction ? `${parts.whole}.${parts.fraction}` : parts.whole,
  );
}

const unitSynonyms: Array<[StockUnit, string[]]> = [
  ["carton", ["كرتونه", "كرتون", "كراتين", "carton", "box", "ctn"]],
  ["pack", ["رزمه", "ربطه", "باكيت", "pack", "pkt"]],
  ["dozen", ["دزينه", "dozen", "dz"]],
  ["kg", ["كغم", "كيلو", "كغ", "kg"]],
  ["gram", ["غرام", "غم", "g", "gram"]],
  ["liter", ["لتر", "ليتر", "l", "liter", "litre"]],
  ["ml", ["مل", "ml"]],
  ["piece", ["حبه", "قطعه", "عدد", "piece", "pcs", "pc", "unit"]],
];

export function parseUnit(input: string): StockUnit | null {
  const value = normalizeArabicText(input);
  if (!value) return null;
  for (const [unit, synonyms] of unitSynonyms) {
    if (synonyms.some((synonym) => normalizeArabicText(synonym) === value)) {
      return unit;
    }
  }
  return null;
}

export function parsePaymentStatus(
  input: string,
): PurchasePaymentStatus | null {
  const value = normalizeArabicText(input);
  if (!value) return null;
  if (/جزي|partial/.test(value)) return "partially_paid";
  if (/غير|اجل|دين|ذمه|unpaid|credit/.test(value)) return "unpaid";
  if (/مدفوع|نقد|كاش|paid|cash/.test(value)) return "paid";
  return null;
}

export function parseSpreadsheetDate(input: string): string | null {
  const value = toLatinDigits(input).trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(value);
  const local = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(value);
  const parts = iso
    ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : local
      ? [Number(local[3]), Number(local[2]), Number(local[1])]
      : null;
  if (!parts) return null;
  const [year, month, day] = parts as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

export interface NormalizedImportRow {
  rowNumber: number;
  name: string;
  barcode: string;
  sku: string;
  size: string;
  unit: StockUnit;
  quantityMilli: number | null;
  unitCostAgorot: number | null;
  totalAgorot: number | null;
  supplier: string;
  invoiceNumber: string;
  invoiceDate: string | null;
  paymentStatus: PurchasePaymentStatus | null;
  errors: string[];
}

export function normalizeRows(
  rows: readonly string[][],
  headerRowIndex: number,
  mapping: ColumnMapping,
): NormalizedImportRow[] {
  const cell = (row: readonly string[], field: ImportField) => {
    const column = mapping[field];
    return column === undefined ? "" : cleanCell(row[column] ?? "");
  };
  const result: NormalizedImportRow[] = [];

  rows.forEach((row, index) => {
    if (index <= headerRowIndex) return;
    if (row.every((value) => value.trim() === "")) return;
    if (result.length >= MAX_SPREADSHEET_ROWS) {
      throw new SpreadsheetError("too_many_rows");
    }
    const errors: string[] = [];
    const name = cell(row, "name");
    const barcode = toLatinDigits(cell(row, "barcode")).replace(/\s/g, "");
    const sku = cell(row, "sku");
    if (!name && !barcode && !sku) {
      errors.push("لا يوجد اسم منتج أو باركود.");
    }

    const quantityText = cell(row, "quantity");
    const quantityMilli = parseSpreadsheetQuantity(quantityText);
    if (quantityMilli === null || quantityMilli <= 0) {
      errors.push("الكمية غير صالحة.");
    }

    const unitText = cell(row, "unit");
    const unit = parseUnit(unitText);
    if (unitText && !unit) errors.push("الوحدة غير معروفة.");

    const unitCostText = cell(row, "unitCost");
    const totalText = cell(row, "totalCost");
    let unitCostAgorot = unitCostText
      ? parseSpreadsheetMoney(unitCostText)
      : null;
    const totalAgorot = totalText ? parseSpreadsheetMoney(totalText) : null;
    if (unitCostText && unitCostAgorot === null) {
      errors.push("سعر الوحدة غير صالح.");
    }
    if (totalText && totalAgorot === null) errors.push("الإجمالي غير صالح.");
    if (!unitCostText && !totalText) errors.push("لا يوجد سعر شراء.");

    if (quantityMilli && quantityMilli > 0) {
      if (unitCostAgorot === null && totalAgorot !== null) {
        unitCostAgorot = unitAmountAgorot(totalAgorot, quantityMilli);
      } else if (unitCostAgorot !== null && totalAgorot !== null) {
        const expected = lineTotalAgorot(quantityMilli, unitCostAgorot);
        if (Math.abs(expected - totalAgorot) > 1) {
          errors.push("الإجمالي لا يساوي الكمية × سعر الوحدة.");
        }
      }
    }

    const dateText = cell(row, "invoiceDate");
    const invoiceDate = dateText ? parseSpreadsheetDate(dateText) : null;
    if (dateText && !invoiceDate) errors.push("تاريخ الفاتورة غير مفهوم.");

    result.push({
      rowNumber: index + 1,
      name,
      barcode,
      sku,
      size: cell(row, "size"),
      unit: unit ?? "piece",
      quantityMilli,
      unitCostAgorot,
      totalAgorot,
      supplier: cell(row, "supplier"),
      invoiceNumber: cell(row, "invoiceNumber"),
      invoiceDate,
      paymentStatus: parsePaymentStatus(cell(row, "paymentStatus")),
      errors,
    });
  });
  return result;
}

// Spreadsheet applications run cells that start with these characters as formulas.
export function escapeSpreadsheetCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function toCsv(rows: readonly (readonly string[])[]): string {
  const lines = rows.map((row) =>
    row
      .map((value) => {
        const safe = escapeSpreadsheetCell(value);
        return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
      })
      .join(","),
  );
  return `﻿${lines.join("\r\n")}\r\n`;
}
