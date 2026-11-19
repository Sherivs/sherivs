#!/usr/bin/env node
/**
 * Sherivs migration grant check (mission M0, with SEC-M0 / ADR-101).
 *
 * Once new objects are private by default, a table created without a grant is unreachable. This
 * check fails any migration newer than the SEC-M0 cut-off that creates a table in schema public
 * and never names it in a GRANT or REVOKE statement: access must be an explicit decision.
 * It also fails any migration or proposal, of any age, that grants anything on schema
 * ops_private (or an object in it) to anon, authenticated or PUBLIC: that schema holds rollback
 * snapshots and must stay unreachable by client roles.
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

const CLIENT_ROLE = /\b(anon|authenticated|public)\b/i;

/** GRANT statements that would open schema ops_private, or anything in it, to a client role. */
export function opsPrivateGrants(sql) {
  // Dynamic SQL counts too: a grant written inside a format() or EXECUTE string is still a grant.
  const body = stripComments(sql);
  const findings = [];
  for (const match of body.matchAll(/\bGRANT\b[^;]*?\bTO\b[^;]*/gi)) {
    const statement = match[0];
    const [, target = "", grantees = ""] =
      /\bON\b([\s\S]*?)\bTO\b([\s\S]*)$/i.exec(statement) ?? [];
    if (/\bops_private\b/i.test(target) && CLIENT_ROLE.test(grantees)) {
      findings.push(statement.replace(/\s+/g, " ").trim().slice(0, 160));
    }
  }
  return findings;
}

export function checkOpsPrivate(dirs) {
  const findings = [];
  for (const dir of dirs) {
    for (const file of readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      for (const statement of opsPrivateGrants(readFileSync(join(dir, file), "utf8"))) {
        findings.push(`${file}: grants on ops_private to a client role: ${statement}`);
      }
    }
  }
  return findings;
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
  const findings = [
    ...checkMigrationsFolder(dir),
    ...checkOpsPrivate(flag !== -1 ? [dir] : [dir, join(root, "database", "proposals")]),
  ];
  for (const f of findings) console.log(`FAIL ${f}`);
  console.log(`STATUS=${findings.length === 0 ? "PASS" : "FAIL"}`);
  process.exit(findings.length === 0 ? 0 : 1);
}
