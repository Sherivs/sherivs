#!/usr/bin/env node
/**
 * Sherivs migration grant check (mission M0, with SEC-M0 / ADR-101).
 *
 * Once new objects are private by default, a table created without a grant is unreachable. This
 * check fails any migration newer than the SEC-M0 cut-off that creates a table in schema public
 * and never names it in a GRANT or REVOKE statement: access must be an explicit decision.
 * It reads files only.
 *
 * Usage: node scripts/verify-migration-grants.mjs [--dir <folder>]
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Files at or below this version predate the rule and were applied under the old defaults. */
export const GRANT_RULE_AFTER_VERSION = "20261116000100";

const stripComments = (sql) => sql.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

export function tablesWithoutGrant(sql) {
  const body = stripComments(sql);
  const created = [
    ...body.matchAll(
      /CREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)("?[A-Za-z_][A-Za-z0-9_]*"?)/gi,
    ),
  ].map((m) => m[1].replace(/"/g, ""));
  const statements = body
    .split(";")
    .map((s) => s.trim())
    .filter((s) => /^(GRANT|REVOKE)\b/i.test(s) && /\bON\b/i.test(s));
  return [...new Set(created)].filter(
    (table) => !statements.some((s) => new RegExp(`\\b(?:public\\.)?"?${table}"?\\b`).test(s)),
  );
}

export function checkMigrationsFolder(dir) {
  const findings = [];
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    if (file.slice(0, 14) <= GRANT_RULE_AFTER_VERSION) continue;
    for (const table of tablesWithoutGrant(readFileSync(join(dir, file), "utf8"))) {
      findings.push(`${file}: public.${table} is created without any GRANT or REVOKE naming it`);
    }
  }
  return findings;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const flag = process.argv.indexOf("--dir");
  const dir =
    flag !== -1 ? process.argv[flag + 1] : join(root, "database", "supabase", "migrations");
  const findings = checkMigrationsFolder(dir);
  for (const f of findings) console.log(`FAIL ${f}`);
  console.log(`STATUS=${findings.length === 0 ? "PASS" : "FAIL"}`);
  process.exit(findings.length === 0 ? 0 : 1);
}
