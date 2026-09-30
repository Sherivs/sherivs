#!/usr/bin/env node
/**
 * CoreGrid — event-fabric delivery pass (S3, one-shot worker).
 *
 * Governed, observable one-pass delivery over the live `cg_event` outbox:
 *   1. summary of queue state;
 *   2. claim up to LIMIT `pending` events (oldest first);
 *   3. transition each via the REAL `kernel/outbox.ts` pure logic:
 *        pending → published   (delivery attempt)
 *        published → acknowledged  when payload.delivery === "auto-ack"
 *      (bounded: MAX_ATTEMPTS governs fail→dead; fail/requeue actions are the
 *       caller's decision — this pass never fabricates a delivery result);
 *   4. report transitions + final summary.
 *
 * Designed to be the same code a pg_cron/scheduler would invoke periodically.
 * Uses the service-role client (cg_* RLS is deny-by-default for end users).
 *
 * Env (never hard-coded): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 * Optional: EVENT_FABRIC_LIMIT (default 25), EVENT_FABRIC_MAX_ATTEMPTS (default 3).
 */
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildSync } from "esbuild";
import { createClient } from "@supabase/supabase-js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(2);
}

const LIMIT = Number(process.env.EVENT_FABRIC_LIMIT ?? 25);
const MAX_ATTEMPTS = Number(process.env.EVENT_FABRIC_MAX_ATTEMPTS ?? 3);

/* Bundle the real kernel outbox module so transitions are code-faithful. */
const built = buildSync({
  stdin: {
    contents: `import { nextEventState } from "@/lib/kernel/outbox";
export const next = nextEventState;`,
    resolveDir: ROOT,
    sourcefile: "event-fabric-entry.ts",
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  alias: { "@": join(ROOT, "frontend", "src") },
});
const tmpBundle = join(ROOT, "scripts", ".tmp-event-fabric.mjs");
writeFileSync(tmpBundle, built.outputFiles[0].text);
const { next } = await import(pathToFileURL(tmpBundle).href + `?t=${Date.now()}`);
rmSync(tmpBundle, { force: true });

const svc = createClient(url, serviceKey, { auth: { persistSession: false } });

async function summary(label) {
  const { data, error } = await svc.from("cg_event").select("state");
  if (error) throw new Error(`summary failed: ${error.message}`);
  const tally = {};
  for (const row of data ?? []) tally[row.state] = (tally[row.state] ?? 0) + 1;
  console.log(`${label}: ${JSON.stringify(tally)}`);
  return tally;
}

/* ---------- claim pending events (oldest first) ---------- */
const { data: pending, error: claimErr } = await svc
  .from("cg_event")
  .select("id, state, attempts, payload")
  .eq("state", "pending")
  .order("occurred_at", { ascending: true })
  .limit(LIMIT);
if (claimErr) throw new Error(`claim failed: ${claimErr.message}`);
const rows = pending ?? [];

console.log(
  `\nEvent-fabric pass: ${rows.length} pending event(s) claimed (limit ${LIMIT}, maxAttempts ${MAX_ATTEMPTS}).`,
);
await summary("before");

const transitions = [];
for (const row of rows) {
  const attempts = Number(row.attempts ?? 0);
  const published = next("pending", "publish", attempts, MAX_ATTEMPTS);
  if (published !== "published") {
    console.log(`skip ${row.id}: publish not allowed from pending`);
    continue;
  }
  const { error: pubErr } = await svc
    .from("cg_event")
    .update({ state: "published" })
    .eq("id", row.id);
  if (pubErr) throw new Error(`publish ${row.id}: ${pubErr.message}`);
  transitions.push({ id: row.id, from: "pending", to: "published" });

  const autoAck = row.payload?.delivery === "auto-ack";
  if (autoAck) {
    const acknowledged = next("published", "acknowledge", attempts, MAX_ATTEMPTS);
    if (acknowledged === "acknowledged") {
      const { error: ackErr } = await svc
        .from("cg_event")
        .update({ state: "acknowledged" })
        .eq("id", row.id);
      if (ackErr) throw new Error(`acknowledge ${row.id}: ${ackErr.message}`);
      transitions.push({ id: row.id, from: "published", to: "acknowledged" });
    }
  }
}

for (const t of transitions) console.log(`  ${t.id}  ${t.from} → ${t.to}`);
await summary("after");
console.log(`\nEvent-fabric pass complete: ${transitions.length} transition(s).`);
