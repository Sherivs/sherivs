#!/usr/bin/env node
/** Run the RLS isolation check against the approved dev project. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const projectRef = "nwrflbpbhyiqdptmlccm";
const envFile = readFileSync(join(root, ".env.local"), "utf8");
let token = "";
for (const line of envFile.split(/\r?\n/)) {
  const match = line.trim().match(/^(?:export\s+)?SUPABASE_ACCESS_TOKEN\s*=\s*(.*)$/);
  if (match) token = match[1].trim().replace(/^['"]|['"]$/g, "");
}
if (!token) {
  console.error("BLOCKED_NO_CREDENTIAL SUPABASE_ACCESS_TOKEN is missing from .env.local.");
  process.exit(2);
}

const sql = readFileSync(join(root, "database/queries/rls-isolation-check.sql"), "utf8")
  .split(/\r?\n/)
  .filter((line) => !line.trim().startsWith("\\"))
  .join("\n");

const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ query: sql }),
});
const text = await res.text();
const safe = text.replace(/sbp_[A-Za-z0-9_\-]+/g, "[redacted]");
let rows = [];
try {
  rows = JSON.parse(text);
} catch {
  rows = null;
}
if (!res.ok) {
  console.error(`FAIL HTTP ${res.status} ${safe.slice(0, 500)}`);
  process.exit(1);
}
const failures = Array.isArray(rows)
  ? rows.filter((row) => String(row?.issue ?? "").startsWith("FAIL"))
  : [];
if (failures.length > 0) {
  console.error(JSON.stringify(failures, null, 2));
  process.exit(1);
}
console.log(Array.isArray(rows) ? JSON.stringify(rows) : safe.slice(0, 2000));
console.log("RLS_ISOLATION_CHECK=PASS");
