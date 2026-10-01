#!/usr/bin/env node
/**
 * CoreGrid — apply database migrations in order via node-postgres.
 *
 * Usage:
 *   $env:DATABASE_URL="postgresql://..." ; node scripts/db-apply.mjs
 *
 * Reads DATABASE_URL from the environment ONLY (never hard-coded, never
 * committed). Applies every file in database/supabase/migrations/ in filename
 * order, one query per file. Stops at the first failure.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { pgSslConfig } from "./lib/pg-ssl.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MIGRATIONS_DIR = join(ROOT, "database", "supabase", "migrations");

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("DATABASE_URL is required (postgres connection string).");
  process.exit(2);
}

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();
if (files.length === 0) {
  console.error(`No .sql migrations found in ${MIGRATIONS_DIR}`);
  process.exit(2);
}

const client = new pg.Client({
  connectionString: dbUrl,
  ssl: pgSslConfig(dbUrl),
});
await client.connect();

let failed = false;
for (const file of files) {
  const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
  try {
    await client.query(sql);
    console.log(`OK    ${file}`);
  } catch (err) {
    failed = true;
    console.error(`FAIL  ${file}`);
    console.error(err instanceof Error ? err.message : String(err));
    break;
  }
}

await client.end();
if (failed) {
  console.error(`Aborted after ${files.length} migrations (see FAIL above).`);
  process.exit(1);
}
console.log(`Applied ${files.length} migrations in order.`);
