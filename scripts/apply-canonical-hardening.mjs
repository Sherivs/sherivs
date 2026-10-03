#!/usr/bin/env node
/**
 * CoreGrid — TEAM 3 hardening apply: MISSION-R-100 continuation (V1CAP-072).
 * Applies the hardening migrations (20261002000005..20261002000015) to
 * the canonical environment and records declared-vs-applied state truth.
 *
 * Modes (H2-06 — rehearsal-ready, CI-portable canonical apply path):
 *   apply        default. Plan, probe, apply, verify, record. Requires
 *                SUPABASE_ACCESS_TOKEN. Serialized exclusive canonical access.
 *   --manifest   print the full apply plan (migration order, sha256 per file,
 *                rollback checksums, declared signature objects) WITHOUT
 *                touching any database and WITHOUT credentials. The
 *                coordinator's serialized canonical apply runs plan-then-
 *                execute: this is the plan half.
 *   --verify-only  re-check the declared-vs-applied record against the live
 *                catalog (read-only probes only, idempotent, nothing applied).
 *                Requires SUPABASE_ACCESS_TOKEN.
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
 * Artifacts directory: derived from COREGRID_ARTIFACTS_DIR (defaulting to
 * /opt/cursor/artifacts) so CI runners can redirect evidence without touching
 * the script. The declared-vs-applied record itself always lands at
 * architecture/proofs/CANONICAL_APPLY_RECORD_HARDENING.json in-repo.
 *
 * Stage-1-specific post-apply verification: every table the hardening
 * migrations declare must exist with rowsecurity = true and ZERO policies
 * (deny-by-default posture carried into canonical; the battery re-proves it
 * live in Stage 3).
 *
 * Honesty rules (mission law):
 * - Exclusive canonical access: serialized, one canonical command at a time,
 *   never concurrent with another canonical operation (apply mode only).
 * - Idempotent-by-detection: all declared signature objects present →
 *   ALREADY_APPLIED and skipped; a MIXED (partially applied) state FAILS the
 *   run — partial state needs a human decision, never a silent re-run.
 * - A migration is "applied" only when its declared objects verify in-catalog.
 *
 * Usage:
 *   node scripts/apply-canonical-hardening.mjs [project-ref]
 *   node scripts/apply-canonical-hardening.mjs --manifest [project-ref]
 *   node scripts/apply-canonical-hardening.mjs --verify-only [project-ref]
 * Exit codes: 0 applied/verified/manifest-clean · 1 FINDING · 2 BLOCKED_NO_CREDENTIAL.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MIGRATIONS_DIR = join(ROOT, "database", "supabase", "migrations");
const ROLLBACKS_DIR = join(ROOT, "database", "supabase", "rollbacks");
const RECORD_PATH = join(ROOT, "architecture", "proofs", "CANONICAL_APPLY_RECORD_HARDENING.json");
const DEFAULT_ARTIFACTS_DIR = "/opt/cursor/artifacts";
const ARTIFACTS_DIR = process.env.COREGRID_ARTIFACTS_DIR ?? DEFAULT_ARTIFACTS_DIR;

// ── mode / argument parsing ──────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flags = argv.filter((a) => a.startsWith("--"));
const positionals = argv.filter((a) => !a.startsWith("--"));
const KNOWN_FLAGS = new Set(["--manifest", "--verify-only"]);
const unknownFlags = flags.filter((f) => !KNOWN_FLAGS.has(f));
const MODE = flags.includes("--manifest")
  ? "manifest"
  : flags.includes("--verify-only")
    ? "verify-only"
    : "apply";
const projectRef = positionals[0] ?? "nwrflbpbhyiqdptmlccm";

if (unknownFlags.length > 0 || positionals.length > 1) {
  console.error(
    `BLOCKED_USAGE unknown argument(s): ${[...unknownFlags, ...positionals.slice(1)].join(" ")}. ` +
      `Supported: [project-ref] with optional --manifest or --verify-only.`,
  );
  process.exit(2);
}

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (MODE !== "manifest" && !token) {
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
 * signature objects that prove application. These migrations declare tables
 * and indexes only (no functions, no triggers — verified by source scan),
 * except the Stage-2 policy migration which declares RLS policies; each also
 * ENABLEs RLS and REVOKEs from anon/authenticated.
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
  {
    file: "20261002000014_coregrid_v2_transport_buses_rls.sql",
    mission:
      "H2-03 — transport_buses RLS normalization to the zero-policy deny-by-default posture (drops every legacy permissive policy; revokes client-role privileges; service_role parity)",
    declared: {
      columns: [],
      indexes: [],
      tables: [],
      functions: [],
      triggers: [],
      // SUPERSEDED (2026-10-03, T-D integration): the applied-state signature
      // this migration declared — transport_buses holding ZERO policies — was
      // the interim deny-by-default posture. 20261003000041 legitimately
      // supersedes it for the driver assigned-read surface with exactly one
      // least-privilege policy, so the zero-policy signature no longer holds
      // BY DESIGN. This migration is never re-executed: its own §5 verification
      // guard would fail loudly (a policy now exists), and its normalization
      // work is complete. The live invariant owner for transport_buses is
      // 20261003000041's declared policy posture.
      supersededBy: "20261003000041_coregrid_transport_bus_reads.sql",
    },
  },
  {
    file: "20261002000015_coregrid_v1_substrate_policies.sql",
    mission:
      "H2-04 — batch-A/B substrate policy layer: FORCE RLS + neutral-primitive tenant-scoped SELECT/INSERT policies on the four retained client-facing substrate tables",
    declared: {
      columns: [],
      indexes: [],
      tables: [],
      functions: [],
      triggers: [],
      policies: [
        "cg_reconciliation_input.reconciliation_input_select_own_tenant",
        "cg_reconciliation_input.reconciliation_input_insert_tenant_admin",
        "cg_event_route_subscription.event_route_subscription_select_own_tenant",
        "cg_event_route_subscription.event_route_subscription_insert_tenant_admin",
        "cg_evidence_record.evidence_record_select_own_tenant",
        "cg_evidence_record.evidence_record_insert_tenant_admin",
        "cg_usage_attribution_bucket.usage_attribution_bucket_select_own_tenant",
        "cg_usage_attribution_bucket.usage_attribution_bucket_insert_tenant_admin",
      ],
      // FORCE RLS is not a catalog "object" presence can probe; it is
      // verified by the post-apply posture check below (rls_forced must be
      // true for every policy-backed table).
      forcedRlsTables: [
        "cg_reconciliation_input",
        "cg_event_route_subscription",
        "cg_evidence_record",
        "cg_usage_attribution_bucket",
      ],
    },
  },
  {
    file: "20261003000016_coregrid_v1_file_substrate.sql",
    mission:
      "H3-027 (L-T-011) — file-plane descriptor substrate: cg_file_object with FORCE RLS, tenant-scoped policies on the J-005 neutral primitives, actor self-derivation pin, no DELETE (tombstone law)",
    declared: {
      columns: [],
      indexes: [
        "cg_file_object_tenant_content_ref_idx",
        "cg_file_object_tenant_owner_idx",
        "cg_file_object_tenant_purpose_idx",
      ],
      tables: ["cg_file_object"],
      functions: [],
      triggers: [],
      policies: [
        "cg_file_object.file_object_select_own_tenant",
        "cg_file_object.file_object_insert_own_tenant",
        "cg_file_object.file_object_update_own_tenant",
      ],
      forcedRlsTables: ["cg_file_object"],
    },
  },
  {
    file: "20261003000017_coregrid_v1_idempotency_substrate.sql",
    mission:
      "H3-028 (L-T-012 / J-030) — durable exactly-once idempotency substrate: cg_idempotency_record with FORCE RLS, tenant-scoped policies, replace-expired-only UPDATE, service-role-only SECURITY DEFINER prune",
    declared: {
      columns: [],
      indexes: [
        "cg_idempotency_record_expires_idx",
        "cg_idempotency_record_tenant_idx",
      ],
      tables: ["cg_idempotency_record"],
      functions: ["cg_prune_expired_idempotency_records"],
      triggers: [],
      policies: [
        "cg_idempotency_record.idempotency_record_select_own_tenant",
        "cg_idempotency_record.idempotency_record_insert_tenant_admin",
        "cg_idempotency_record.idempotency_record_replace_expired",
      ],
      forcedRlsTables: ["cg_idempotency_record"],
    },
  },
  {
    file: "20261003000018_coregrid_v1_idempotency_privilege_revoke.sql",
    mission:
      "H3-000 battery-finding correction — restore the declared deny-by-default privilege posture on cg_idempotency_record (anon: zero; authenticated: exactly SELECT/INSERT/UPDATE) that 20261003000017 omitted while the project's ALTER DEFAULT PRIVILEGES grants broad client privileges on new public tables",
    declared: {
      columns: [],
      indexes: [],
      tables: [],
      functions: [],
      triggers: [],
      policies: [],
      // Privilege posture is not a catalog "object" presence can probe; the
      // applied-state signature IS the privilege grant set, probed from
      // information_schema.table_privileges (the battery's privileges stage is
      // the independent live verifier). A pure REVOKE+reGRANT has no declarable
      // catalog object; this posture probe is what makes the migration's
      // applied state checkable at all.
      privilegePostures: [
        {
          table: "cg_idempotency_record",
          anon: [],
          authenticated: ["SELECT", "INSERT", "UPDATE"],
          service_role: ["ALL"],
        },
      ],
    },
  },
  {
    file: "20261003000019_coregrid_v1_mission_lease.sql",
    mission:
      "V1-003 — mission lease substrate: cg_mission_lease (composite FK to cg_execution_record, attempt-uniqueness, state-coherence CHECKs, heartbeat/retry bookkeeping), cg_worker_delegation_grant (live revocation surface over the append-only cg_worker_delegation history), cg_worker_quarantine ledger; FORCE-class deny-by-default: RLS enabled, zero policies, anon/authenticated revoked (service-role reserved for the trusted server/control-plane operations, AGENTS §17/§27)",
    declared: {
      columns: [],
      indexes: [
        "cg_execution_record_id_tenant_mission_idx",
        "cg_mission_lease_tenant_state_idx",
        "cg_mission_lease_execution_idx",
        "cg_mission_lease_worker_idx",
        "cg_worker_delegation_grant_tenant_idx",
        "cg_worker_quarantine_tenant_idx",
      ],
      tables: ["cg_mission_lease", "cg_worker_delegation_grant", "cg_worker_quarantine"],
      functions: [],
      triggers: ["cg_mission_lease_touch"],
      policies: [],
      // Deny-by-default posture is not a catalog "object" presence can probe;
      // RLS-enabled-with-zero-policies means every role sees zero rows, and the
      // explicit REVOKE strips the grant set the project's ALTER DEFAULT
      // PRIVILEGES would otherwise confer. Probed via table_privileges.
      privilegePostures: [
        { table: "cg_mission_lease", anon: [], authenticated: [], service_role: ["ALL"] },
        { table: "cg_worker_delegation_grant", anon: [], authenticated: [], service_role: ["ALL"] },
        { table: "cg_worker_quarantine", anon: [], authenticated: [], service_role: ["ALL"] },
      ],
    },
  },
  {
    file: "20261003000020_coregrid_is_super_admin_definer.sql",
    mission:
      "V1 follow-up — is_super_admin() SECURITY DEFINER alignment: completes the 20260620151525 recursion fix (helpers reading public.users) for the one missed helper reading public.super_admins, whose policy re-invokes it — unbounded RLS recursion (PG 54001) on every tenant read whenever a super_admins row exists; observed live by the F-13 vertical slice (T6)",
    declared: {
      columns: [],
      indexes: [],
      tables: [],
      functions: ["is_super_admin"],
      triggers: [],
      policies: [],
    },
  },
  {
    file: "20261003000030_coregrid_hermes_observation_substrate.sql",
    mission:
      "R-wave R4 — Hermes observation substrate: cg_hermes_observation append-only intelligence ledger with full §12 provenance (source/event_ref/subject_ref, observed_at vs recorded_at, created_by, generated_by_ai), §9 canonical-truth CHECK (AI-generated implies unverified), exactly-once event consumption via partial unique (tenant_id, event_ref), append-only trigger, deny-by-default: RLS enabled, zero policies, anon/authenticated revoked, service_role granted",
    declared: {
      columns: [],
      indexes: [
        "cg_hermes_observation_tenant_recorded_idx",
        "cg_hermes_observation_tenant_kind_idx",
        "cg_hermes_observation_tenant_subject_idx",
        "cg_hermes_observation_tenant_event_idx",
      ],
      tables: ["cg_hermes_observation"],
      functions: ["cg_hermes_observation_append_only"],
      triggers: ["cg_hermes_observation_no_rewrite"],
      policies: [],
      privilegePostures: [
        { table: "cg_hermes_observation", anon: [], authenticated: [], service_role: ["ALL"] },
      ],
    },
  },
  {
    file: "20261003000031_coregrid_delivery_evidence.sql",
    mission:
      "R-wave R6 — delivery-evidence substrate: cg_delivery_evidence append-only attempt ledger over the email/voice channels (one row per outbound ATTEMPT including fail-closed BLOCKED_NO_CREDENTIAL — the block is evidence), redacted recipients, outcome-coherence CHECK (provider-confirmed id only on delivered), append-only trigger, deny-by-default: RLS enabled, zero policies, anon/authenticated revoked, service_role granted",
    declared: {
      columns: [],
      indexes: [
        "cg_delivery_evidence_tenant_created_idx",
        "cg_delivery_evidence_tenant_channel_outcome_idx",
        "cg_delivery_evidence_notification_idx",
      ],
      tables: ["cg_delivery_evidence"],
      functions: ["cg_delivery_evidence_forbid_mutation"],
      triggers: ["cg_delivery_evidence_append_only"],
      policies: [],
      privilegePostures: [
        { table: "cg_delivery_evidence", anon: [], authenticated: [], service_role: ["ALL"] },
      ],
    },
  },
  {
    file: "20261003000040_coregrid_school_media_bucket.sql",
    mission:
      "Post-R-wave T-C — storage provisioning: school-media bucket (PRIVATE — the admin gallery flow uploads authenticated and renders via 10-year createSignedUrl; envelope bounded to 8 MB + image mime types mirroring the client contract), idempotent INSERT ON CONFLICT DO NOTHING; grants NOTHING new — the five tenant-scoped school-media object policies are owned by applied migration 20260707223958",
    declared: {
      columns: [],
      indexes: [],
      tables: [],
      functions: [],
      triggers: [],
      policies: [],
    },
  },
  {
    file: "20261003000041_coregrid_transport_bus_reads.sql",
    mission:
      "Post-R-wave T-D — transport fleet driver bus-read gate: FORCE RLS + GRANT SELECT to authenticated + exactly one least-privilege policy transport_buses_select_driver_assigned (FOR SELECT TO authenticated USING (driver_id = auth.uid()) — the actor is re-derived inside the predicate per §26; the J-005 tenant-equality shape is inexpressible on this legacy substrate — no neutral tenant reference, zero live neutral bindings — recorded in scripts/verification/rls-table-postures-transport.json). Supersedes the 20261002000014 interim zero-policy posture for the driver SELECT surface ONLY: writes for every client role and every other read family remain denied; anon/PUBLIC stay at zero privileges; service_role untouched",
    declared: {
      columns: [],
      indexes: [],
      tables: [],
      functions: [],
      triggers: [],
      policies: ["transport_buses.transport_buses_select_driver_assigned"],
    },
  },
];

const report = (line, log) => {
  process.stdout.write(line + "\n");
  log.push(line);
};

const declaredObjectCount = (declared) =>
  declared.tables.length +
  declared.indexes.length +
  declared.functions.length +
  declared.triggers.length +
  (declared.policies?.length ?? 0) +
  (declared.zeroPolicyTables?.length ?? 0) +
  (declared.privilegePostures?.length ?? 0);

/**
 * Read-only plan construction: binds every declared migration to its on-disk
 * bytes (sha256), its rollback bytes, and its declared signature objects.
 * Never contacts the database. A missing migration or rollback file is a
 * plan FINDING — the plan must be complete before any apply may run.
 */
function buildPlan(reportLine = () => {}) {
  const plan = [];
  let findings = 0;
  MIGRATIONS.forEach((migration, i) => {
    let checksum = null;
    let filePresent = true;
    try {
      checksum = sha256(readFileSync(join(MIGRATIONS_DIR, migration.file), "utf8"));
    } catch {
      filePresent = false;
      findings += 1;
      reportLine(`FINDING ${migration.file}: migration file missing from database/supabase/migrations — the plan cannot bind a checksum.`);
    }

    let rollbackChecksum = null;
    try {
      rollbackChecksum = sha256(readFileSync(join(ROLLBACKS_DIR, migration.file), "utf8"));
    } catch {
      findings += 1;
      reportLine(`FINDING ${migration.file}: rollback file missing — a rollback plan is mandatory (Constitution §38).`);
    }

    plan.push({
      order: i + 1,
      file: migration.file,
      mission: migration.mission,
      filePresent,
      checksum,
      rollbackChecksum,
      declared: migration.declared,
      declaredObjectCount: declaredObjectCount(migration.declared),
    });
  });
  return { plan, findings };
}

function printPlan(plan, reportLine) {
  reportLine(
    `plan: ${plan.length} migrations, ${plan.reduce((n, m) => n + m.declaredObjectCount, 0)} declared signature objects, dependency order locked.`,
  );
  for (const m of plan) {
    reportLine(
      `MIGRATION ${m.order} ${m.file}` +
        ` checksum=${m.checksum ?? "MISSING"}` +
        ` rollback=${m.rollbackChecksum ?? "MISSING"}` +
        ` declaredObjects=${m.declaredObjectCount}`,
    );
    if (m.filePresent) {
      for (const t of m.declared.tables) reportLine(`  table:${t}`);
      for (const idx of m.declared.indexes) reportLine(`  index:${idx}`);
      for (const f of m.declared.functions) reportLine(`  function:${f}`);
      for (const tg of m.declared.triggers) reportLine(`  trigger:${tg}`);
      for (const p of m.declared.policies ?? []) reportLine(`  policy:${p}`);
      for (const z of m.declared.zeroPolicyTables ?? []) reportLine(`  zero-policy:${z}`);
      for (const pp of m.declared.privilegePostures ?? []) reportLine(`  privilege-posture:${pp.table}`);
      if (m.declared.supersededBy) reportLine(`  superseded-by:${m.declared.supersededBy}`);
    }
  }
}

/**
 * Guarded artifact write: the artifacts directory is environment-derived
 * (COREGRID_ARTIFACTS_DIR), so an unwritable location must degrade to a
 * warning, never silently lose evidence or crash the run.
 */
function writeArtifact(name, content, reportLine) {
  try {
    mkdirSync(ARTIFACTS_DIR, { recursive: true });
    writeFileSync(join(ARTIFACTS_DIR, name), content);
    reportLine(`artifact: ${ARTIFACTS_DIR}/${name}`);
    return true;
  } catch (err) {
    reportLine(`WARN artifact write failed (${ARTIFACTS_DIR}/${name}): ${err.message}`);
    return false;
  }
}

// ── catalog presence probes (read-only) ─────────────────────────────────────
async function probeCatalog() {
  const state = { tables: new Set(), columns: new Map(), functions: new Set(), triggers: new Set(), indexes: new Set(), policies: new Set(), privileges: new Map() };
  const rows = await query(`SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public'`);
  for (const r of rows) state.tables.add(r.tablename);

  const polRows = await query(`SELECT tablename, policyname FROM pg_catalog.pg_policies WHERE schemaname='public'`);
  for (const r of polRows) state.policies.add(`${r.tablename}.${r.policyname}`);

  // Table privileges per grantee (the applied-state signature of a pure
  // privilege-correction migration): key `table|grantee` -> Set(privilege_type).
  const privRows = await query(
    `SELECT table_name, grantee, privilege_type FROM information_schema.table_privileges WHERE table_schema='public'`,
  );
  for (const r of privRows) {
    const key = `${r.table_name}|${r.grantee}`;
    if (!state.privileges.has(key)) state.privileges.set(key, new Set());
    state.privileges.get(key).add(r.privilege_type);
  }

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
  for (const zt of migration.declared.zeroPolicyTables ?? []) {
    const hasPolicy = [...catalog.policies].some((p) => p.startsWith(`${zt}.`));
    (hasPolicy ? missing : present).push(`zero-policy:${zt}`);
  }
  // Declared privilege postures (privilege-correction migrations): the catalog
  // grants must match the declared grant set EXACTLY per role — all-of AND
  // none-of — because the posture is least privilege, not "at least these".
  for (const pp of migration.declared.privilegePostures ?? []) {
    const ALL = ["DELETE", "INSERT", "REFERENCES", "SELECT", "TRIGGER", "TRUNCATE", "UPDATE"];
    const declared = pp.service_role?.includes("ALL")
      ? ALL
      : Object.entries({ anon: pp.anon ?? [], authenticated: pp.authenticated ?? [] }).flatMap(([role, privs]) => privs);
    const declaredAnon = pp.anon ?? [];
    const declaredAuth = pp.authenticated ?? [];
    const declaredService = pp.service_role?.includes("ALL") ? ALL : (pp.service_role ?? []);
    const granteeDeclared = [
      ["anon", new Set(declaredAnon)],
      ["authenticated", new Set(declaredAuth)],
      ["service_role", new Set(declaredService)],
    ];
    let postureOk = true;
    const detail = [];
    for (const [grantee, expected] of granteeDeclared) {
      const actual = catalog.privileges.get(`${pp.table}|${grantee}`) ?? new Set();
      const expectedSet = new Set(expected);
      for (const p of expectedSet) {
        if (!actual.has(p)) { postureOk = false; detail.push(`missing ${grantee}:${p}`); }
      }
      for (const p of actual) {
        if (!expectedSet.has(p)) { postureOk = false; detail.push(`unexpected ${grantee}:${p}`); }
      }
    }
    (postureOk ? present : missing).push(`privilege-posture:${pp.table}${postureOk ? "" : ` (${detail.slice(0, 6).join(", ")})`}`);
  }
  return { present, missing };
}

// ── run ──────────────────────────────────────────────────────────────────────
const log = [];
const startedAtIso = new Date().toISOString();
const logLine = (line) => report(line, log);

if (MODE === "manifest") {
  console.log("COREGRID HARDENING APPLY — MANIFEST (plan-only rehearsal; no database is contacted, nothing is applied)");
  console.log(`mode=manifest artifactsDir=${ARTIFACTS_DIR} databaseContact=false`);
  const { plan, findings } = buildPlan(logLine);
  printPlan(plan, logLine);
  const manifest = {
    mission: "MISSION-R-100 (TEAM 3 hardening continuation)",
    capability: "V1CAP-072",
    mode: "manifest",
    generatedAt: new Date().toISOString(),
    artifactsDir: ARTIFACTS_DIR,
    projectRef,
    databaseContact: false,
    migrations: plan.map((m) => ({
      order: m.order,
      file: m.file,
      mission: m.mission,
      filePresent: m.filePresent,
      checksum: m.checksum,
      rollbackChecksum: m.rollbackChecksum,
      declaredObjectCount: m.declaredObjectCount,
      declared: m.declared,
    })),
    totalDeclaredObjects: plan.reduce((n, m) => n + m.declaredObjectCount, 0),
    findings,
  };
  writeArtifact("canonical-apply-hardening.manifest.json", JSON.stringify(manifest, null, 2) + "\n", logLine);
  if (findings > 0) {
    console.error(`STATUS=MANIFEST_FINDINGS (${findings}) — the plan is incomplete; do not execute it.`);
    process.exit(1);
  }
  console.log("STATUS=MANIFEST_OK — plan is complete and checksum-bound; execute with the serialized canonical apply.");
  process.exit(0);
}

if (MODE === "verify-only") {
  console.log("COREGRID HARDENING APPLY — VERIFY-ONLY (read-only catalog re-verification; nothing is applied)");
  console.log(`mode=verify-only artifactsDir=${ARTIFACTS_DIR}`);
  let findings = 0;

  const { plan, findings: planFindings } = buildPlan(logLine);
  findings += planFindings;

  const recordExists = existsSync(RECORD_PATH);
  let record = null;
  if (recordExists) {
    try {
      record = JSON.parse(readFileSync(RECORD_PATH, "utf8"));
    } catch (err) {
      findings += 1;
      logLine(`FINDING declared-vs-applied record at ${RECORD_PATH} is unreadable: ${err.message}`);
    }
  } else {
    findings += 1;
    logLine(`FINDING no declared-vs-applied record at ${RECORD_PATH} — run the apply at least once before verifying.`);
  }

  let catalog;
  try {
    catalog = await probeCatalog();
  } catch (err) {
    console.error(`BLOCKED read-only catalog probe failed: ${err.message}`);
    process.exit(1);
  }

  const verification = [];
  for (const m of plan) {
    const { missing } = presenceFor({ declared: m.declared }, catalog);
    let drift = null;
    const recordEntry = record?.declaredVsApplied?.find((r) => r.file === m.file);
    if (record && m.checksum !== null && recordEntry?.checksum && recordEntry.checksum !== m.checksum) {
      drift = `on-disk bytes drifted from the recorded checksum (${recordEntry.checksum.slice(0, 12)}…)`;
      findings += 1;
    } else if (record && !recordEntry) {
      drift = "declared-vs-applied record does not cover this migration";
      findings += 1;
    }

    if (missing.length === 0 && !drift) {
      verification.push({ file: m.file, order: m.order, verified: true, missingCount: 0, checksumBound: true });
      logLine(`VERIFY OK   ${m.file} — all ${m.declaredObjectCount} declared objects present; checksum bound.`);
    } else {
      verification.push({
        file: m.file,
        order: m.order,
        verified: false,
        missingCount: missing.length,
        missingSample: missing.slice(0, 10),
        drift,
      });
      logLine(`VERIFY FAIL ${m.file} — missing ${missing.length} declared objects${drift ? `; ${drift}` : ""}.`);
    }
  }

  const verifyRecord = {
    mission: "MISSION-R-100 (TEAM 3 hardening continuation)",
    capability: "V1CAP-072",
    mode: "verify-only",
    projectRef,
    artifactsDir: ARTIFACTS_DIR,
    executedAt: startedAtIso,
    completedAt: new Date().toISOString(),
    recordChecked: recordExists,
    declaredVsApplied: verification,
    findings,
  };
  writeArtifact("canonical-apply-hardening-verify.json", JSON.stringify(verifyRecord, null, 2) + "\n", logLine);
  if (findings > 0) {
    console.error(`STATUS=VERIFY_FINDINGS (${findings}) — declared-vs-applied does not hold against the live catalog.`);
    process.exit(1);
  }
  console.log("STATUS=VERIFY_PASS — declared-vs-applied record matches the live catalog; idempotent, nothing applied.");
  process.exit(0);
}

console.log(`COREGRID HARDENING APPLY (MISSION-R-100 continuation) — canonical project=${projectRef}`);
console.log(`exclusive-access law: serialized, one canonical operation at a time; no other canonical work runs concurrently.`);

let findings = 0;
const migrations = [];

const { plan, findings: planFindings } = buildPlan(logLine);
if (planFindings > 0) {
  console.error(`BLOCKED plan incomplete (${planFindings} findings) — fix the plan before any canonical contact.`);
  process.exit(1);
}

let catalog;
try {
  catalog = await probeCatalog();
} catch (err) {
  console.error(`BLOCKED catalog probe failed: ${err.message}`);
  process.exit(1);
}

for (const m of plan) {
  const { present, missing } = presenceFor({ declared: m.declared }, catalog);
  const entry = {
    file: m.file,
    mission: m.mission,
    checksum: m.checksum,
    rollbackChecksum: m.rollbackChecksum,
    declaredObjectCount: m.declaredObjectCount,
  };

  // A migration whose declared applied-state signature was superseded by a
  // later migration in this manifest (e.g. an interim zero-policy posture
  // legitimately replaced by a least-privilege policy) is never re-derived
  // from the catalog and never re-executed: its normalization work is
  // complete and re-running it would violate its own verification guard.
  // The live invariant it used to declare is owned by the superseding
  // migration's declaration.
  const superseded = Boolean(m.declared.supersededBy);

  // A migration that declares ZERO catalog objects (pure data/infrastructure
  // statements, e.g. storage bucket provisioning) can never be proven applied
  // by presence-probing — "nothing missing" proves nothing. The skip
  // optimization must not fire for it: it is executed on every apply, which
  // is safe because manifest membership REQUIRES idempotency (manifest law).
  const zeroDeclared = m.declaredObjectCount === 0;

  if (superseded) {
    entry.state = "SUPERSEDED";
    entry.evidence = `declared signature superseded by ${m.declared.supersededBy} — live posture owned there; never re-executed`;
    report(`SKIP  ${m.file} — SUPERSEDED by ${m.declared.supersededBy}`, log);
  } else if (!zeroDeclared && missing.length === 0) {
    entry.state = "ALREADY_APPLIED";
    entry.evidence = `all ${present.length} declared objects present (pre-flight catalog probe)`;
    report(`SKIP  ${m.file} — ALREADY_APPLIED (${present.length}/${present.length} declared objects present)`, log);
  } else if (zeroDeclared || present.length === 0) {
    report(`APPLY ${m.file} — ${m.mission} (checksum ${m.checksum.slice(0, 12)}…)`, log);
    const t0 = Date.now();
    try {
      await query(readFileSync(join(MIGRATIONS_DIR, m.file), "utf8"));
      entry.state = "APPLIED";
      entry.elapsedMs = Date.now() - t0;
      report(`OK    ${m.file} (${entry.elapsedMs}ms)`, log);
    } catch (err) {
      entry.state = "APPLY_FAILED";
      entry.error = err.message;
      findings += 1;
      report(`FAIL  ${m.file}: ${err.message}`, log);
      migrations.push(entry);
      break; // dependency order: stop at the first failure, never skip ahead
    }
  } else {
    entry.state = "MIXED_PARTIALLY_APPLIED";
    entry.presentCount = present.length;
    entry.missingSample = missing.slice(0, 10);
    findings += 1;
    report(`FINDING ${m.file}: partially applied state (${present.length} present / ${missing.length} missing) — human decision required, refusing to re-run.`, log);
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
  for (const m of plan) {
    if (m.declared.supersededBy) {
      verification.push({
        file: m.file,
        verified: true,
        missingCount: 0,
        note: `superseded by ${m.declared.supersededBy} — live posture verified there`,
      });
      continue;
    }
    const { missing } = presenceFor({ declared: m.declared }, catalog2);
    const entry = migrations.find((x) => x.file === m.file);
    if (missing.length === 0) {
      verification.push({ file: m.file, verified: true, missingCount: 0 });
      if (entry) entry.state = entry.state === "ALREADY_APPLIED" ? "ALREADY_APPLIED" : "APPLIED_AND_VERIFIED";
    } else {
      findings += 1;
      verification.push({ file: m.file, verified: false, missingSample: missing.slice(0, 10) });
      report(`FINDING ${m.file}: post-apply verification missing ${missing.length} declared objects.`, log);
    }
  }
}

// ── Stage-1 security verification: deny-by-default posture on every new table ──
const declaredTables = MIGRATIONS.flatMap((m) => m.declared.tables);
// Tables whose declared applied-state signature is a ZERO-policy posture
// (normalization migrations): probed as zero-policy regardless of declared.tables.
const zeroPolicyWatchTables = MIGRATIONS.flatMap((m) => m.declared.zeroPolicyTables ?? []);
// Policy-backed tables: RLS FORCED on, carrying exactly the declared
// neutral-primitive policies (no more, no less). DERIVED from the declared
// policies across the policy migrations (20261002000013 exemplar +
// 20261002000015 substrate layer + the H3-wave 2026100300001[67] substrates):
// any table with a declared policy is policy-backed, so new policy-backed
// migrations classify themselves instead of requiring this list to grow.
const policyBackedTables = [
  ...new Set(MIGRATIONS.flatMap((m) => m.declared.policies ?? []).map((p) => p.split(".")[0])),
].map((table) => ({
  table,
  expectedPolicies: MIGRATIONS.flatMap((m) => m.declared.policies ?? [])
    .filter((p) => p.startsWith(`${table}.`))
    .map((p) => p.split(".")[1]),
}));
let rlsPosture = null;
const sqlArrayLiteral = (values) =>
  `ARRAY[${values.map((v) => `'${v.replaceAll("'", "''")}'`).join(",")}]::text[]`;
try {
  const probedTables = [
    ...new Set([...declaredTables, ...zeroPolicyWatchTables, ...policyBackedTables.map((t) => t.table)]),
  ];
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
    const policyBacked = policyBackedTables.find((pb) => pb.table === t);
    const ok = policyBacked
      ? rls?.rls_enabled === true &&
        rls?.rls_forced === true &&
        policyBacked.expectedPolicies.every((p) => policies.includes(p)) &&
        policies.length === policyBacked.expectedPolicies.length
      : rls?.rls_enabled === true && policies.length === 0;
    if (!ok) findings += 1;
    report(
      `${ok ? "PASS" : "FINDING"} ${t}: rowsecurity=${rls?.rls_enabled ?? "absent"} rlsforced=${rls?.rls_forced ?? "n/a"} policies=${policyBacked ? policies.join(",") : policies.length}`,
      log,
    );
    return {
      table: t,
      posture: policyBacked ? "policy-backed (declared policies)" : "zero-policy (deny-by-default)",
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
console.log("STATUS=PASS — migrations applied (or already applied) and catalog-verified: zero-policy deny-by-default holds on the Stage-1 substrate tables; the policy-backed tables (including the transport fleet driver read gate) carry RLS FORCED with exactly the declared policies.");