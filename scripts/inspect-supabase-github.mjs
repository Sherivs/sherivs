#!/usr/bin/env node
/** Print non-secret Supabase project and GitHub-integration fields. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const envFile = readFileSync(join(root, ".env.local"), "utf8");
let token = "";
for (const line of envFile.split(/\r?\n/)) {
  const match = line.trim().match(/^(?:export\s+)?SUPABASE_ACCESS_TOKEN\s*=\s*(.*)$/);
  if (match) token = match[1].trim().replace(/^['"]|['"]$/g, "");
}
if (!token) {
  console.error("BLOCKED_NO_CREDENTIAL");
  process.exit(2);
}
const projectRef = "nwrflbpbhyiqdptmlccm";
const headers = { Authorization: `Bearer ${token}` };

async function get(path) {
  const res = await fetch(`https://api.supabase.com/v1${path}`, { headers });
  const text = await res.text();
  return { status: res.status, text };
}

const project = await get(`/projects/${projectRef}`);
let summary = { http: project.status };
try {
  const body = JSON.parse(project.text);
  summary = {
    http: project.status,
    keys: Object.keys(body),
    id: body.id,
    name: body.name,
    status: body.status,
    region: body.region,
    organization_slug: body.organization_slug,
  };
} catch {
  summary.detail = project.text.replace(/sbp_[A-Za-z0-9_\-]+/g, "[redacted]").slice(0, 200);
}
console.log(JSON.stringify(summary));

for (const path of [
  `/organizations/fpazvxvojdlxqtebscac/integrations`,
  `/organizations/fpazvxvojdlxqtebscac/github`,
  `/projects/${projectRef}/branches`,
  `/branches/f6da6c71-bd1c-45e0-9a6d-166fff5c0f54`,
  `/projects/${projectRef}/config/database`,
]) {
  const result = await get(path);
  const safe = result.text
    .replace(/sbp_[A-Za-z0-9_\-]+/g, "[redacted]")
    .replace(/postgres(?:ql)?:\/\/[^\s"\\]+/gi, "[redacted-url]")
    .replace(
      /"(?:db_pass|password|connectionString|connection_string)"\s*:\s*"[^"]*"/gi,
      '"secret":"[redacted]"',
    );
  console.log(`\nGET ${path} HTTP ${result.status}\n${safe.slice(0, 1200)}`);
}
