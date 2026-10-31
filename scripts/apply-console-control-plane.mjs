#!/usr/bin/env node
/**
 * Apply Internal Console control-plane migrations in order:
 *   SHERIVS-030, SHERIVS-031, SHERIVS-032
 *
 * Usage:
 *   SHERIVS_DATABASE_TARGET=production \
 *   SHERIVS_CONFIRM_PRODUCTION=nwrflbpbhyiqdptmlccm \
 *   PRODUCTION_DATABASE_URL="postgresql://..." \
 *     node scripts/apply-console-control-plane.mjs [--dry-run]
 *
 * Production operations refuse unscoped DATABASE_URL. Staging is not used.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { pgSslConfig } from "./lib/pg-ssl.mjs";
import { requirePostgresTarget } from "./lib/sherivs-db-target.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FILES = [
  "database/supabase/migrations/20261027001000_sherivs_030_internal_console.sql",
  "database/supabase/migrations/20261027002000_sherivs_031_control_plane_engines.sql",
  "database/supabase/migrations/20261027003000_sherivs_032_control_plane_operations.sql",
];
const dryRun = process.argv.includes("--dry-run");
const resolved = requirePostgresTarget();

if (dryRun) {
  console.log(`DRY RUN target=${resolved.target} source=${resolved.sourceName}`);
  for (const file of FILES) {
    const sql = readFileSync(join(ROOT, file), "utf8");
    console.log(`  ${file} bytes=${Buffer.byteLength(sql, "utf8")}`);
  }
  process.exit(0);
}

const pg = await import("pg").catch(() => null);
if (!pg) {
  console.error("The 'pg' driver is not installed.");
  process.exit(2);
}

const client = new pg.default.Client({
  connectionString: resolved.connectionString,
  ssl: pgSslConfig(resolved.connectionString),
});
await client.connect();
try {
  for (const file of FILES) {
    const version = file.split("/").pop().slice(0, 14);
    const already = await client.query(
      `SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = $1`,
      [version],
    );
    if (already.rowCount > 0) {
      console.log(`SKIP  ${file} (already recorded)`);
      continue;
    }
    const sql = readFileSync(join(ROOT, file), "utf8");
    await client.query(sql);
    await client.query(
      `INSERT INTO supabase_migrations.schema_migrations (version) VALUES ($1)
       ON CONFLICT (version) DO NOTHING`,
      [version],
    );
    console.log(`OK    ${file}`);
  }
  console.log(`Applied console control-plane migrations to ${resolved.target}.`);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
} finally {
  await client.end();
}
