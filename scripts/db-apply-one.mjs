#!/usr/bin/env node
/**
 * CoreGrid — apply ONE database migration via node-postgres.
 *
 * The full bootstrap path is `scripts/db-apply.mjs` (every migration in order).
 * This runner exists for the change-management case: applying a single authored
 * migration to an environment that is already provisioned, and recording which
 * file was applied.
 *
 * Usage:
 *   $env:DATABASE_URL="postgresql://..." ; node scripts/db-apply-one.mjs 20260907000800
 *   $env:DATABASE_URL="postgresql://..." ; node scripts/db-apply-one.mjs 20260907000800_ --dry-run
 *
 * Reads DATABASE_URL from the environment ONLY (never hard-coded, never
 * committed). The argument is a filename prefix; exactly one migration must
 * match, so a typo can never apply the wrong file. `--dry-run` reports the
 * resolved file without executing it.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { pgSslConfig } from "./lib/pg-ssl.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MIGRATIONS_DIR = join(ROOT, "database", "supabase", "migrations");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const prefix = args.find((arg) => !arg.startsWith("--"));

if (!prefix) {
  console.error("Usage: node scripts/db-apply-one.mjs <filename-prefix> [--dry-run]");
  process.exit(2);
}

const matches = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql") && f.startsWith(prefix))
  .sort();

if (matches.length === 0) {
  console.error(`No migration matches prefix "${prefix}" in ${MIGRATIONS_DIR}`);
  process.exit(2);
}
if (matches.length > 1) {
  console.error(`Prefix "${prefix}" is ambiguous — it matches ${matches.length} migrations:`);
  for (const match of matches) console.error(`  ${match}`);
  process.exit(2);
}

const file = matches[0];
const path = join(MIGRATIONS_DIR, file);

if (dryRun) {
  const sql = readFileSync(path, "utf8");
  console.log(`DRY RUN  ${file}`);
  console.log(`  bytes:   ${Buffer.byteLength(sql, "utf8")}`);
  console.log(`  lines:   ${sql.split("\n").length}`);
  console.log("  no statement was executed (--dry-run).");
  process.exit(0);
}

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("DATABASE_URL is required (postgres connection string).");
  console.error("Nothing was applied — the migration is authored, not deployed.");
  process.exit(2);
}

const pg = await import("pg").catch(() => null);
if (!pg) {
  console.error("The 'pg' driver is not installed. Run `npm i -D pg` and retry.");
  process.exit(2);
}

const client = new pg.default.Client({
  connectionString: dbUrl,
  ssl: pgSslConfig(dbUrl),
});

await client.connect();
try {
  const sql = readFileSync(path, "utf8");
  await client.query(sql);
  console.log(`OK    ${file}`);
  console.log("Applied 1 migration (single-file runner).");
} catch (err) {
  console.error(`FAIL  ${file}`);
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
} finally {
  await client.end();
}
