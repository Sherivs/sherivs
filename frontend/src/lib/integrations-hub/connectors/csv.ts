/**
 * Generic CSV / spreadsheet importer. Parses RFC 4180 CSV (quoted fields, embedded commas
 * and newlines, BOM) and TSV. Excel workbooks: export the sheet as CSV ("Save As > CSV UTF-8");
 * native .xlsx parsing is a follow-up (needs a vetted parser dependency).
 */
import { mapRow, type CanonicalRecord, type ConnectorManifest, type FieldMapping } from "../sdk";

export const csvManifest: ConnectorManifest = {
  key: "csv",
  name: "CSV / Excel import",
  version: "1.0.0",
  category: "file",
  auth_type: "none",
  entities: ["student", "staff", "guardian", "class", "result", "fee_invoice", "payment"],
  directions: ["inbound"],
  status: "beta",
};
export const MAX_ROWS = 20_000;

export function parseDelimited(
  text: string,
  delimiter?: string,
): { headers: string[]; rows: Record<string, string>[] } {
  const src = text.replace(/^\uFEFF/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const d = delimiter ?? (firstLine.split("\t").length > firstLine.split(",").length ? "\t" : ",");
  const cells: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === d) {
      row.push(cur);
      cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cur);
      cells.push(row);
      row = [];
      cur = "";
    } else cur += ch;
  }
  if (cur !== "" || row.length) {
    row.push(cur);
    cells.push(row);
  }
  const nonEmpty = cells.filter((r) => r.some((c) => c.trim() !== ""));
  const headers = (nonEmpty.shift() ?? []).map((h) => h.trim());
  if (nonEmpty.length > MAX_ROWS)
    throw new Error(`file has ${nonEmpty.length} rows; the limit is ${MAX_ROWS} per import`);
  const rows = nonEmpty.map((r) =>
    Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()])),
  );
  return { headers, rows };
}

export interface Preview {
  records: CanonicalRecord[];
  skipped: number;
  duplicates: string[];
}
/** Map every row; report rows without an id and ids repeated inside the file (dedupe before upload). */
export function previewImport(rows: Record<string, string>[], mappings: FieldMapping[]): Preview {
  const seen = new Map<string, number>();
  const records: CanonicalRecord[] = [];
  let skipped = 0;
  const duplicates: string[] = [];
  for (const r of rows) {
    const rec = mapRow(r, mappings);
    if (!rec) {
      skipped++;
      continue;
    }
    if (seen.has(rec.external_id)) {
      duplicates.push(rec.external_id);
      records[seen.get(rec.external_id)!] = rec;
      continue;
    }
    seen.set(rec.external_id, records.length);
    records.push(rec);
  }
  return { records, skipped, duplicates };
}

export function chunk<T>(xs: T[], n = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}
