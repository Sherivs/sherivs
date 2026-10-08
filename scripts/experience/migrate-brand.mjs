#!/usr/bin/env node
/**
 * Sherivs brand migration — applies CoreGrid → Sherivs ONLY to lines the
 * classifier marks CUSTOMER_FACING, inside the customer-facing source zones.
 * Everything else (types, enums, buckets, credentials, packages, env vars,
 * migrations, governance documents) is preserved by design.
 *
 *   node scripts/experience/migrate-brand.mjs            # dry run
 *   node scripts/experience/migrate-brand.mjs --apply    # rewrite files
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyBrandLine } from "./brand-classifier.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const ZONES = ["frontend/src", "mobile/src", "mobile/app", "public"];
const APPLY = process.argv.includes("--apply");

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx|js)$/.test(full) && !full.endsWith("routeTree.gen.ts")) acc.push(full);
  }
  return acc;
}

let changedLines = 0;
const changedFiles = [];
for (const zone of ZONES) {
  for (const file of walk(join(ROOT, zone))) {
    const rel = relative(ROOT, file).split(sep).join("/");
    const lines = readFileSync(file, "utf8").split("\n");
    let touched = false;
    const next = lines.map((line) => {
      if (!/coregrid/i.test(line) || classifyBrandLine(line, rel) !== "CUSTOMER_FACING") return line;
      const out = line.replace(/\bCoreGrid\b/g, "Sherivs");
      if (out !== line) {
        touched = true;
        changedLines += 1;
      }
      return out;
    });
    if (touched) {
      changedFiles.push(rel);
      if (APPLY) writeFileSync(file, next.join("\n"));
    }
  }
}
console.log(`${APPLY ? "Applied" : "Would change"} ${changedLines} customer-facing line(s) in ${changedFiles.length} file(s).`);
for (const f of changedFiles) console.log(`  ${f}`);
