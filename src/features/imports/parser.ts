import * as XLSX from "xlsx";

import type { RawImportRow, SystemImportRows } from "@/features/imports/types";

export async function parseSpreadsheetFile(file: File): Promise<RawImportRow[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", raw: false, cellDates: false });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  return sheetToRows(firstSheet);
}

export async function parseSystemGoalsPurchasesFile(file: File): Promise<SystemImportRows> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", raw: false, cellDates: false });

  return {
    goals: sheetToRows(findSheet(workbook, "Metas_Sistema")),
    purchases: sheetToRows(findSheet(workbook, "Compras_Sistema")),
  };
}

function findSheet(workbook: XLSX.WorkBook, expectedName: string) {
  const exact = workbook.Sheets[expectedName];
  if (exact) return exact;

  const normalizedExpected = normalizeHeader(expectedName);
  const fallbackName = workbook.SheetNames.find((name) => normalizeHeader(name) === normalizedExpected);
  return fallbackName ? workbook.Sheets[fallbackName] : undefined;
}

function sheetToRows(sheet: XLSX.WorkSheet | undefined): RawImportRow[] {
  if (!sheet) return [];

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: false,
  });

  return rows
    .map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [normalizeHeader(key), String(value ?? "").trim()]),
      ),
    )
    .filter((row) => Object.values(row).some((value) => value.trim() !== ""));
}

function normalizeHeader(value: string) {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
