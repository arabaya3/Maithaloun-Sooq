import "server-only";

import ExcelJS from "exceljs";

import {
  MAX_SPREADSHEET_COLUMNS,
  MAX_SPREADSHEET_ROWS,
  MAX_SPREADSHEET_SHEETS,
  SpreadsheetError,
  cleanCell,
  detectSpreadsheetKind,
  importFieldLabels,
  importFields,
  parseCsv,
  type SheetData,
  type SpreadsheetKind,
} from "@/features/purchasing/domain/spreadsheet";

// Formulas are never evaluated: only the value cached in the file is read.
function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? ""
      : value.toISOString().slice(0, 10);
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("result" in record) return cellText(record.result);
    if ("formula" in record || "sharedFormula" in record) return "";
    if (Array.isArray(record.richText)) {
      return record.richText
        .map((part) => cellText((part as { text?: unknown }).text))
        .join("");
    }
    if ("text" in record) return cellText(record.text);
  }
  return "";
}

async function readXlsx(bytes: Buffer): Promise<SheetData[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(
      bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
    );
  } catch {
    throw new SpreadsheetError("unreadable");
  }
  if (workbook.worksheets.length > MAX_SPREADSHEET_SHEETS) {
    throw new SpreadsheetError("too_large");
  }

  return workbook.worksheets.map((sheet) => {
    if (sheet.rowCount > MAX_SPREADSHEET_ROWS + 50) {
      throw new SpreadsheetError("too_many_rows");
    }
    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: true }, (row) => {
      const cells: string[] = [];
      const width = Math.min(row.cellCount, MAX_SPREADSHEET_COLUMNS);
      for (let column = 1; column <= width; column += 1) {
        cells.push(cleanCell(cellText(row.getCell(column).value)));
      }
      rows.push(cells);
    });
    return { name: cleanCell(sheet.name) || "Sheet", rows };
  });
}

export async function readSpreadsheet(
  bytes: Buffer,
): Promise<{ kind: SpreadsheetKind; sheets: SheetData[] }> {
  const kind = detectSpreadsheetKind(bytes);
  const sheets = kind === "csv" ? [parseCsv(bytes)] : await readXlsx(bytes);
  const nonEmpty = sheets.filter((sheet) =>
    sheet.rows.some((row) => row.some((cell) => cell !== "")),
  );
  if (!nonEmpty.length) throw new SpreadsheetError("empty");
  return { kind, sheets: nonEmpty };
}

export async function buildImportTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("فاتورة شراء", {
    views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }],
  });
  sheet.columns = importFields.map((field) => ({
    header: importFieldLabels[field],
    key: field,
    width: field === "name" ? 32 : 18,
  }));
  sheet.getRow(1).font = { bold: true };
  sheet.addRow({
    name: "سائل جلي Arar",
    barcode: "",
    sku: "",
    size: "1 لتر",
    unit: "حبة",
    quantity: 12,
    unitCost: 8.5,
    totalCost: 102,
    supplier: "اسم المورد",
    invoiceNumber: "1001",
    invoiceDate: "2026-09-01",
    paymentStatus: "مدفوعة",
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
