/**
 * Native Excel (.xlsx) import. Library: read-excel-file (MIT, maintained, 0 npm advisories on
 * 24 Oct 2026; chosen over exceljs, whose last release is Dec 2024 and which pulls a uuid
 * version with a moderate advisory). Parsing runs in the browser; the file never leaves the
 * admin's machine until mapped canonical records are sent to integration_ingest.
 * Legacy .xls (BIFF) is not supported: save as .xlsx or CSV.
 */
import { MAX_ROWS } from "./csv";

export const MAX_XLSX_BYTES = 15 * 1024 * 1024;
type Cell = string | number | boolean | Date | null | undefined;

function cellText(v: Cell): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  if (typeof v === "number")
    return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
  return String(v).trim();
}

/** Turn a sheet (first non-empty row = headers) into the same shape as the CSV parser. */
export function sheetToRows(data: Cell[][]): { headers: string[]; rows: Record<string, string>[] } {
  const nonEmpty = data.map((r) => r.map(cellText)).filter((r) => r.some((c) => c !== ""));
  const raw = nonEmpty.shift() ?? [];
  const headers = raw.map((h, i) => h || `Column ${i + 1}`);
  if (nonEmpty.length > MAX_ROWS)
    throw new Error(`sheet has ${nonEmpty.length} rows; the limit is ${MAX_ROWS} per import`);
  return {
    headers,
    rows: nonEmpty.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""]))),
  };
}

export interface WorkbookSheet {
  name: string;
  headers: string[];
  rows: Record<string, string>[];
}
export async function readWorkbook(file: Blob): Promise<WorkbookSheet[]> {
  if (file.size > MAX_XLSX_BYTES)
    throw new Error("workbook is larger than 15 MB; split it or export the sheet as CSV");
  const mod = await import("read-excel-file/browser");
  const sheets = await mod.default(file);
  return sheets.map((s) => ({ name: s.sheet, ...sheetToRows(s.data as unknown as Cell[][]) }));
}
