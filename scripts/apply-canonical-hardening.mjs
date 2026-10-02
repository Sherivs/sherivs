#!/usr/bin/env node
/**
 * CoreGrid — TEAM 3 hardening apply: MISSION-R-100 continuation (V1CAP-072).
 * Applies the eight Team-1 hardening migrations (20261002000005..20261002000012)
 * to the canonical environment and records declared-vs-applied state truth.
 *
 * Pattern: byte-for-byte the checksummed-apply exemplar
 * scripts/apply-canonical-mr100.mjs — sha256 per migration, rollback checksum
 * binding, ALREADY_APPLIED / MIXED detection, dependency-order stop-at-first-
 * failure, post-apply catalog re-verification, declared-vs-applied record.
 *
 * Transport: the authorized Supabase Management API query channel. The token
 * is read from SUPABASE_ACCESS_TOKEN ONLY and is never printed. No direct
 * Postgres connection is opened, so no CA cert is needed and the TLS posture
 * (COREGRID_DB_INSECURE_TLS must never be set) is untouched.
 *
 * Stage-1-specific post-apply verification: every table the eight migrations
 * declare must exist with rowsecurity = true and ZERO policies (deny-by-default
 * posture carried into canonical; the battery re-proves it live in Stage 3).
 *
 * Honesty rules (mission law):
 * - Exclusive canonical access: serialized, one canonical command at a time,
 *   never concurrent with another canonical operation.
 * - Idempotent-by-detection: all declared signature objects present →
 *   ALREADY_APPLIED and skipped; a MIXED (partially applied) state FAILS the
 *   run — partial state needs a human decision, never a silent re-run.
 * - A migration is "applied" only when its declared objects verify in-catalog.
 *
 * Usage: SUPABASE_ACCESS_TOKEN=... node scripts/apply-canonical-hardening.mjs [project-ref]
 * Exit codes: 0 applied/verified · 1 FINDING · 2 BLOCKED_NO_CREDENTIAL.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MIGRATIONS_DIR = join(ROOT, "database", "supabase", "migrations");
const ROLLBACKS_DIR = join(ROOT, "database", "supabase", "rollbacks");
const RECORD_PATH = join(ROOT, "architecture", "proofs", "CANONICAL_APPLY_RECORD_HARDENING.json");
const ARTIFACTS_DIR = "/opt/cursor/artifacts";

const token = process.env.SUPABASE_ACCESS_TOKEN;
const projectRef = process.argv[2] ?? "nwrflbpbhyiqdptmlccm";
if (!token) {
  console.error("BLOCKED_NO_CREDENTIAL SUPABASE_ACCESS_TOKEN is not set. Nothing was applied.");
  process.exit(2);
}

const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;

async function query(sql) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`management api ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/**
 * The Team-1 hardening migrations in dependency order, each with the DECLARED
 * signature objects that prove application. These eight migrations declare
 * tables and indexes only (no functions, no triggers, no policies — verified
 * by source scan); each also ENABLEs RLS and REVOKEs from anon/authenticated.
 */
const MIGRATIONS = [
  {
    file: "20261002000005_coregrid_v1_reconciliation.sql",
    mission: "MISSION-R-100 continuation — reconciliation substrate",
    declared: {
      columns: [],
      indexes: [
        "cg_reconciliation_verdict_tenant_idx",
        "cg_reconciliation_verdict_coordinate_idx",
        "cg_reconciliation_input_tenant_idx",
      ],
      tables: ["cg_reconciliation_verdict", "cg_reconciliation_input"],
      functions: [],
      triggers: [],
    },
  },
  {
    file: "20261002000006_coregrid_v1_event_security.sql",
    mission: "MISSION-R-100 continuation — event security substrate",
    declared: {
      columns: [],
      indexes: [
        "cg_event_security_tenant_idx",
        "cg_event_security_digest_idx",
        "cg_event_security_denial_tenant_idx",
        "cg_event_security_denial_event_idx",
        "cg_event_security_redaction_tenant_idx",
        "cg_event_security_redaction_event_idx",
      ],
      tables: ["cg_event_security", "cg_event_security_denial", "cg_event_security_redaction"],
      functions: [],
      triggers: [],
    },
  },
  {
    file: "20261002000007_coregrid_v1_event_routing.sql",
    mission: "MISSION-R-100 continuation — event routing substrate",
    declared: {
      columns: [],
      indexes: [
        "cg_event_route_subscription_tenant_idx",
        "cg_event_route_subscription_subscriber_idx",
        "cg_event_route_queue_pending_idx",
        "cg_event_route_outcome_tenant_idx",
        "cg_event_route_outcome_subscription_idx",
        "cg_event_route_outcome_kind_idx",
      ],
      tables: [
        "cg_event_route_subscription",
        "cg_event_route_queue",
        "cg_event_route_cursor",
        "cg_event_route_outcome",
      ],
      functions: [],
      triggers: [],
    },
  },
  {
    file: "20261002000008_coregrid_v1_evidence_lifecycle.sql",
    mission: "MISSION-R-100 continuation — evidence lifecycle substrate",
    declared: {
      columns: [],
      indexes: [
        "cg_evidence_record_tenant_idx",
        "cg_evidence_record_retention_idx",
        "cg_evidence_record_supersedes_idx",
        "cg_evidence_record_revokes_idx",
        "cg_evidence_record_window_idx",
        "cg_evidence_lifecycle_act_tenant_idx",
        "cg_evidence_lifecycle_act_target_idx",
      ],
      tables: ["cg_evidence_record", "cg_evidence_lifecycle_act"],
      functions: [],
      triggers: [],
    },
  },
  {
    file: "20261002000009_coregrid_v1_reasoning_provenance.sql",
    mission: "MISSION-R-100 continuation — reasoning provenance substrate",
    declared: {
      columns: [],
      indexes: [
        "cg_reasoning_provenance_snapshot_tenant_idx",
        "cg_reasoning_provenance_snapshot_model_idx",
      ],
      tables: ["cg_reasoning_provenance_snapshot"],
      functions: [],
      triggers: [],
    },
  },
  {
    file: "20261002000010_coregrid_v1_cost_attribution.sql",
    mission: "MISSION-R-100 continuation — cost attribution substrate",
    declared: {
      columns: [],
      indexes: [
        "cg_usage_attribution_rollup_tenant_idx",
        "cg_usage_attribution_bucket_tenant_idx",
      ],
      tables: ["cg_usage_attribution_rollup", "cg_usage_attribution_bucket"],
      functions: [],
      triggers: [],
    },
  },
  {
    file: "20261002000011_coregrid_v1_knowledge_currency.sql",
    mission: "MISSION-R-100 continuation — knowledge currency substrate",
    declared: {
      columns: [],
      indexes: [
        "cg_knowledge_source_tenant_idx",
        "cg_knowledge_freshness_contract_tenant_idx",
        "cg_knowledge_freshness_contract_source_idx",
        "cg_knowledge_invalidation_tenant_idx",
        "cg_knowledge_downgrade_tenant_idx",
      ],
      tables: [
        "cg_knowledge_source",
        "cg_knowledge_freshness_contract",
        "cg_knowledge_invalidation",
        "cg_knowledge_downgrade",
      ],
      functions: [],
      triggers: [],
    },
  },
  {
    file: "20261002000012_coregrid_v1_tool_runtime.sql",
    mission: "MISSION-R-100 continuation — tool runtime substrate",
    declared: {
      columns: [],
      indexes: [
        "cg_tool_runtime_tool_tenant_idx",
        "cg_tool_runtime_invocation_tenant_idx",
        "cg_tool_runtime_invocation_tool_idx",
        "cg_tool_runtime_invocation_outcome_idx",
      ],
      tables: ["cg_tool_runtime_tool", "cg_tool_runtime_invocation"],
      functions: [],
      triggers: [],
    },
  },
  {
    file: "20261002000013_coregrid_v1_neutral_membership_policies.sql",
    mission: "TEAM 3 Stage 2 — J-005/J-006 neutral tenant-membership RLS policies (FORCE RLS + tenant-scoped predicates on the neutral primitives)",
    declared: {
      columns: [],
      indexes: [],
      tables: [],
      functions: [],
      triggers: [],
      policies: [
        "cg_role_assignment.role_assignment_select_own_tenant",
        "cg_role_assignment.role_assignment_insert_tenant_admin",
        "cg_role_assignment.role_assignment_update_tenant_admin",
        "cg_role_grant.role_grant_select_own_tenant",
        "cg_role_grant.role_grant_insert_tenant_admin",
        "cg_role_grant.role_grant_update_tenant_admin",
        "cg_org_membership.org_membership_select_own_tenant",
        "cg_org_membership.org_membership_insert_tenant_admin",
        "cg_org_membership.org_membership_update_tenant_admin",
      ],
    },
  },
];

const report = (line, log) => {
  process.stdout.write(line + "\n");
  log.push(line);
};

// ── catalog presence probes (read-only) ─────────────────────────────────────
async function probeCatalog() {
  const state = { tables: new Set(), columns: new Map(), functions: new Set(), triggers: new Set(), indexes: new Set(), policies: new Set() };
  const rows = await query(`SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public'`);
  for (const r of rows) state.tables.add(r.tablename);

  const polRows = await query(`SELECT tablename, policyname FROM pg_catalog.pg_policies WHERE schemaname='public'`);
  for (const r of polRows) state.policies.add(`${r.tablename}.${r.policyname}`);

  const fnRows = await query(
    `SELECT DISTINCT proname FROM pg_catalog.pg_proc WHERE pronamespace='public'::regnamespace`,
  );
  for (const r of fnRows) state.functions.add(r.proname);

  const trigRows = await query(
    `SELECT tgname FROM pg_catalog.pg_trigger tg
     JOIN pg_catalog.pg_class rel ON rel.oid = tg.tgrelid
     JOIN pg_catalog.pg_namespace ns ON ns.oid = rel.relnamespace
     WHERE ns.nspname='public' AND NOT tg.tgisinternal`,
  );
  for (const r of trigRows) state.triggers.add(r.tgname);

  const idxRows = await query(`SELECT indexname FROM pg_catalog.pg_indexes WHERE schemaname='public'`);
  for (const r of idxRows) state.indexes.add(r.indexname);

  return state;
}

function presenceFor(migration, catalog) {
  const missing = [];
  const present = [];
  for (const t of migration.declared.tables) {
    (catalog.tables.has(t) ? present : missing).push(`table:${t}`);
  }
  for (const idx of migration.declared.indexes) {
    (catalog.indexes.has(idx) ? present : missing).push(`index:${idx}`);
  }
  for (const f of migration.declared.functions) {
    (catalog.functions.has(f) ? present : missing).push(`function:${f}`);
  }
  for (const tg of migration.declared.triggers) {
    (catalog.triggers.has(tg) ? present : missing).push(`trigger:${tg}`);
  }
  for (const pol of migration.declared.policies ?? []) {
    (catalog.policies.has(pol) ? present : missing).push(`policy:${pol}`);
  }
  return { present, missing };
}

// ── run ─────────────────────────────────────────────────────────────────────
const log = [];
const startedAtIso = new Date().toISOString();
console.log(`COREGRID HARDENING APPLY (MISSION-R-100 continuation) — canonical project=${projectRef}`);
console.log(`exclusive-access law: serialized, one canonical operation at a time; no other canonical work runs concurrently.`);

let findings = 0;
const migrations = [];

let catalog;
try {
  catalog = await probeCatalog();
} catch (err) {
  console.error(`BLOCKED catalog probe failed: ${err.message}`);
  process.exit(1);
}

for (const migration of MIGRATIONS) {
  const sqlPath = join(MIGRATIONS_DIR, migration.file);
  const sql = readFileSync(sqlPath, "utf8");
  const checksum = sha256(sql);

  let rollbackChecksum = null;
  try {
    rollbackChecksum = sha256(readFileSync(join(ROLLBACKS_DIR, migration.file), "utf8"));
  } catch {
    findings += 1;
    report(`FINDING ${migration.file}: rollback file missing — a rollback plan is mandatory (Constitution §38).`, log);
  }

  const { present, missing } = presenceFor(migration, catalog);
  const entry = {
    file: migration.file,
    mission: migration.mission,
    checksum,
    rollbackChecksum,
    declaredObjectCount: present.length + missing.length,
  };

  if (missing.length === 0) {
    entry.state = "ALREADY_APPLIED";
    entry.evidence = `all ${present.length} declared objects present (pre-flight catalog probe)`;
    report(`SKIP  ${migration.file} — ALREADY_APPLIED (${present.length}/${present.length} declared objects present)`, log);
  } else if (present.length === 0) {
    report(`APPLY ${migration.file} — ${migration.mission} (checksum ${checksum.slice(0, 12)}…)`, log);
    const t0 = Date.now();
    try {
      await query(sql);
      entry.state = "APPLIED";
      entry.elapsedMs = Date.now() - t0;
      report(`OK    ${migration.file} (${entry.elapsedMs}ms)`, log);
    } catch (err) {
      entry.state = "APPLY_FAILED";
      entry.error = err.message;
      findings += 1;
      report(`FAIL  ${migration.file}: ${err.message}`, log);
      migrations.push(entry);
      break; // dependency order: stop at the first failure, never skip ahead
    }
  } else {
    entry.state = "MIXED_PARTIALLY_APPLIED";
    entry.presentCount = present.length;
    entry.missingSample = missing.slice(0, 10);
    findings += 1;
    report(`FINDING ${migration.file}: partially applied state (${present.length} present / ${missing.length} missing) — human decision required, refusing to re-run.`, log);
    migrations.push(entry);
    break;
  }
  migrations.push(entry);
}

// ── post-apply verification (catalog re-probe) ──────────────────────────────
let catalog2;
try {
  catalog2 = await probeCatalog();
} catch (err) {
  findings += 1;
  report(`FINDING post-apply catalog probe failed: ${err.message}`, log);
}

const verification = [];
if (catalog2) {
  for (const migration of MIGRATIONS) {
    const { missing } = presenceFor(migration, catalog2);
    const entry = migrations.find((m) => m.file === migration.file);
    if (missing.length === 0) {
      verification.push({ file: migration.file, verified: true, missingCount: 0 });
      if (entry) entry.state = entry.state === "ALREADY_APPLIED" ? "ALREADY_APPLIED" : "APPLIED_AND_VERIFIED";
    } else {
      findings += 1;
      verification.push({ file: migration.file, verified: false, missingSample: missing.slice(0, 10) });
      report(`FINDING ${migration.file}: post-apply verification missing ${missing.length} declared objects.`, log);
    }
  }
}

// ── Stage-1 security verification: deny-by-default posture on every new table ──
const declaredTables = MIGRATIONS.flatMap((m) => m.declared.tables);
// Stage-2 policy-backed tables: RLS on, FORCE on, exactly the declared
// neutral-primitive policies (zero-policy posture no longer applies to them).
const policyBackedTables = [
  { table: "cg_role_assignment", tenantColumn: "tenant_ref" },
  { table: "cg_role_grant", tenantColumn: "tenant_ref" },
  { table: "cg_org_membership", tenantColumn: "tenant_id" },
];
let rlsPosture = null;
const sqlArrayLiteral = (values) =>
  `ARRAY[${values.map((v) => `'${v.replaceAll("'", "''")}'`).join(",")}]::text[]`;
try {
  const probedTables = [...declaredTables, ...policyBackedTables.map((t) => t.table)];
  const rlsRows = await query(
    `SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r'
        AND c.relname = ANY(${sqlArrayLiteral(probedTables)})
      ORDER BY 1`,
  );
  const polRows = await query(
    `SELECT tablename, policyname FROM pg_policies
      WHERE schemaname='public' AND tablename = ANY(${sqlArrayLiteral(probedTables)})`,
  );
  rlsPosture = probedTables.map((t) => {
    const rls = rlsRows.find((r) => r.table_name === t);
    const policies = polRows.filter((p) => p.tablename === t).map((p) => p.policyname);
    const policyBacked = policyBackedTables.some((pb) => pb.table === t);
    const ok = policyBacked
      ? rls?.rls_enabled === true &&
        rls?.rls_forced === true &&
        MIGRATIONS.find((m) => m.file.startsWith("20261002000013")).declared.policies
          .filter((p) => p.startsWith(`${t}.`))
          .every((p) => policies.includes(p.split(".")[1])) &&
        policies.length === 3
      : rls?.rls_enabled === true && policies.length === 0;
    if (!ok) findings += 1;
    report(
      `${ok ? "PASS" : "FINDING"} ${t}: rowsecurity=${rls?.rls_enabled ?? "absent"} rlsforced=${rls?.rls_forced ?? "n/a"} policies=${policyBacked ? policies.join(",") : policies.length}`,
      log,
    );
    return {
      table: t,
      posture: policyBacked ? "policy-backed (J-005/J-006 tenant-scoped)" : "zero-policy (deny-by-default)",
      rlsEnabled: rls?.rls_enabled ?? null,
      rlsForced: rls?.rls_forced ?? null,
      policies: policyBacked ? policies : policies.length,
      ok,
    };
  });
} catch (err) {
  findings += 1;
  report(`FINDING RLS posture probe failed: ${err.message}`, log);
}

const record = {
  mission: "MISSION-R-100 (TEAM 3 hardening continuation)",
  capability: "V1CAP-072",
  gap: "J-040",
  projectRef,
  transport: "supabase-management-api-database-query",
  exclusiveAccess: "serialized — one canonical operation at a time (campaign canonical lock held by TEAM 3)",
  executedAt: startedAtIso,
  completedAt: new Date().toISOString(),
  declaredVsApplied: migrations.map((m) => ({
    file: m.file,
    mission: m.mission,
    state: m.state,
    checksum: m.checksum,
    rollbackChecksum: m.rollbackChecksum,
    declaredObjectCount: m.declaredObjectCount,
    elapsedMs: m.elapsedMs ?? null,
    evidence: m.evidence ?? null,
    error: m.error ?? null,
  })),
  rlsPosture,
  verification,
  findings,
};

const recordJson = JSON.stringify(record, null, 2);
mkdirSync(ARTIFACTS_DIR, { recursive: true });
writeFileSync(RECORD_PATH, recordJson + "\n");
writeFileSync(join(ARTIFACTS_DIR, "canonical-apply-hardening.json"), recordJson);
writeFileSync(join(ARTIFACTS_DIR, "canonical-apply-hardening.log"), log.join("\n") + "\n");
console.log(`posture record: ${RECORD_PATH}`);

if (findings > 0) {
  console.error(`STATUS=FINDINGS (${findings}) — see record. Nothing is claimed applied without catalog verification.`);
  process.exit(1);
}
console.log("STATUS=PASS — migrations applied (or already applied) and catalog-verified: zero-policy deny-by-default holds on the Stage-1 substrate tables; the Stage-2 policy tables carry RLS FORCED with exactly the nine declared neutral-primitive policies.");
