import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SAFETY_EVAL_DAILY_CAP,
  SAFETY_MAX_TEXT_CHARS,
  SAFETY_ORG_DAILY_CAP,
  SAFETY_PATTERNS,
  SAFETY_RUN_CHECK_CAP,
  outputUsable,
  safetyCheckRefusal,
  safetyNormalize,
  safetyTextSha256,
  screenText,
} from "../../frontend/src/lib/workflow/ai-guardrails";

const MIGRATION =
  "database/supabase/migrations/20261117000995_sherivs_ain04_evaluation_guardrail_layer.sql";
const ROLLBACK =
  "database/supabase/rollbacks/20261117000995_sherivs_ain04_evaluation_guardrail_layer.sql";
const migration = readFileSync(MIGRATION, "utf8");
const rollback = readFileSync(ROLLBACK, "utf8");
const between = (a: string, b: string) =>
  migration.slice(migration.indexOf(a), migration.indexOf(b));
const patternSeed = between("-- BEGIN AIN04 PATTERN SEED", "-- END AIN04 PATTERN SEED");
const caseSeed = between("-- BEGIN AIN04 CASE SEED", "-- END AIN04 CASE SEED");

/** Evaluate a SQL string expression made of 'literals', chr(n), repeat('x', n) joined by ||. */
function evalSqlText(expr: string): string {
  let out = "";
  const re = /'((?:[^']|'')*)'|chr\((\d+)\)|repeat\('((?:[^']|'')*)',\s*(\d+)\)/gy;
  let pos = 0;
  for (;;) {
    re.lastIndex = pos;
    const m = re.exec(expr);
    if (!m) throw new Error(`cannot parse SQL text expression: ${expr}`);
    if (m[1] !== undefined) out += m[1].replace(/''/g, "'");
    else if (m[2] !== undefined) out += String.fromCodePoint(Number(m[2]));
    else out += m[3].replace(/''/g, "'").repeat(Number(m[4]));
    pos = re.lastIndex;
    const sep = /\s*\|\|\s*/y;
    sep.lastIndex = pos;
    const s = sep.exec(expr);
    if (!s) break;
    pos = sep.lastIndex;
  }
  if (pos !== expr.length) throw new Error(`trailing text in SQL expression: ${expr}`);
  return out;
}

const patternRows = [
  ...patternSeed.matchAll(
    /^ {2}\('([^']+)', '([^']+)', '([^']+)', '([^']+)', '([^']+)', '(.*)', '[^']+'\)[,;]$/gm,
  ),
].map((m) => ({
  code: m[1],
  category: m[2],
  severity: m[3],
  appliesTo: m[4],
  scan: m[5],
  // SQL source text -> the regex text PostgreSQL sees (standard strings: only '' is special)
  regex: m[6].replace(/''/g, "'"),
}));

const caseRows = [
  ...caseSeed.matchAll(
    /^ {2}\('([a-z0-9_.-]+)', (.+), '(input|output)', '(clean|flagged|blocked)', (NULL|'[a-z_.]+'), (true|false)\),?$/gm,
  ),
].map((m) => ({
  key: m[1],
  input: evalSqlText(m[2]),
  direction: m[3] as "input" | "output",
  verdict: m[4],
  code: m[5] === "NULL" ? null : m[5].slice(1, -1),
  critical: m[6] === "true",
}));

describe("AIN-04 guardrails: the TypeScript restatement matches the migration", () => {
  it("the pattern corpus matches the seed row for row", () => {
    expect(patternRows.length).toBe(SAFETY_PATTERNS.length);
    expect(patternRows.length).toBeGreaterThanOrEqual(20);
    for (const row of patternRows) {
      const ts = SAFETY_PATTERNS.find((x) => x.code === row.code);
      expect(ts, row.code).toBeDefined();
      expect(ts?.category, row.code).toBe(row.category);
      expect(ts?.severity, row.code).toBe(row.severity);
      expect(ts?.appliesTo, row.code).toBe(row.appliesTo);
      expect(ts?.scan, row.code).toBe(row.scan);
      expect(ts?.regex, row.code).toBe(row.regex);
    }
  });

  it("injection and secret shapes can only block, the rest only flag (and the database says so as a CHECK)", () => {
    for (const x of SAFETY_PATTERNS) {
      expect(x.severity, x.code).toBe(
        x.category === "injection" || x.category === "secret" ? "block" : "flag",
      );
    }
    expect(migration).toContain("(category IN ('injection', 'secret')) = (severity = 'block')");
  });

  it("the caps match the SQL functions", () => {
    expect(migration).toMatch(/wf_safety_max_text_chars\(\)[\s\S]{0,200}SELECT 20000 \$\$/);
    expect(migration).toMatch(/wf_safety_run_check_cap\(\)[\s\S]{0,200}SELECT 200 \$\$/);
    expect(migration).toMatch(/wf_safety_org_daily_cap\(\)[\s\S]{0,200}SELECT 5000 \$\$/);
    expect(migration).toMatch(/wf_safety_eval_daily_cap\(\)[\s\S]{0,200}SELECT 100 \$\$/);
    expect([
      SAFETY_MAX_TEXT_CHARS,
      SAFETY_RUN_CHECK_CAP,
      SAFETY_ORG_DAILY_CAP,
      SAFETY_EVAL_DAILY_CAP,
    ]).toEqual([20000, 200, 5000, 100]);
  });

  it("the normalization is the same steps in the same order", () => {
    expect(migration).toMatch(/normalize\(p_text, NFKC\)/);
    expect(migration).toContain(
      "[\\u200b-\\u200f\\u2028\\u2029\\u202a-\\u202e\\u2060-\\u2064\\ufeff\\u00ad]",
    );
    expect(safetyNormalize("  IG​NORE  \t All\n\nthings  ")).toBe("ignore all things");
    expect(safetyNormalize("ｉｇｎｏｒｅ")).toBe("ignore");
  });
});

describe("AIN-04 guardrails: the eval suite cases give the same verdicts in TypeScript", () => {
  it("the seed has the coverage the suite needs", () => {
    expect(caseRows.length).toBeGreaterThanOrEqual(40);
    for (const x of SAFETY_PATTERNS) {
      expect(
        caseRows.some((c) => c.code === x.code),
        `no case expects ${x.code}`,
      ).toBe(true);
    }
    expect(caseRows.filter((c) => c.verdict === "clean").length).toBeGreaterThanOrEqual(8);
  });

  for (const c of caseRows) {
    it(`case ${c.key}`, () => {
      const out = screenText(c.input, c.direction);
      expect(out.verdict).toBe(c.verdict);
      if (c.code) expect(out.codes).toContain(c.code);
      else expect(out.codes).toEqual([]);
    });
  }

  it("a secret-shaped literal never appears in the migration or this file", () => {
    for (const text of [
      migration,
      readFileSync("frontend/src/lib/workflow/ai-guardrails.ts", "utf8"),
    ]) {
      expect(text).not.toMatch(/sk_live_[0-9a-z]{8,}/i);
      expect(text).not.toMatch(/AKIA[0-9A-Z]{16}/);
      expect(text).not.toMatch(/eyJ[0-9A-Za-z_-]{8,}\.eyJ/);
    }
  });
});

describe("AIN-04 guardrails: refusals, hashing and output trust", () => {
  it("refuses a request the database would refuse", () => {
    expect(safetyCheckRefusal("draft-step", "output", "hello")).toBeNull();
    expect(safetyCheckRefusal("Bad Step", "output", "hello")).toBe("invalid_step");
    expect(safetyCheckRefusal("s", "sideways", "hello")).toBe("invalid_direction");
    expect(safetyCheckRefusal("s", "input", "")).toBe("text_required");
    expect(safetyCheckRefusal("s", "input", "x".repeat(SAFETY_MAX_TEXT_CHARS + 1))).toBe(
      "text_too_long",
    );
    expect(safetyCheckRefusal("s", "input", "x".repeat(SAFETY_MAX_TEXT_CHARS))).toBeNull();
  });

  it("hashes like the database (SHA-256 of the UTF-8 bytes)", async () => {
    expect(await safetyTextSha256("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("only clean, or flagged and cleared, is usable; blocked never is", () => {
    expect(outputUsable("clean", null)).toBe(true);
    expect(outputUsable("flagged", null)).toBe(false);
    expect(outputUsable("flagged", "rejected")).toBe(false);
    expect(outputUsable("flagged", "cleared")).toBe(true);
    expect(outputUsable("blocked", "cleared")).toBe(false);
    expect(outputUsable("blocked", null)).toBe(false);
  });

  it("the migration keeps the decisions the ADR states", () => {
    expect(migration).toContain("ain04:the_starter_of_the_run_cannot_review_its_output");
    expect(migration).toContain("ain04:only_a_flagged_output_can_be_reviewed");
    expect(migration).toContain("guard.unverified");
    expect(migration).toContain("'workflows.approve'");
    expect(migration).toContain("ain04:run_does_not_match_the_corpus");
    expect(migration).not.toMatch(
      /GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*wf_safety_[a-z_]+ TO (service_role|authenticated|anon)/,
    );
  });

  it("the rollback refuses while tenant ledger rows exist and drops every table", () => {
    expect(rollback).toContain("check or review rows exist");
    for (const t of [
      "wf_safety_review",
      "wf_safety_check",
      "wf_safety_eval_run",
      "wf_safety_eval_case",
      "wf_safety_eval_suite",
      "wf_safety_pattern",
    ]) {
      expect(rollback).toContain(`DROP TABLE public.${t};`);
    }
  });
});
