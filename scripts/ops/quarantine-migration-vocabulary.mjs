#!/usr/bin/env node
/**
 * Quarantine domain-vocabulary hits of NAMED Scholar SQL migrations in the
 * neutrality baseline (architecture/coregrid-mvp-architecture/NEUTRALITY_GUARD_BASELINE.json).
 *
 * Why this exists: scripts/verify-domain-neutrality.mjs scans every migration,
 * but SQL that defines RLS on Scholar's own tables (fees, students, ...) cannot be
 * relocated into a runtime namespace — Supabase only reads database/supabase/migrations/.
 * TypeScript must be RELOCATED (frontend/src/lib/runtime/scholar/), never quarantined;
 * this script refuses anything that is not a migration .sql file.
 *
 * Usage: node scripts/ops/quarantine-migration-vocabulary.mjs <streamIRef> <migration.sql>...
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const BASELINE = "architecture/coregrid-mvp-architecture/NEUTRALITY_GUARD_BASELINE.json";
const [ref, ...files] = process.argv.slice(2);
if (!ref || files.length === 0) {
  console.error("usage: quarantine-migration-vocabulary.mjs <streamIRef> <migration.sql>...");
  process.exit(2);
}
for (const f of files) {
  if (!/^database\/supabase\/migrations\/[^/]+\.sql$/.test(f)) {
    console.error(`refusing ${f}: only database/supabase/migrations/*.sql may be quarantined`);
    process.exit(2);
  }
}
const run = spawnSync("node", ["scripts/verify-domain-neutrality.mjs"], { encoding: "utf8", maxBuffer: 64 << 20 });
const out = `${run.stdout}\n${run.stderr}`;
const re = /^FAIL {2}(.+?):(\d+):(\S+) \[([\w-]+)\] :: (.*)$/;
const groups = new Map();
for (const line of out.split("\n")) {
  const m = re.exec(line);
  if (!m) continue;
  const [, file, ln, token, kind, snippet] = m;
  if (!files.includes(file)) continue;
  const k = `${kind}|${file}|${token}`;
  const g = groups.get(k) ?? { file, kind, token, streamIRef: ref, occurrences: 0, lines: [], firstSnippet: snippet.trim().slice(0, 160) };
  g.occurrences += 1;
  g.lines.push(Number(ln));
  groups.set(k, g);
}
const doc = JSON.parse(readFileSync(BASELINE, "utf8"));
const have = new Set(doc.baselineEntries.map((e) => `${e.kind}|${e.file}|${e.token}`));
let added = 0;
for (const [k, g] of groups) {
  if (have.has(k)) continue;
  doc.baselineEntries.push(g);
  added += 1;
}
const hitsByFile = {};
for (const e of doc.baselineEntries) hitsByFile[e.file] = (hitsByFile[e.file] ?? 0) + (e.occurrences ?? 0);
doc.summary.entryCount = doc.baselineEntries.length;
doc.summary.totalObservedHits = Object.values(hitsByFile).reduce((a, b) => a + b, 0);
doc.summary.hitsByFile = Object.fromEntries(Object.entries(hitsByFile).sort((a, b) => b[1] - a[1]));
writeFileSync(BASELINE, `${JSON.stringify(doc, null, 2)}\n`);
console.log(`quarantined ${added} new groups for ${files.length} migration file(s) under ${ref}`);
