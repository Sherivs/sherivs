#!/usr/bin/env node
/**
 * CoreGrid — MISSION-R-100 (J-040 / V1CAP-072): apply the wave-3 cg_* migrations
 * to the canonical environment and record declared-vs-applied state truth.
 *
 * Transport: the authorized Supabase Management API query channel (the same
 * governed path as scripts/apply-approved-v1-migrations.mjs). Token is read
 * from SUPABASE_ACCESS_TOKEN ONLY and is never printed. Direct-Postgres paths
 * belong to scripts/db-apply.mjs + scripts/lib/pg-ssl.mjs TLS policy; this
 * script needs no CA cert because it does not open a Postgres connection.
 *
 * Honesty rules (mission law):
 * - Exclusive canonical access: run serialized with M-R-85/M-R-101, never
 *   concurrently with another canonical-environment mission.
 * - Idempotent-by-detection: a migration whose declared signature objects ALL
 *   exist is reported ALREADY_APPLIED and skipped; a migration in a MIXED
 *   (partially applied) state FAILS the run — partial state needs a human
 *   decision, never a silent re-run.
 * - Every applied migration records its sha256 checksum, and its rollback
 *   file checksum (database/supabase/rollbacks/) so the rollback plan is
 *   checksum-bound.
 * - Post-apply, the declared objects are re-verified from the catalog; the
 *   run writes a declared-vs-applied posture record. A migration is
 *   "applied" only when its declared objects verify.
 *
 * Usage: SUPABASE_ACCESS_TOKEN=... node scripts/apply-canonical-mr100.mjs [project-ref]
 * Exit codes: 0 applied/verified · 1 FINDING · 2 BLOCKED_NO_CREDENTIAL.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MIGRATIONS_DIR = join(ROOT, "database", "supabase", "migrations");
const ROLLBACKS_DIR = join(ROOT, "database", "supabase", "rollbacks");
const RECORD_PATH = join(
  ROOT,
  "architecture",
  "coregrid-mvp-architecture",
  "ratification",
  "CANONICAL_APPLY_RECORD_MR100.json",
);
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
 * The wave-3 migrations in dependency order, each with the DECLARED signature
 * objects that prove application. Signature objects are the minimum honest
 * set: tables (pg_tables), columns (per table), functions, triggers, indexes.
 */
const MIGRATIONS = [
  {
    file: "20260907000800_coregrid_role_assignment_substrate.sql",
    mission: "prerequisite (role-assignment substrate — absent from canonical, required by the neutral tenant primitives)",
    declared: {
      columns: [],
      indexes: ["cg_role_assignment_identity_idx", "cg_role_grant_tenant_idx"],
      triggers: ["cg_role_assignment_touch"],
      tables: ["cg_role_assignment", "cg_role_grant"],
      functions: [
        "list_role_assignments", "assign_role", "end_role_assignment",
        "list_role_grants", "grant_role_capability", "revoke_role_capability",
      ],
    },
  },
  {
    file: "20261002000000_coregrid_v1_kernel_envelope.sql",
    mission: "MISSION-R-10 canonical envelope",
    declared: {
      columns: [
        ["cg_entity", "trace_id"], ["cg_entity", "correlation_id"], ["cg_entity", "causation_id"],
        ["cg_entity", "parent_event_id"], ["cg_entity", "object_type"],
        ["cg_relationship", "trace_id"], ["cg_relationship", "object_type"],
        ["cg_event", "trace_id"], ["cg_event", "parent_event_id"],
        ["cg_observation", "trace_id"], ["cg_observation", "object_type"],
      ],
      indexes: ["cg_entity_object_type_idx", "cg_event_trace_idx", "cg_observation_object_type_idx"],
      functions: [],
      triggers: [],
      tables: [],
    },
  },
  {
    file: "20261002000001_coregrid_v1_neutral_tenant_primitives.sql",
    mission: "MISSION-R-20/21 neutral tenant primitives + universal role vocabulary",
    // Five RPC names in this migration (list/assign/end_workforce_position,
    // get/upsert_org_profile) PRE-EXIST from the 2026090700* runtime
    // migrations and are re-pointed here via CREATE OR REPLACE — their name
    // presence cannot prove application, so the declared signature is the
    // nine genuinely-new functions only.
    declared: {
      columns: [],
      indexes: [],
      triggers: [],
      tables: [],
      functions: [
        "get_my_tenant_id", "holds_tenant_role", "is_tenant_admin",
        "list_role_assignments", "assign_role", "end_role_assignment",
        "list_role_grants", "grant_role_capability", "revoke_role_capability",
      ],
      repointedFunctions: [
        "list_workforce_positions", "assign_workforce_position", "end_workforce_position",
        "get_org_profile", "upsert_org_profile",
      ],
    },
  },
  {
    file: "20261002000002_coregrid_v1_worker_definitions.sql",
    mission: "MISSION-R-40 persistent governed worker definitions",
    declared: {
      columns: [],
      indexes: ["cg_worker_definition_tenant_idx", "cg_worker_capability_capability_idx"],
      triggers: ["cg_worker_definition_touch"],
      tables: ["cg_worker_definition", "cg_worker_capability", "cg_worker_delegation"],
      functions: [],
    },
  },
  {
    file: "20261002000003_coregrid_v1_kernel_bitemporal.sql",
    mission: "MISSION-R-10/11 bi-temporal kernel semantics",
    declared: {
      // cg_entity.valid_from is NOT a signature: the kernel substrate
      // migration already provides it (header note in the file itself).
      columns: [
        ["cg_entity", "valid_time_known"], ["cg_entity", "supersedes"],
        ["cg_event", "valid_from"], ["cg_event", "valid_until"], ["cg_event", "supersedes"],
        ["cg_observation", "valid_from"], ["cg_observation", "valid_until"],
      ],
      indexes: ["cg_entity_valid_time_known_idx", "cg_event_valid_time_idx", "cg_observation_valid_time_idx"],
      functions: ["cg_guard_record_time_immutable"],
      triggers: ["cg_entity_record_time_immutable", "cg_event_record_time_immutable", "cg_observation_record_time_immutable"],
      tables: [],
    },
  },
  {
    file: "20261002000004_coregrid_v1_memory_tier.sql",
    mission: "MISSION-R-36 persisted authorization-gated memory store",
    declared: {
      columns: [],
      indexes: ["cg_memory_scope_tenant_idx", "cg_memory_record_tenant_class_idx", "cg_memory_access_log_tenant_idx"],
      triggers: [],
      tables: ["cg_memory_scope", "cg_memory_record", "cg_memory_access_log"],
      functions: [],
    },
  },
];

const report = (line, log) => {
  process.stdout.write(line + "\n");
  log.push(line);
};

// ── catalog presence probes (read-only) ─────────────────────────────────────
async function probeCatalog() {
  const state = { tables: new Set(), columns: new Map(), functions: new Set(), triggers: new Set(), indexes: new Set() };
  const rows = await query(`SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public'`);
  for (const r of rows) state.tables.add(r.tablename);

  const colRows = await query(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name IN ('cg_entity','cg_relationship','cg_event','cg_observation')`,
  );
  for (const r of colRows) {
    const set = state.columns.get(r.table_name) ?? new Set();
    set.add(r.column_name);
    state.columns.set(r.table_name, set);
  }

  const fnRows = await query(
    `SELECT DISTINCT proname FROM pg_catalog.pg_proc WHERE pronamespace='public'::regnamespace`,
  );
  for (const r of fnRows) state.functions.add(r.proname);

  const trigRows = await query(
    `SELECT tgname, rel.relname AS table_name FROM pg_catalog.pg_trigger tg
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
  for (const [table, col] of migration.declared.columns) {
    (catalog.columns.get(table)?.has(col) ? present : missing).push(`column:${table}.${col}`);
  }
  for (const f of migration.declared.functions) {
    (catalog.functions.has(f) ? present : missing).push(`function:${f}`);
  }
  for (const tg of migration.declared.triggers) {
    (catalog.triggers.has(tg) ? present : missing).push(`trigger:${tg}`);
  }
  for (const idx of migration.declared.indexes) {
    (catalog.indexes.has(idx) ? present : missing).push(`index:${idx}`);
  }
  return { present, missing };
}

// ── run ─────────────────────────────────────────────────────────────────────
const log = [];
const startedAtIso = new Date().toISOString();
console.log(`COREGRID MISSION-R-100 — canonical apply project=${projectRef}`);
console.log(`exclusive-access law: serialized with M-R-85/M-R-101 (no other canonical mission may run).`);

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

const record = {
  mission: "MISSION-R-100",
  capability: "V1CAP-072",
  gap: "J-040",
  projectRef,
  transport: "supabase-management-api-database-query",
  exclusiveAccess: "serialized with M-R-85/M-R-101 per mission graph",
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
  verification,
  findings,
};

const recordJson = JSON.stringify(record, null, 2);
mkdirSync(ARTIFACTS_DIR, { recursive: true });
writeFileSync(RECORD_PATH, recordJson + "\n");
writeFileSync(join(ARTIFACTS_DIR, "canonical-apply-mr100.json"), recordJson);
writeFileSync(join(ARTIFACTS_DIR, "canonical-apply-mr100.log"), log.join("\n") + "\n");
console.log(`posture record: ${RECORD_PATH}`);

if (findings > 0) {
  console.error(`STATUS=FINDINGS (${findings}) — see record. Nothing is claimed applied without catalog verification.`);
  process.exit(1);
}
console.log("STATUS=PASS — wave-3 migrations applied (or already applied) and catalog-verified on the canonical environment.");
