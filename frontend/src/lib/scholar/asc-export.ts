import { strToU8, zipSync } from "fflate";
import type { AscField, AscManifest } from "./asc-manifest.2026-draft";

export type AscCellValue = string | number | null | undefined;
export type AscValues = Readonly<Record<string, AscCellValue>>;

export interface AscSourceSnapshot {
  readonly tables: Readonly<
    Partial<Record<"schools" | "school_locations", Readonly<Record<string, AscCellValue>> | null>>
  >;
  readonly derivations: Readonly<
    Partial<Record<"active-student-count" | "active-teacher-count", AscCellValue>>
  >;
}

export function validateAscManifest(manifest: AscManifest): readonly AscField[] {
  if (!manifest.revision.trim()) throw new Error("ASC manifest revision is required");
  if (!Array.isArray(manifest.sections) || manifest.sections.length === 0) {
    throw new Error("ASC manifest must contain sections");
  }

  const sectionKeys = new Set<string>();
  const fieldKeys = new Set<string>();
  const fields: AscField[] = [];

  for (const section of manifest.sections) {
    if (!section.key?.trim()) throw new Error("ASC manifest section key is required");
    if (sectionKeys.has(section.key)) throw new Error(`Duplicate ASC section key: ${section.key}`);
    sectionKeys.add(section.key);
    if (!Array.isArray(section.fields)) throw new Error(`ASC section ${section.key} has no fields`);

    for (const field of section.fields) {
      if (!field.key?.trim())
        throw new Error(`ASC field key is required in section ${section.key}`);
      if (fieldKeys.has(field.key)) throw new Error(`Duplicate ASC field key: ${field.key}`);
      if (!field.header?.trim()) throw new Error(`ASC field header is required: ${field.key}`);
      if (!field.source || !field.type)
        throw new Error(`ASC field mapping is required: ${field.key}`);
      fieldKeys.add(field.key);
      fields.push(field);
    }
  }

  if (fields.length === 0) throw new Error("ASC manifest must contain fields");
  return fields;
}

export function ascValuesFromSources(
  manifest: AscManifest,
  snapshot: AscSourceSnapshot,
): AscValues {
  return Object.fromEntries(
    validateAscManifest(manifest).map((field) => {
      const { source } = field;
      const value =
        "table" in source
          ? snapshot.tables[source.table]?.[source.column]
          : snapshot.derivations[source.derivation];
      return [field.key, value];
    }),
  );
}

export function ascHeaders(manifest: AscManifest): readonly string[] {
  return validateAscManifest(manifest).map((field) => field.header);
}

function valueFor(field: AscField, values: AscValues): string {
  const value = values[field.key];
  if (value === null || value === undefined) return "";
  if (field.type === "integer") {
    if (typeof value !== "number" || !Number.isSafeInteger(value)) {
      throw new Error(`ASC field ${field.key} must be a safe integer or blank`);
    }
    return String(value);
  }
  if (typeof value !== "string") throw new Error(`ASC field ${field.key} must be text or blank`);
  return value;
}

function csvCell(value: string, field: AscField): string {
  const safeValue = field.type === "text" && /^\s*[=+\-@]/u.test(value) ? `'${value}` : value;
  return `"${safeValue.replaceAll('"', '""')}"`;
}

export function serializeAscCsv(manifest: AscManifest, values: AscValues): string {
  const fields = validateAscManifest(manifest);
  return [
    fields.map((field) => csvCell(field.header, field)).join(","),
    fields.map((field) => csvCell(valueFor(field, values), field)).join(","),
  ].join("\r\n");
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function columnName(index: number): string {
  let name = "";
  for (let current = index + 1; current > 0; current = Math.floor((current - 1) / 26)) {
    name = String.fromCharCode(65 + ((current - 1) % 26)) + name;
  }
  return name;
}

function xlsxCell(reference: string, field: AscField, value: string): string {
  if (!value) return `<c r="${reference}"/>`;
  if (field.type === "integer") return `<c r="${reference}"><v>${value}</v></c>`;
  return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
}

export function serializeAscXlsx(manifest: AscManifest, values: AscValues): Uint8Array {
  const fields = validateAscManifest(manifest);
  const header = fields
    .map((field, index) =>
      xlsxCell(`${columnName(index)}1`, { ...field, type: "text" }, field.header),
    )
    .join("");
  const row = fields
    .map((field, index) => xlsxCell(`${columnName(index)}2`, field, valueFor(field, values)))
    .join("");
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${header}</row><row r="2">${row}</row></sheetData></worksheet>`;

  return zipSync({
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    ),
    "_rels/.rels": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    ),
    "xl/workbook.xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="ASC draft" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    "xl/worksheets/sheet1.xml": strToU8(sheet),
  });
}
