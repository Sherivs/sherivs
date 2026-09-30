#!/usr/bin/env node
/**
 * CoreGrid — live kernel-wiring verification (post-migration, DB-backed).
 *
 * Uses the REAL authored modules (bundled via esbuild from the repo TS) so the
 * rows written are produced by the same pure code the server functions use:
 *   - register-runtime: SCHOLAR_RUNTIME_MANIFEST → registryRowFromManifest
 *   - kernel-reality:   eventDraft (recordEvent path)
 *
 * Executed against the target Supabase project over REST:
 *   - substrate table presence (service role)
 *   - deny-by-default for anon on cg_* tables
 *   - register runtime:scholar (idempotent upsert, status proposed)
 *   - CHECK constraint probe (invalid status must be rejected)
 *   - event insert with idempotency key + duplicate replay (must be rejected)
 *
 * Env (never hard-coded): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * SUPABASE_ANON_KEY.
 */
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { buildSync } from "esbuild";
import { createClient } from "@supabase/supabase-js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY;
if (!url || !serviceKey || !anonKey) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY required.");
  process.exit(2);
}

/* ---------- 1. Bundle the real authored kernel modules ---------- */
const entry = `
import { SCHOLAR_RUNTIME_MANIFEST } from "@/lib/runtime/scholar";
import { registryRowFromManifest } from "@/lib/kernel/runtime-registry";
import { eventDraft } from "@/lib/kernel/reality";
export const scholarManifest = SCHOLAR_RUNTIME_MANIFEST;
export const buildRegistryRow = registryRowFromManifest;
export const buildEvent = eventDraft;
`;
const built = buildSync({
  stdin: { contents: entry, resolveDir: ROOT, sourcefile: "verify-entry.ts", loader: "ts" },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  alias: { "@": join(ROOT, "frontend", "src") },
});
const tmpBundle = join(ROOT, "scripts", ".tmp-kernel-wiring.mjs");
writeFileSync(tmpBundle, built.outputFiles[0].text);
const kernel = await import(pathToFileURL(tmpBundle).href + `?t=${Date.now()}`);
rmSync(tmpBundle, { force: true });

/* ---------- 2. Clients ---------- */
const svc = createClient(url, serviceKey, { auth: { persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

/* ---------- 3. Substrate presence + deny-by-default ---------- */
for (const table of [
  "cg_entity",
  "cg_relationship",
  "cg_event",
  "cg_observation",
  "cg_domain_runtime",
]) {
  const { error } = await svc.from(table).select("id").limit(1);
  check(`table ${table} readable (service role)`, !error, error?.message ?? "ok");
}
{
  const { error } = await anon.from("cg_entity").select("id").limit(1);
  check(
    "anon denied on cg_entity (deny-by-default)",
    !!error,
    error?.message ?? "UNEXPECTED ALLOW",
  );
}

/* ---------- 4. Register runtime:scholar (register-runtime DB path) ---------- */
const now = new Date().toISOString();
const row = kernel.buildRegistryRow(kernel.scholarManifest, now, "proposed");
{
  const existing = await svc.from("cg_domain_runtime").select("id").eq("id", row.id).maybeSingle();
  if (existing.error) throw new Error(`pre-check failed: ${existing.error.message}`);
  const upsert = await svc.from("cg_domain_runtime").upsert(
    {
      id: row.id,
      name: row.name,
      version: row.version,
      status: row.status,
      manifest: row.manifest,
      updated_at: now,
    },
    { onConflict: "id" },
  );
  check("register runtime:scholar upsert", !upsert.error, upsert.error?.message ?? row.id);
  const read = await svc
    .from("cg_domain_runtime")
    .select("id,name,version,status")
    .eq("id", row.id)
    .single();
  check(
    "runtime:scholar row persisted (status proposed)",
    !read.error && read.data.status === "proposed" && read.data.version === "0.1.0",
    read.error?.message ?? JSON.stringify(read.data),
  );
}

/* ---------- 5. CHECK constraint probe (invalid status rejected) ---------- */
{
  const { error } = await svc
    .from("cg_domain_runtime")
    .insert({ id: "runtime:invalid-probe", name: "probe", version: "1.0.0", status: "bogus" });
  check("invalid status rejected by CHECK", !!error, error?.message ?? "UNEXPECTED ALLOW");
}

/* ---------- 6. Event insert + idempotency replay (recordEvent DB path) ---------- */
{
  const ev = kernel.buildEvent(
    {
      eventType: "kernel.wiring.verify",
      aggregateType: "runtime:scholar",
      aggregateId: "wiring-verify-1",
      actorIdentity: "verify-script",
      tenantId: "demo-tenant",
      idempotencyKey: "wiring-verify-key-001",
      payload: { note: "live kernel wiring verification" },
    },
    now,
  );
  const ins = await svc.from("cg_event").insert(ev).select("id").single();
  check("cg_event insert (state=pending)", !ins.error, ins.error?.message ?? ins.data?.id);
  const replay = await svc.from("cg_event").insert(ev);
  const duplicated = !!replay.error && /duplicate key/i.test(replay.error.message);
  check(
    "idempotency replay rejected (duplicate)",
    duplicated,
    replay.error?.message ?? "UNEXPECTED",
  );
  // Cleanup test event only (scholar registration row is intentionally kept).
  const del = await svc.from("cg_event").delete().eq("idempotency_key", "wiring-verify-key-001");
  if (del.error) console.error(`cleanup note: ${del.error.message}`);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\nKernel wiring verification: ${results.length - failed}/${results.length} passed.`);
process.exit(failed === 0 ? 0 : 1);
