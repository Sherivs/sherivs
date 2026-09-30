#!/usr/bin/env node
/**
 * CoreGrid Engineering-Section Completeness Scanner
 *
 * Parses every architecture/phase-*.md document across its heading dialect and
 * reports engineering-section coverage against the canonical dictionary used by
 * PROGRESS.md §10. Output is a per-phase table suitable for audit.
 *
 * Dialects handled:
 *   1. SECTION  — "SECTION A — Title" / "A.1 Purpose"  (phases 33–51)
 *   2. A_R      — "# A. Identity" style markdown        (phases 08–32)
 *   3. NUMBERED — "1. Purpose" style plain sections     (phases 01–07)
 *
 * Usage: node scripts/verification/engineering-sections.mjs [--json]
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const archDir = join(root, "architecture");

const CANONICAL_SECTIONS = [
  "Identity",
  "Purpose",
  "Ownership",
  "Boundary",
  "Principle",
  "Architecture",
  "Contract",
  "Data Model",
  "Event",
  "Workflow",
  "Security",
  "Tenancy",
  "AI Safety",
  "Observability",
  "Testing",
  "Integration",
  "Dependency",
  "Risk",
  "Completion",
  "Extension",
];

const KEYWORDS = [
  "API",
  "EVENT",
  "COMMAND",
  "QUERY",
  "POLICY",
  "SECURITY",
  "TENANT",
  "WORKFLOW",
  "AGENT",
  "MEMORY",
  "KNOWLEDGE",
  "OBSERVAB",
  "TEST",
  "AUDIT",
  "DEPENDENC",
  "BOUNDARY",
  "OWNERSHIP",
  "FAILURE",
  "DATA MODEL",
  "MIGRATION",
];

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

function detectDialect(text) {
  if (/^SECTION\s+[A-Z]{1,3}\b/im.test(text)) return "SECTION";
  if (/^#{1,6}\s+[A-Z]{1,3}\.\s/im.test(text)) return "A_R";
  if (/^[A-Z]{1,3}\.\d/m.test(text)) return "DOT_LETTER";
  if (/^\d{1,2}\.\s+[A-Z]/m.test(text)) return "NUMBERED";
  return "UNKNOWN";
}

function topLevelLetters(text, dialect) {
  const found = new Set();
  if (dialect === "SECTION") {
    for (const m of text.matchAll(/^SECTION\s+([A-Z]{1,3})\b/gim)) {
      for (const ch of m[1]) found.add(ch.toUpperCase());
    }
  } else if (dialect === "A_R") {
    for (const m of text.matchAll(/^#{1,6}\s+([A-Z]{1,3})\.\s/gim)) {
      for (const ch of m[1]) found.add(ch.toUpperCase());
    }
  } else if (dialect === "DOT_LETTER") {
    for (const m of text.matchAll(/^([A-Z]{1,3})\.\d/gm)) {
      for (const ch of m[1]) found.add(ch.toUpperCase());
    }
  }
  return LETTERS.filter((l) => found.has(l));
}

function keywordHits(text) {
  const hits = {};
  for (const kw of KEYWORDS) {
    const re = new RegExp(`\\b${kw.replace(/ /g, "\\s+")}`, "gi");
    hits[kw] = (text.match(re) || []).length;
  }
  return hits;
}

function sectionTitleHits(text) {
  const hits = {};
  for (const s of CANONICAL_SECTIONS) {
    const re = new RegExp(`\\b${s.replace(/ /g, "\\s+")}\\b`, "gi");
    hits[s] = (text.match(re) || []).length;
  }
  return hits;
}

const files = readdirSync(archDir)
  .filter((f) => /^phase-\d{2}-.*\.md$/.test(f))
  .sort();

const rows = files.map((f) => {
  const text = readFileSync(join(archDir, f), "utf8");
  const dialect = detectDialect(text);
  const letters = topLevelLetters(text, dialect);
  const kw = keywordHits(text);
  return {
    file: f,
    dialect,
    topSections: letters.join(""),
    sectionHits: sectionTitleHits(text),
    keywords: kw,
  };
});

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  const header = ["file", "dialect", "A-R", "sectHits>=10", ...KEYWORDS];
  console.log(header.join("\t"));
  for (const r of rows) {
    const completeSections = Object.values(r.sectionHits).filter((n) => n >= 1).length;
    const line = [
      r.file,
      r.dialect,
      r.topSections || "-",
      completeSections,
      ...KEYWORDS.map((k) => r.keywords[k]),
    ];
    console.log(line.join("\t"));
  }
  const fam = {};
  for (const r of rows) {
    const key = r.dialect;
    fam[key] = (fam[key] || 0) + 1;
  }
  console.log("\nDialect distribution (for PROGRESS.md §10 audit):");
  console.log(JSON.stringify(fam, null, 2));
}
