#!/usr/bin/env node
/**
 * CoreGrid — apply database migrations in order via the Supabase Management API.
 *
 * Usage:
 *   $env:SUPABASE_ACCESS_TOKEN="sbp_..." ; node scripts/db-apply-mgmt.mjs [project-ref]
 *
 * Reads the access token from the environment ONLY (never committed). Runs
 * each file in database/supabase/migrations/ (filename order) through
 * POST /v1/projects/{ref}/database/query. Stops at the first failure.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MIGRATIONS_DIR = join(ROOT, "database", "supabase", "migrations");

const token = process.env.SUPABASE_ACCESS_TOKEN;
const projectRef = process.argv[2] ?? "nwrflbpbhyiqdptmlccm";
if (!token) {
  console.error("SUPABASE_ACCESS_TOKEN is required.");
  process.exit(2);
}

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();
if (files.length === 0) {
  console.error(`No .sql migrations found in ${MIGRATIONS_DIR}`);
  process.exit(2);
}

const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
let failed = false;
for (const file of files) {
  const query = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    });
    const text = await res.text();
    if (!res.ok) {
      failed = true;
      console.error(`FAIL  ${file} [${res.status}] ${text.slice(0, 500)}`);
      break;
    }
    console.log(`OK    ${file}`);
  } catch (err) {
    failed = true;
    console.error(`FAIL  ${file}`);
    console.error(err instanceof Error ? err.message : String(err));
    break;
  }
}

if (failed) {
  console.error("Aborted (see FAIL above).");
  process.exit(1);
}
console.log(`Applied ${files.length} migrations in order via Management API.`);
