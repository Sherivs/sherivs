/**
 * CoreGrid — J-023 time-source discipline (MISSION H2-23).
 *
 * Static invariant suite for the single-clock law: the kernel time-authority
 * (`frontend/src/lib/kernel/time-authority.ts`) is the ONLY place production
 * code samples the wall clock; every other module receives time by
 * composition (an issued `TimeAuthority` or an injected caller instant).
 *
 * The machine-readable source of truth is `docs/audits/TIME_SOURCE_AUDIT.md`
 * (dated audit table, one row per file that carried a direct wall-clock
 * sample at audit time). This suite re-scans `frontend/src/lib` — with
 * comments and string/template literals stripped, so documentation mentions
 * of `Date.now()` cannot mask or fake a violation — and enforces:
 *
 *   1. every file verdicted VIOLATION (CORRECTED) is free of direct
 *      wall-clock samples AND composes the kernel authority;
 *   2. every file still carrying a direct sample is classified in the audit
 *      as SANCTIONED (with a recorded rationale) or as the AUTHORITY-SITE;
 *   3. the audit table matches a fresh re-scan exactly — an unclassified
 *      sample-bearing file fails CI, as does a row whose file is gone;
 *   4. the kernel itself holds exactly one sample site (the authority).
 *
 * Scan law: a direct wall-clock sample is `Date.now()` or a bare
 * argument-less `new Date()`. `new Date(value)` conversions re-derive a Date
 * from an already-captured instant — they are not samples.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const LIB_DIR = join(ROOT, "frontend/src/lib");
const AUDIT_DOC = join(ROOT, "docs/audits/TIME_SOURCE_AUDIT.md");
const AUTHORITY_REL = "frontend/src/lib/kernel/time-authority.ts";
const AUTHORITY_IMPORT_RE = /kernel\/time-authority/;
const AUTHORITY_COMPOSITION_RE =
  /const\s+timeAuthority\s*=\s*new\s+TimeAuthority\(\s*new\s+SystemClock\(\)\s*\)/;
const DATE_NOW_RE = /\bDate\.now\s*\(\s*\)/;
const BARE_NEW_DATE_RE = /\bnew\s+Date\s*\(\s*\)/;

/** Remove comments and string/template literal contents so only real code is
 * scanned. Template-literal `${...}` interpolation bodies are KEPT — that code
 * executes — while plain string/template text is blanked. */
function stripCommentsAndStrings(src: string): string {
  type State = "code" | "line" | "block" | "sq" | "dq" | "tpl" | "interp";
  const stack: State[] = ["code"];
  const interpBraceDepth: number[] = [];
  let out = "";
  let i = 0;
  while (i < src.length) {
    const state = stack[stack.length - 1];
    const c = src[i];
    const n = src[i + 1];
    if (state === "code") {
      if (c === "/" && n === "/") {
        stack.push("line");
        i += 2;
        continue;
      }
      if (c === "/" && n === "*") {
        stack.push("block");
        i += 2;
        continue;
      }
      if (c === "'") {
        stack.push("sq");
        out += "''";
        i++;
        continue;
      }
      if (c === '"') {
        stack.push("dq");
        out += '""';
        i++;
        continue;
      }
      if (c === "`") {
        stack.push("tpl");
        out += "``";
        i++;
        continue;
      }
      out += c;
      i++;
      continue;
    }
    if (state === "line") {
      if (c === "\n") {
        stack.pop();
        out += c;
      }
      i++;
      continue;
    }
    if (state === "block") {
      if (c === "*" && n === "/") {
        stack.pop();
        i += 2;
        out += " ";
        continue;
      }
      if (c === "\n") out += "\n"; // preserve line numbers across commented blocks
      i++;
      continue;
    }
    if (state === "sq") {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "'") stack.pop();
      i++;
      continue;
    }
    if (state === "dq") {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === '"') stack.pop();
      i++;
      continue;
    }
    if (state === "tpl") {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "`") {
        stack.pop();
        i++;
        continue;
      }
      if (c === "$" && n === "{") {
        stack.push("interp");
        interpBraceDepth.push(0);
        out += "${";
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (state === "interp") {
      if (c === "}") {
        if (interpBraceDepth[interpBraceDepth.length - 1] === 0) {
          stack.pop(); // close `${...}` — back into the surrounding template literal
          interpBraceDepth.pop();
          i++;
          continue;
        }
        interpBraceDepth[interpBraceDepth.length - 1]--;
        out += c;
        i++;
        continue;
      }
      if (c === "{") {
        interpBraceDepth[interpBraceDepth.length - 1]++;
        out += c;
        i++;
        continue;
      }
      if (c === "/" && n === "/") {
        stack.push("line");
        i += 2;
        continue;
      }
      if (c === "/" && n === "*") {
        stack.push("block");
        i += 2;
        continue;
      }
      if (c === "'") {
        stack.push("sq");
        out += "''";
        i++;
        continue;
      }
      if (c === '"') {
        stack.push("dq");
        out += '""';
        i++;
        continue;
      }
      if (c === "`") {
        stack.push("tpl");
        out += "``";
        i++;
        continue;
      }
      out += c;
      i++;
      continue;
    }
  }
  return out;
}

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

interface SampleFile {
  rel: string;
  lines: { line: number; code: string }[];
}

/** Production `.ts` files under frontend/src/lib carrying direct wall-clock samples. */
function scanLib(): SampleFile[] {
  const results: SampleFile[] = [];
  for (const full of walk(LIB_DIR)) {
    if (!full.endsWith(".ts") || full.endsWith(".test.ts")) continue;
    const clean = stripCommentsAndStrings(readFileSync(full, "utf8"));
    const hits: { line: number; code: string }[] = [];
    clean.split("\n").forEach((code, idx) => {
      if (DATE_NOW_RE.test(code) || BARE_NEW_DATE_RE.test(code)) {
        hits.push({ line: idx + 1, code: code.trim().slice(0, 120) });
      }
    });
    if (hits.length) {
      results.push({ rel: `frontend/src/lib/${full.slice(LIB_DIR.length + 1)}`, lines: hits });
    }
  }
  return results.sort((a, b) => a.rel.localeCompare(b.rel));
}

interface AuditRow {
  file: string;
  samples: string;
  verdict: "AUTHORITY-SITE" | "VIOLATION (CORRECTED)" | "SANCTIONED";
  rationale: string;
}

function parseAuditDoc(): AuditRow[] {
  const src = readFileSync(AUDIT_DOC, "utf8");
  const rows: AuditRow[] = [];
  for (const m of src.matchAll(
    /^\| `([^`]+)` \| (.*?) \| (AUTHORITY-SITE|VIOLATION \(CORRECTED\)|SANCTIONED) \| (.*?) \|$/gm,
  )) {
    rows.push({ file: m[1], samples: m[2], verdict: m[3] as AuditRow["verdict"], rationale: m[4] });
  }
  return rows;
}

describe("J-023 time-source discipline — static scan vs dated audit (H2-23)", () => {
  const samples = scanLib();
  const sampleByFile = new Map(samples.map((s) => [s.rel, s]));
  const audit = parseAuditDoc();
  const auditByFile = new Map(audit.map((r) => [r.file, r]));

  it("the audit doc exists and parses into a non-empty dated table", () => {
    expect(audit.length).toBeGreaterThan(0);
    const doc = readFileSync(AUDIT_DOC, "utf8");
    expect(doc).toMatch(/\*\*Date:\*\* 2026-10-02/);
  });

  it("every corrected file no longer samples the wall clock and composes the kernel authority", () => {
    const corrected = audit.filter((r) => r.verdict === "VIOLATION (CORRECTED)");
    expect(corrected.length).toBeGreaterThan(0);
    for (const row of corrected) {
      const full = join(ROOT, row.file);
      const src = readFileSync(full, "utf8");
      const clean = stripCommentsAndStrings(src);
      expect(
        DATE_NOW_RE.test(clean) || BARE_NEW_DATE_RE.test(clean),
        `${row.file} still samples the wall clock directly`,
      ).toBe(false);
      expect(src, `${row.file} must import the kernel time-authority`).toMatch(AUTHORITY_IMPORT_RE);
      expect(src, `${row.file} must compose TimeAuthority(new SystemClock())`).toMatch(
        AUTHORITY_COMPOSITION_RE,
      );
    }
  });

  it("every residual sample-bearing file is classified SANCTIONED or AUTHORITY-SITE with a rationale", () => {
    const unclassified = samples.filter((s) => !auditByFile.has(s.rel));
    expect(
      unclassified.map((s) => `${s.rel}:${s.lines.map((l) => l.line).join(",")}`),
      "unclassified wall-clock samples (extend docs/audits/TIME_SOURCE_AUDIT.md)",
    ).toEqual([]);
    for (const s of samples) {
      const row = auditByFile.get(s.rel)!;
      if (s.rel === AUTHORITY_REL) {
        expect(row.verdict).toBe("AUTHORITY-SITE");
        continue;
      }
      expect(row.verdict, `${s.rel} must be SANCTIONED`).toBe("SANCTIONED");
      expect(
        row.rationale.trim().length,
        `${s.rel} sanction needs a recorded rationale`,
      ).toBeGreaterThan(20);
    }
  });

  it("the audit table matches a fresh re-scan exactly (no stale rows, no drift)", () => {
    for (const row of audit) {
      const exists = statSync(join(ROOT, row.file), { throwIfNoEntry: false }) !== undefined;
      expect(exists, `audit row for missing file: ${row.file}`).toBe(true);
      if (row.verdict === "VIOLATION (CORRECTED)") {
        expect(
          sampleByFile.has(row.file),
          `corrected file re-appears with samples: ${row.file}`,
        ).toBe(false);
      } else {
        expect(
          sampleByFile.has(row.file),
          `sanctioned row no longer has samples: ${row.file}`,
        ).toBe(true);
      }
    }
    const sanctionedOrAuthority = audit
      .filter((r) => r.verdict !== "VIOLATION (CORRECTED)")
      .map((r) => r.file)
      .sort();
    const scanned = samples.map((s) => s.rel);
    expect(scanned, "re-scan and audit-doc residual sets must be identical").toEqual(
      sanctionedOrAuthority,
    );
  });

  it("the kernel holds exactly one wall-clock sample site: the authority itself", () => {
    const kernelSites = samples.filter((s) => s.rel.startsWith("frontend/src/lib/kernel/"));
    expect(kernelSites.map((s) => s.rel)).toEqual([AUTHORITY_REL]);
    const authoritySrc = readFileSync(join(ROOT, AUTHORITY_REL), "utf8");
    expect(authoritySrc).toMatch(/class SystemClock[\s\S]*?nowMs\(\)[\s\S]*?Date\.now\(\)/);
  });
});
