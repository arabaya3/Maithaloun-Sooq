import { describe, expect, it } from "vitest";

import { matchLine, similarity, type CatalogVariant } from "./line-matching";
import {
  SpreadsheetError,
  detectHeaderRow,
  detectSpreadsheetKind,
  escapeSpreadsheetCell,
  normalizeRows,
  parseCsv,
  parseSpreadsheetDate,
  parseSpreadsheetMoney,
  parseSpreadsheetQuantity,
  sanitizeFilename,
  suggestMapping,
  toCsv,
} from "./spreadsheet";

const bytes = (text: string) => new TextEncoder().encode(text);

function zipWithEntry(name: string): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const local = new Uint8Array(30);
  local.set([0x50, 0x4b, 0x03, 0x04]);
  const central = new Uint8Array(46 + nameBytes.length);
  const view = new DataView(central.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint32(24, 100, true);
  view.setUint16(28, nameBytes.length, true);
  central.set(nameBytes, 46);
  const result = new Uint8Array(local.length + central.length);
  result.set(local);
  result.set(central, local.length);
  return result;
}

describe("file acceptance", () => {
  it("decides the type from content, not from the name", () => {
    expect(detectSpreadsheetKind(bytes("المنتج,الكمية\nكلور,2\n"))).toBe("csv");
    expect(detectSpreadsheetKind(zipWithEntry("xl/workbook.xml"))).toBe("xlsx");
  });

  it("rejects macros, legacy xls, HTML, binaries and empty files", () => {
    const code = (input: Uint8Array) => {
      try {
        detectSpreadsheetKind(input);
        return "accepted";
      } catch (error) {
        return (error as SpreadsheetError).code;
      }
    };
    expect(code(zipWithEntry("xl/vbaProject.bin"))).toBe("macros");
    expect(code(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0]))).toBe(
      "legacy_xls",
    );
    expect(code(bytes("<html><table><tr><td>1</td></tr></table></html>"))).toBe(
      "unsupported",
    );
    expect(code(new Uint8Array([1, 2, 0, 3]))).toBe("unsupported");
    expect(code(new Uint8Array())).toBe("empty");
  });

  it("sanitises uploaded file names", () => {
    expect(sanitizeFilename("..\\..\\secret/فاتورة <1>.xlsx")).toBe(
      "فاتورة 1.xlsx",
    );
    expect(sanitizeFilename("")).toBe("file");
  });
});

describe("csv parsing", () => {
  it("handles quotes, embedded delimiters and a BOM", () => {
    const sheet = parseCsv(
      bytes('﻿المنتج,الكمية\n"كلور ""دولفين"", 1 لتر",2\r\nجلي,3\n'),
    );
    expect(sheet.rows).toEqual([
      ["المنتج", "الكمية"],
      ['كلور "دولفين", 1 لتر', "2"],
      ["جلي", "3"],
    ]);
  });

  it("detects semicolon-separated files", () => {
    expect(parseCsv(bytes("a;b;c\n1;2;3\n")).rows[1]).toEqual(["1", "2", "3"]);
  });
});

describe("header detection and mapping", () => {
  const rows = [
    ["مورد الخير للتجارة", "", ""],
    ["اسم المنتج", "الكمية", "سعر الوحدة", "الإجمالي", "الباركود"],
    ["سائل جلي", "12", "8.5", "102", "7290001"],
  ];

  it("finds the header row below a title", () => {
    expect(detectHeaderRow(rows)).toBe(1);
  });

  it("maps Arabic and English headers", () => {
    expect(suggestMapping(rows[1]!)).toEqual({
      name: 0,
      quantity: 1,
      unitCost: 2,
      totalCost: 3,
      barcode: 4,
    });
    expect(suggestMapping(["Product", "Qty", "Unit Cost", "SKU"])).toEqual({
      name: 0,
      quantity: 1,
      unitCost: 2,
      sku: 3,
    });
  });
});

describe("row normalisation", () => {
  const mapping = { name: 0, quantity: 1, unitCost: 2, totalCost: 3, unit: 4 };

  it("converts cells into integer quantities and agorot", () => {
    const [row] = normalizeRows(
      [
        ["المنتج", "الكمية", "السعر", "الإجمالي", "الوحدة"],
        ["سائل جلي", "١٢", "8.50 ₪", "102", "كرتونة"],
      ],
      0,
      mapping,
    );
    expect(row).toMatchObject({
      rowNumber: 2,
      name: "سائل جلي",
      quantityMilli: 12_000,
      unitCostAgorot: 850,
      totalAgorot: 10_200,
      unit: "carton",
      errors: [],
    });
  });

  it("derives the unit cost from the line total", () => {
    const [row] = normalizeRows([[], ["كلور", "3", "", "10"]], 0, mapping);
    expect(row?.unitCostAgorot).toBe(333);
    expect(row?.errors).toEqual([]);
  });

  it("reports row-level errors without dropping the row", () => {
    const rows = normalizeRows(
      [
        [],
        ["", "2", "5", ""],
        ["كلور", "abc", "5", ""],
        ["جلي", "2", "", ""],
        ["مبيض", "2", "5", "99"],
        ["", "", "", ""],
      ],
      0,
      mapping,
    );
    expect(rows).toHaveLength(4);
    expect(rows[0]?.errors).toContain("لا يوجد اسم منتج أو باركود.");
    expect(rows[1]?.errors).toContain("الكمية غير صالحة.");
    expect(rows[2]?.errors).toContain("لا يوجد سعر شراء.");
    expect(rows[3]?.errors).toContain("الإجمالي لا يساوي الكمية × سعر الوحدة.");
  });

  it("parses money, quantities and dates defensively", () => {
    expect(parseSpreadsheetMoney("1,250.50")).toBe(125_050);
    expect(parseSpreadsheetMoney("3,5")).toBe(350);
    expect(parseSpreadsheetMoney("3.3333")).toBe(333);
    expect(parseSpreadsheetMoney("2.005")).toBe(201);
    expect(parseSpreadsheetMoney("=1+1")).toBeNull();
    expect(parseSpreadsheetQuantity("1.5")).toBe(1_500);
    expect(parseSpreadsheetQuantity("1.2345")).toBeNull();
    expect(parseSpreadsheetDate("2026-09-01")).toBe("2026-09-01");
    expect(parseSpreadsheetDate("1/9/2026")).toBe("2026-09-01");
    expect(parseSpreadsheetDate("31/02/2026")).toBeNull();
  });
});

describe("formula injection", () => {
  it("neutralises cells that a spreadsheet would execute", () => {
    expect(escapeSpreadsheetCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(escapeSpreadsheetCell("+1")).toBe("'+1");
    expect(escapeSpreadsheetCell("@cmd")).toBe("'@cmd");
    expect(escapeSpreadsheetCell("كلور")).toBe("كلور");
    expect(toCsv([["=1+1", 'a"b']])).toBe('﻿\'=1+1,"a""b"\r\n');
  });
});

describe("invoice line matching", () => {
  const catalog: CatalogVariant[] = [
    {
      variantId: "arar--default",
      productName: "سائل جلي Arar",
      variantLabel: null,
      sku: "AR-1",
      barcode: "7290001",
    },
    {
      variantId: "floor-1l",
      productName: "منظف أرضيات Smart",
      variantLabel: "1 لتر",
      sku: null,
      barcode: null,
    },
    {
      variantId: "floor-4l",
      productName: "منظف أرضيات Smart",
      variantLabel: "4 لتر",
      sku: null,
      barcode: null,
    },
  ];
  const noAliases = new Map<string, string>();

  it("prefers barcode and SKU over names", () => {
    expect(
      matchLine({ name: "شيء آخر", barcode: "7290001" }, catalog, noAliases),
    ).toMatchObject({ status: "matched", method: "barcode" });
    expect(
      matchLine({ name: "شيء آخر", sku: "ar 1" }, catalog, noAliases),
    ).toMatchObject({ status: "matched", method: "sku" });
  });

  it("matches an exact normalised name and disambiguates by size", () => {
    expect(
      matchLine({ name: "سائل جلى ARAR" }, catalog, noAliases),
    ).toMatchObject({ status: "matched", method: "exact_name" });
    expect(
      matchLine(
        { name: "منظف ارضيات Smart", size: "4 لتر" },
        catalog,
        noAliases,
      ),
    ).toMatchObject({ status: "matched", variantId: "floor-4l" });
  });

  it("asks a person when the same name fits several sizes", () => {
    const result = matchLine({ name: "منظف أرضيات Smart" }, catalog, noAliases);
    expect(result.status).toBe("suggested");
    expect(result.variantId).toBeNull();
    expect(result.candidates).toHaveLength(2);
  });

  it("uses a saved supplier alias", () => {
    const aliases = new Map([["جلي عرار كبير", "arar--default"]]);
    expect(
      matchLine({ name: "جلي عرار كبير" }, catalog, aliases),
    ).toMatchObject({ status: "matched", method: "supplier_alias" });
  });

  it("never auto-selects a fuzzy match", () => {
    const result = matchLine(
      { name: "سائل جلي ارار ليمون" },
      catalog,
      noAliases,
    );
    expect(result.status).toBe("suggested");
    expect(result.method).toBe("fuzzy");
    expect(result.variantId).toBeNull();
    expect(result.candidates[0]?.variantId).toBe("arar--default");
  });

  it("returns unmatched for unrelated text", () => {
    expect(
      matchLine({ name: "مسامير حديد" }, catalog, noAliases),
    ).toMatchObject({ status: "unmatched", candidates: [] });
    expect(similarity("كلور", "كلور")).toBe(100);
  });
});
