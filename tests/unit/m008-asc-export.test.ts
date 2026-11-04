import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  ascHeaders,
  ascValuesFromSources,
  serializeAscCsv,
  serializeAscXlsx,
  validateAscManifest,
} from "../../frontend/src/lib/scholar/asc-export";
import {
  ASC_MANIFEST_2026_DRAFT,
  type AscManifest,
} from "../../frontend/src/lib/scholar/asc-manifest.2026-draft";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const FIXTURE_VALUES = {
  school_name: "Fixture Academy",
  school_address: "14 Example Road",
  school_phone: "000-000-0000",
  school_email: "fixture@example.test",
  state: "Sample State",
  lga: "Sample LGA",
  ownership: "public",
  active_student_count: 12,
  active_teacher_count: 3,
};

function readXlsxHeaders(bytes: Uint8Array): string[] {
  const sheet = strFromU8(unzipSync(bytes)["xl/worksheets/sheet1.xml"]);
  const row = sheet.match(/<row r="1">([\s\S]*?)<\/row>/u)?.[1];
  if (!row) throw new Error("XLSX header row is missing");
  return [
    ...row.matchAll(
      /<c r="[A-Z]+1" t="inlineStr"><is><t xml:space="preserve">(.*?)<\/t><\/is><\/c>/gu,
    ),
  ].map((match) =>
    match[1]
      .replaceAll("&quot;", '"')
      .replaceAll("&apos;", "'")
      .replaceAll("&gt;", ">")
      .replaceAll("&lt;", "<")
      .replaceAll("&amp;", "&"),
  );
}

function readXlsxDataRow(bytes: Uint8Array): { columns: string[]; values: string[] } {
  const sheet = strFromU8(unzipSync(bytes)["xl/worksheets/sheet1.xml"]);
  const row = sheet.match(/<row r="2">([\s\S]*?)<\/row>/u)?.[1];
  if (!row) throw new Error("XLSX data row is missing");
  const cells = [
    ...row.matchAll(
      /<c r="([A-Z]+)2"(?: t="inlineStr")?><is><t xml:space="preserve">(.*?)<\/t><\/is><\/c>|<c r="([A-Z]+)2"><v>(.*?)<\/v><\/c>/gu,
    ),
  ];
  return {
    columns: cells.map((match) => match[1] ?? match[3]),
    values: cells.map((match) =>
      (match[2] ?? match[4])
        .replaceAll("&quot;", '"')
        .replaceAll("&apos;", "'")
        .replaceAll("&gt;", ">")
        .replaceAll("&lt;", "<")
        .replaceAll("&amp;", "&"),
    ),
  };
}

describe("M08 ASC draft manifest export", () => {
  it("keeps CSV headers and values in the manifest order", () => {
    const expected = readFileSync(join(ROOT, "tests/fixtures/asc-export.golden.csv"), "utf8");
    const actual = serializeAscCsv(ASC_MANIFEST_2026_DRAFT, FIXTURE_VALUES);
    expect(actual.replaceAll("\r\n", "\n")).toBe(expected.trimEnd().replaceAll("\r\n", "\n"));
    expect(actual.split("\r\n")[0]).toBe(
      ascHeaders(ASC_MANIFEST_2026_DRAFT)
        .map((cell) => `"${cell}"`)
        .join(","),
    );
  });

  it("keeps XLSX header and data columns in manifest order", () => {
    const expected = JSON.parse(
      readFileSync(join(ROOT, "tests/fixtures/asc-export.golden-xlsx-headers.json"), "utf8"),
    ) as { headers: string[]; columns: string[]; values: string[] };
    const xlsx = serializeAscXlsx(ASC_MANIFEST_2026_DRAFT, FIXTURE_VALUES);
    expect(readXlsxHeaders(serializeAscXlsx(ASC_MANIFEST_2026_DRAFT, FIXTURE_VALUES))).toEqual(
      expected.headers,
    );
    expect(ascHeaders(ASC_MANIFEST_2026_DRAFT)).toEqual(expected.headers);
    expect(readXlsxDataRow(xlsx)).toEqual({
      columns: expected.columns,
      values: expected.values,
    });
  });

  it("resolves source mappings from manifest data rather than hard-coded field keys", () => {
    const values = ascValuesFromSources(ASC_MANIFEST_2026_DRAFT, {
      tables: {
        schools: {
          name: "Fixture Academy",
          address: "14 Example Road",
          phone: "000-000-0000",
          email: "fixture@example.test",
        },
        school_locations: { state: "Sample State", lga: "Sample LGA", ownership: "public" },
      },
      derivations: { "active-student-count": 12, "active-teacher-count": 3 },
    });
    expect(serializeAscCsv(ASC_MANIFEST_2026_DRAFT, values)).toContain('"Fixture Academy"');
    expect(values).toEqual(FIXTURE_VALUES);
  });

  it("leaves missing values blank in CSV and XLSX without substituting a value", () => {
    const values = { ...FIXTURE_VALUES, school_name: null };
    const csv = serializeAscCsv(ASC_MANIFEST_2026_DRAFT, values);
    const sheet = strFromU8(
      unzipSync(serializeAscXlsx(ASC_MANIFEST_2026_DRAFT, values))["xl/worksheets/sheet1.xml"],
    );
    expect(csv.split("\r\n")[1].split(",")[0]).toBe('""');
    expect(sheet).toContain('<c r="A2"/>');
    expect(csv).not.toContain("null");
    expect(csv).not.toContain("undefined");
  });

  it("rejects duplicate and missing manifest keys", () => {
    const [first, second] = ASC_MANIFEST_2026_DRAFT.sections[0].fields;
    const duplicate: AscManifest = {
      ...ASC_MANIFEST_2026_DRAFT,
      sections: ASC_MANIFEST_2026_DRAFT.sections.map((section, index) =>
        index === 0
          ? {
              ...section,
              fields: [first, { ...second, key: first.key }, ...section.fields.slice(2)],
            }
          : section,
      ),
    };
    const missing: AscManifest = {
      ...ASC_MANIFEST_2026_DRAFT,
      sections: ASC_MANIFEST_2026_DRAFT.sections.map((section, index) =>
        index === 0
          ? { ...section, fields: [{ ...first, key: " " }, ...section.fields.slice(1)] }
          : section,
      ),
    };

    expect(() => validateAscManifest(duplicate)).toThrow("Duplicate ASC field key");
    expect(() => validateAscManifest(missing)).toThrow("ASC field key is required");
  });

  it("marks the shipped manifest as unverified, with an ordered schema-derived field set", () => {
    expect(ASC_MANIFEST_2026_DRAFT.status).toBe("unverified-draft");
    expect(ASC_MANIFEST_2026_DRAFT.sections.flatMap((section) => section.fields)).toHaveLength(9);
    expect(ASC_MANIFEST_2026_DRAFT.sections[1].fields[0].source).toEqual({
      derivation: "active-student-count",
      tenantColumn: "school_id",
    });
  });
});
