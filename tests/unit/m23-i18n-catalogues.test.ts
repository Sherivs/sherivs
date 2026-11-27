import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CATALOGUES, CATALOGUE_LOCALES, translate } from "@/lib/i18n/catalog";
import { en } from "@/lib/i18n/catalogues/en";
import * as haModule from "@/lib/i18n/catalogues/ha";
import * as igModule from "@/lib/i18n/catalogues/ig";
import * as yoModule from "@/lib/i18n/catalogues/yo";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

describe("M23 i18n catalogues", () => {
  it("ships en, ha, yo and ig", () => {
    expect([...CATALOGUE_LOCALES]).toEqual(["en", "ha", "yo", "ig"]);
  });

  it("every English key exists (possibly empty) in every other catalogue, and nothing extra", () => {
    const keys = Object.keys(en).sort();
    for (const locale of CATALOGUE_LOCALES) {
      expect(Object.keys(CATALOGUES[locale]).sort()).toEqual(keys);
      for (const value of Object.values(CATALOGUES[locale])) expect(typeof value).toBe("string");
    }
  });

  it("English values are all present", () => {
    for (const value of Object.values(en)) expect(value.trim().length).toBeGreaterThan(0);
  });

  it("ha, yo and ig are not invented: empty and marked for a human translator", () => {
    for (const mod of [haModule, yoModule, igModule]) {
      expect(mod.TRANSLATION_STATUS).toBe("TRANSLATOR_REQUIRED");
    }
    for (const locale of ["ha", "yo", "ig"] as const) {
      for (const value of Object.values(CATALOGUES[locale])) expect(value).toBe("");
    }
  });

  it("falls back to English for empty values and unknown locales", () => {
    expect(translate("ha", "common.home")).toBe("Home");
    expect(translate("fr", "common.save")).toBe("Save");
    expect(translate("en", "common.offline")).toBe(en["common.offline"]);
  });
});

/** User-facing literals in a TSX file: JSX text and string/template values of visible attributes. */
export function userFacingLiterals(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const found: string[] = [];
  for (const match of code.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)) {
    const text = match[1]!.replace(/\s+/g, " ").trim();
    if (text && !/=>|&&|\|\||[;=("]/.test(text)) found.push(text);
  }
  for (const match of code.matchAll(/{([^{}<>]*?)}\s*\n?\s*([A-Za-z][^<>{}]*?)\s*\n?\s*{/g)) {
    const text = match[2]!.replace(/\s+/g, " ").trim();
    if (text && /^[A-Za-z ,.'-]+$/.test(text)) found.push(text);
  }
  const attr = /\b(?:placeholder|aria-label|title|alt|label)=(?:"([^"]*)"|{`([^`]*)`})/g;
  for (const match of code.matchAll(attr)) {
    const text = (match[1] ?? match[2] ?? "").trim();
    if (/[A-Za-z]/.test(text)) found.push(text);
  }
  return [...new Set(found)];
}

describe("M23 hard-coded user-facing strings (opt-in files only)", () => {
  const optIn = JSON.parse(
    readFileSync(join(ROOT, "frontend/src/lib/i18n/hardcoded-strings-optin.json"), "utf8"),
  ) as { files: { path: string; baseline: string[] }[] };

  it("the detector finds JSX text and visible attributes", () => {
    const sample = `<div><p>Hello there</p><input placeholder="Type here" aria-label={\`Find \${x}\`} /><b>{a}</b></div>`;
    expect(userFacingLiterals(sample).sort()).toEqual(
      ["Find ${x}", "Hello there", "Type here"].sort(),
    );
  });

  it.each(optIn.files.map((f) => [f.path, f.baseline] as const))(
    "%s adds no new hard-coded user-facing string",
    (path, baseline) => {
      const literals = userFacingLiterals(readFileSync(join(ROOT, path), "utf8"));
      const fresh = literals.filter((text) => !baseline.includes(text));
      expect(fresh, "move new strings into frontend/src/lib/i18n/catalogues").toEqual([]);
    },
  );
});
