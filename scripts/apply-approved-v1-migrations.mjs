#!/usr/bin/env node
/**
 * CoreGrid — apply the CTO-approved V1 migrations to the approved dev project.
 *
 * Authority: CTO DIRECTIVE Part 30 ("CURRENT MIGRATIONS") explicitly approves
 * these two files for the development vertical slice. This script applies ONLY
 * those files, in order, via the authorized Supabase management-API query
 * endpoint (same governed path as apply-foundation-migration.mjs).
 *
 * Token is read from SUPABASE_ACCESS_TOKEN. The value is never printed.
 * No other migration is applied by this script.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const token = process.env.SUPABASE_ACCESS_TOKEN;
const projectRef = process.argv[2] ?? "nwrflbpbhyiqdptmlccm";

const APPROVED = [
  "database/supabase/migrations/20260930000000_coregrid_v1_workspace_persistence.sql",
  "database/supabase/migrations/20261001000000_coregrid_v1_org_model.sql",
];

if (!token) {
  console.error(
    "BLOCKED_NO_CREDENTIAL SUPABASE_ACCESS_TOKEN is not set. Migrations were not applied.",
  );
  process.exit(2);
}

const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;

let failed = false;
for (const file of APPROVED) {
  const query = readFileSync(join(root, file), "utf8");
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
    console.error(`FAIL ${file} [${res.status}] ${text.slice(0, 500)}`);
    break;
  }
  console.log(`OK ${file} project=${projectRef}`);
}

if (failed) process.exit(1);
console.log(`Applied ${APPROVED.length} CTO-approved V1 migrations in order.`);
