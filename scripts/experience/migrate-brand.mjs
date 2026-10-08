#!/usr/bin/env node
/**
 * Sherivs brand migration — classified, never blind.
 *
 * Reads architecture/sherivs-experience/BRAND_REFERENCE_AUDIT.json (produced by
 * inventory-experience.mjs) and rewrites ONLY the lines the audit classified as
 * customer-facing. Technical identifiers, database objects, packages, tooling,
 * governance records and tests are never touched here.
 *
 *   node scripts/experience/migrate-brand.mjs            # apply
 *   node scripts/experience/migrate-brand.mjs --dry-run  # report only
 *
 * Idempotent: once applied, the next audit has no customer-facing references
 * left, and this script becomes a no-op.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DRY = process.argv.includes("--dry-run");
const audit = JSON.parse(
  readFileSync(join(ROOT, "architecture/sherivs-experience/BRAND_REFERENCE_AUDIT.json"), "utf8"),
);

/** Lines that look customer-facing but are stable identifiers: preserved on purpose. */
const PRESERVE_LINE = [
  /SCHOLAR_FOUNDATION_MISSION_ID/, // stable mission id recorded in evidence/ledgers
  /"scheme"\s*:/, // deep-link URL scheme: changing it breaks installed apps
  /name:\s*"CoreGrid Integration"/, // registry-governed phase name (REGISTRY.md/PROGRESS.md lockstep, ADR 202)
];

const PROSE = /\bCoreGrid\b(?![A-Z_])/g;
const byFile = new Map();
for (const ref of audit.actionable) {
  if (!ref.class.startsWith("CUSTOMER_FACING")) continue;
  if (!byFile.has(ref.file)) byFile.set(ref.file, []);
  byFile.get(ref.file).push(ref);
}

let changed = 0;
let preserved = 0;
for (const [file, refs] of byFile) {
  const path = join(ROOT, file);
  const lines = readFileSync(path, "utf8").split("\n");
  for (const ref of refs) {
    const idx = ref.line - 1;
    const before = lines[idx];
    if (PRESERVE_LINE.some((re) => re.test(before))) {
      preserved++;
      console.log(`preserve  ${file}:${ref.line}  ${before.trim().slice(0, 90)}`);
      continue;
    }
    const after = before.replace(PROSE, "Sherivs");
    if (after === before) continue;
    lines[idx] = after;
    changed++;
    console.log(`migrate   ${file}:${ref.line}`);
  }
  if (!DRY) writeFileSync(path, lines.join("\n"));
}
console.log(`\n${DRY ? "[dry-run] " : ""}lines migrated: ${changed}, preserved: ${preserved}`);
