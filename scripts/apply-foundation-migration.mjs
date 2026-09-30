#!/usr/bin/env node
/**
 * Apply only the Foundation Mission 001 migration to the approved dev project.
 * Token is read from SUPABASE_ACCESS_TOKEN. The value is never printed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const token = process.env.SUPABASE_ACCESS_TOKEN;
const projectRef = process.argv[2] ?? "nwrflbpbhyiqdptmlccm";
const file = "database/supabase/migrations/20260929000000_coregrid_foundation_mission_001.sql";

if (!token) {
  console.error(
    "BLOCKED_NO_CREDENTIAL SUPABASE_ACCESS_TOKEN is not set. Migration was not applied.",
  );
  process.exit(2);
}

const query = readFileSync(join(root, file), "utf8");
const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
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
  console.error(`FAIL ${file} [${res.status}] ${text.slice(0, 500)}`);
  process.exit(1);
}
console.log(`OK ${file} project=${projectRef}`);
