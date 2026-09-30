#!/usr/bin/env node
/**
 * Load SUPABASE_ACCESS_TOKEN from .env.local and apply only the foundation
 * migration to the approved dev project. The token is never printed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const projectRef = "nwrflbpbhyiqdptmlccm";
const migrationPath = join(
  root,
  "database/supabase/migrations/20260929000000_coregrid_foundation_mission_001.sql",
);

function sanitize(text) {
  return String(text).replace(/sbp_[A-Za-z0-9_\-]+/g, "[redacted]");
}

const envFile = readFileSync(join(root, ".env.local"), "utf8");
let token = "";
for (const line of envFile.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const match = trimmed.match(/^(?:export\s+)?SUPABASE_ACCESS_TOKEN\s*=\s*(.*)$/);
  if (!match) continue;
  token = match[1].trim().replace(/^['"]|['"]$/g, "");
}
if (!token) {
  console.error("BLOCKED_NO_CREDENTIAL SUPABASE_ACCESS_TOKEN is missing from .env.local.");
  process.exit(2);
}

async function projectStatus() {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`project status HTTP ${res.status} ${sanitize(text).slice(0, 300)}`);
  const body = JSON.parse(text);
  return body.status ?? "unknown";
}

try {
  let status = await projectStatus();
  console.log(`project_status=${status}`);
  if (status === "INACTIVE" || status === "PAUSED") {
    const restore = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/restore`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    const restoreText = await restore.text();
    if (!restore.ok) {
      throw new Error(`restore HTTP ${restore.status} ${sanitize(restoreText).slice(0, 300)}`);
    }
    console.log("restore requested");
    for (let attempt = 0; attempt < 18; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10000));
      status = await projectStatus();
      console.log(`project_status=${status}`);
      if (status === "ACTIVE_HEALTHY") break;
    }
    if (status !== "ACTIVE_HEALTHY") {
      throw new Error(`project did not become ACTIVE_HEALTHY (status=${status})`);
    }
  }
  if (status === "COMING_UP" || status === "RESTORING") {
    for (let attempt = 0; attempt < 18; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10000));
      status = await projectStatus();
      console.log(`project_status=${status}`);
      if (status === "ACTIVE_HEALTHY") break;
    }
    if (status !== "ACTIVE_HEALTHY") {
      throw new Error(`project did not become ACTIVE_HEALTHY (status=${status})`);
    }
  }

  const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;

  async function query(sql) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${sanitize(text).slice(0, 500)}`);
    }
    return text;
  }

  await query(readFileSync(migrationPath, "utf8"));
  console.log(`OK migration applied project=${projectRef}`);
  const catalog = await query(`
    SELECT c.relname AS table_name, c.relrowsecurity AS rls
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN (
        'cg_mission_intent',
        'cg_execution_record',
        'cg_execution_history',
        'cg_foundation_evidence',
        'cg_verification_result',
        'cg_conformance_assessment'
      )
    ORDER BY 1;
  `);
  console.log(catalog);
  const grants = await query(`
    SELECT table_name, grantee, privilege_type
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND grantee IN ('anon', 'authenticated')
      AND table_name IN (
        'cg_mission_intent',
        'cg_execution_record',
        'cg_execution_history',
        'cg_foundation_evidence',
        'cg_verification_result',
        'cg_conformance_assessment'
      )
    ORDER BY 1, 2, 3;
  `);
  console.log(grants === "[]" ? "OK anon/authenticated grants: none" : grants);
  const probe = await query(`
    BEGIN;
    INSERT INTO public.cg_mission_intent (
      mission_id, version, tenant_id, purpose, authority_ref, context_ref, owner_ref, lifecycle
    ) VALUES (
      'foundation-probe', '1', 'probe-tenant', 'probe', 'CONTROL-PLANE-06', 'context-probe', 'MISSIONS.md', 'authorized'
    );
    INSERT INTO public.cg_execution_record (
      id, idempotency_key, mission_id, mission_version, tenant_id, actor_id, action,
      reality_ref, requested_at, attempt_id, started_at, status, external_effect
    ) VALUES (
      'probe-exec', 'probe-idem-12345678', 'foundation-probe', '1', 'probe-tenant', 'probe-actor',
      'record-observation', '11111111-1111-4111-8111-111111111111', now(), 'probe-exec:1', now(),
      'admitted', 'recorded_intent'
    );
    INSERT INTO public.cg_foundation_evidence (
      evidence_id, producer, actor_id, tenant_id, observed_at, recorded_at, provenance, integrity, lifecycle
    ) VALUES (
      'probe-exec:evidence', 'foundation-probe', 'probe-actor', 'probe-tenant', now(), now(),
      'cg_entity:probe', 'probe-integrity', 'active'
    );
    INSERT INTO public.cg_verification_result (
      verification_id, execution_id, evidence_ids, decision, reason
    ) VALUES (
      'probe-exec:verification', 'probe-exec', ARRAY['probe-exec:evidence'], 'verified',
      'independent_criteria_and_evidence'
    );
    ROLLBACK;
    SELECT count(*)::int AS mission_rows FROM public.cg_mission_intent WHERE mission_id = 'foundation-probe';
  `);
  console.log(probe);
  const history = await query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'supabase_migrations'
      AND table_name = 'schema_migrations'
    ORDER BY ordinal_position;
  `);
  console.log(history);
  const versions = await query(`
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE tablename ILIKE '%migration%'
    ORDER BY 1, 2;
  `);
  console.log(versions);
} catch (error) {
  console.error(`FAIL ${sanitize(error instanceof Error ? error.message : String(error))}`);
  process.exit(1);
}
