#!/usr/bin/env node
/**
 * MISSION-R-85 / J-041 / V1CAP-073 — RLS isolation battery.
 * MISSION H2-05 — declarative dual-posture engine (posture is data, not code).
 *
 * Converts the deny-by-default posture of the cg_* substrate from statically
 * reasoned to database-proven, executed against the approved dev project
 * through two authorized transports (no new credentials):
 *
 *   1. Supabase REST endpoint ($SUPABASE_URL/rest/v1) with the shared
 *      publishable (anon) key — what ANY unauthenticated client holds. Proves
 *      that no rows leak through the public data plane.
 *   2. Supabase management-API SQL query (same transport as
 *      scripts/apply-approved-v1-migrations.mjs) — read-only catalog queries
 *      over pg_catalog / information_schema. Proves the enforcement metadata:
 *      relrowsecurity = true, zero permissive policies, and no table grants
 *      to anon / authenticated / PUBLIC.
 *
 * Battery sections per table:
 *   (a) ANON_REST_PROBE   — anon SELECT returns empty/error (deny-by-default
 *                            holds; no rows leak).
 *   (b) CATALOG_ENFORCEMENT — posture-dependent:
 *                            · zero-policy tables: relrowsecurity = true AND
 *                              zero policies (permissive count = 0);
 *                            · policy-backed tables (post J-005/J-006,
 *                              migration 20261002000013): relrowsecurity =
 *                              true, relforcerowsecurity = true, and exactly
 *                              the declared neutral tenant-membership
 *                              policies.
 *   (c) PRIVILEGES         — posture-dependent: zero-policy tables grant
 *                            nothing to anon/authenticated/PUBLIC;
 *                            policy-backed tables grant the DECLARED
 *                            authenticated privilege set (default
 *                            SELECT/INSERT/UPDATE/DELETE — the canonical
 *                            J-005/J-006 convention; a posture file may
 *                            declare a stricter least-privilege set, e.g.
 *                            SELECT+INSERT for append-only substrates) — the
 *                            policies are the operative row gate — and
 *                            nothing to anon/PUBLIC.
 *   (d) ISOLATION_PROOF    — zero-policy tables: the STRONGEST-form derivation
 *                            (no policy expression anywhere can evaluate
 *                            true — no identity can read).
 *                            policy-backed tables: GENUINE cross-tenant
 *                            probes (RLS_ISOLATION_BATTERY.md §4.4): seed
 *                            Tenant A / Tenant B rows through the privileged
 *                            management channel, read as an authenticated
 *                            Tenant A principal and as anon, and assert
 *                            Tenant B rows invisible AND Tenant A rows
 *                            visible (a policy that denies Tenant A its own
 *                            rows is a FINDING too). Includes an
 *                            expired-binding principal (revoked/expired
 *                            access fails) and negative write probes
 *                            (cross-tenant INSERT; forged grantor).
 *                            The probe stage itself is data-declared:
 *                            neutral-membership exemplar tables
 *                            (cg_org_membership, cg_role_assignment,
 *                            cg_role_grant) use the built-in probe stage;
 *                            any other policy-backed table must declare
 *                            probeSeedRows + probeInsertPayload in its
 *                            posture entry — a policy-backed table without a
 *                            declared probe stage is a FINDING
 *                            (CROSS_TENANT_PROBE_STAGE_NOT_DECLARED), never
 *                            a silent pass.
 *   (e) SERVICE_ROLE_CONTRAST — opt-in only (env
 *                            COREGRID_BATTERY_ALLOW_SERVICE_ROLE=1): one
 *                            probe with SUPABASE_SERVICE_ROLE_KEY to
 *                            demonstrate the ONLY privileged data path is
 *                            the explicit service role. Service-role usage
 *                            is explicit and logged, never default.
 *
 * Honesty rules:
 * - Zero-policy tables: DENY is the pass condition — deny-by-default + zero
 *   policies means DENY for everyone through REST.
 * - Policy-backed tables: the pass condition is tenant-scoped VISIBILITY —
 *   Tenant A reads exactly its own rows, nothing else. A probe that denies
 *   Tenant A its own rows is a FINDING, never a pass.
 * - The privileged seed/cleanup path (management-channel SQL + auth-admin
 *   user management, the discipline of scripts/exercise-foundation-loop.mjs)
 *   is explicit and logged: PRIVILEGED_SEED_USED_EXPLICITLY. Every probe row
 *   and probe user is cleaned up (probe_cleaned=true); cleanup is verified by
 *   re-count, and a failed cleanup is a FINDING.
 * - Only genuine denials count. An API-key rejection ("Invalid API key")
 *   proves nothing about row security and is recorded INCONCLUSIVE with a
 *   finding.
 *
 * Exit codes:
 *   0  PASS (every table proves its declared posture);
 *   1  FAIL (at least one FINDING — nothing is fixed) or an invalid posture
 *      registry (--dry-parse-scope);
 *   2  BLOCKED_NO_CREDENTIAL.
 *
 * Artifacts (outside the repo):
 *   /opt/cursor/artifacts/rls-battery-results.json
 *   /opt/cursor/artifacts/rls-battery-results.log
 *
 * MISSION H2-05 — declarative posture registry:
 * Per-table posture is DATA, not code. The battery reads every
 * scripts/verification/rls-table-postures-*.json file and applies it ON TOP of
 * the built-in canonical posture (BUILTIN_TABLE_POSTURES — the posture proven
 * live 36/36 on canonical 2026-10-02, RLS_ISOLATION_BATTERY.md §7), so future
 * policy migrations extend the battery by adding data, not code.
 *
 * Posture-file shape (consumed: the landed H2-03/H2-04 files
 * rls-table-postures-transport.json / rls-table-postures-substrate.json):
 *   - a JSON array of entries, or an object with a "tables" (or "postures")
 *     array plus free-form provenance metadata (mission, status, authority —
 *     preserved verbatim in the file, not interpreted by the battery);
 *   - each entry names the table via "name" (sibling convention) or "table",
 *     and carries:
 *       posture        "zero-policy" | "policy-backed"      (required)
 *       policies       exact expected policy-name set: policy-name strings
 *                      or declaration objects {name, command, roles,
 *                      predicate} (required non-empty for policy-backed;
 *                      must be absent/empty for zero-policy — zero policies
 *                      IS the posture)
 *       forceRls       boolean force expectation (required true for
 *                      policy-backed; must be false/absent for zero-policy —
 *                      FORCE cannot strengthen a no-policy posture)
 *       tenantColumn   required for policy-backed (the cross-tenant probes
 *                      filter by it); must be a plain SQL identifier
 *       source | sourceMigration  optional migration provenance; defaults to
 *                      "posture-file:<fileName>" (AGENTS §12)
 *       privileges     optional declared grant expectation, e.g.
 *                      {authenticated: ["SELECT","INSERT"], anon: [],
 *                      service_role: ["ALL"]} — policy-backed tables assert
 *                      the declared authenticated set (default: the canonical
 *                      SELECT/INSERT/UPDATE/DELETE); anon/PUBLIC are always
 *                      asserted zero
 *       probeSeedRows + probeInsertPayload  optional data-declared §4.4 probe
 *                      recipe (both together) for policy-backed tables outside
 *                      the neutral-membership exemplar set; string values may
 *                      use the placeholders $TENANT_A, $TENANT_B, $ACTOR_A_ID,
 *                      $ACTOR_B_ID, $ACTOR_C_ID, $RUN_ID
 *       probeAuxTables optional data-declared parent rows for recipes on
 *                      tables whose composite FK requires a privileged parent
 *                      (e.g. cg_reconciliation_input → cg_reconciliation_verdict):
 *                      [{table, tenantColumn, seedRows}] — seeded after the
 *                      probe rows, deleted (and re-counted) by cleanup, cg_*
 *                      tables only
 *       any further fields (rationale, appendOnly, absentPolicies, …) are
 *                      passed through untouched as provenance.
 *
 * Registry rules (battery-correctness, never silent):
 *   - files are parsed in lexical file-name order and merged over the built-in
 *     canonical posture; with no posture files the built-in list applies as-is;
 *   - a table declared more than once (within or across files) is REJECTED —
 *     a security posture must have exactly one source of truth;
 *   - every entry is validated before use; an invalid posture file BLOCKS the
 *     battery instead of weakening any check (fail closed, never a silent
 *     last-writer-wins);
 *   - catalog queries cover every declared table: the cg_% enumeration
 *     (scope-drift INFO) stays, and non-cg declared tables (e.g.
 *     transport_buses) are matched by name.
 *
 * Offline CLI surface (no credentials, no network, no live database):
 *   node scripts/verify-rls-isolation-battery.mjs --help
 *   node scripts/verify-rls-isolation-battery.mjs --dry-parse-scope
 * Live execution keeps the credential gate and exit codes documented above;
 * importing this module (unit tests) performs no I/O and never exits.
 */
import { readFileSync, readdirSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const artifactsDir = "/opt/cursor/artifacts";
const jsonPath = join(artifactsDir, "rls-battery-results.json");
const logPath = join(artifactsDir, "rls-battery-results.log");

// ---------------------------------------------------------------------------
// Declarative posture registry (MISSION H2-05) — pure, exported for unit tests.
// The posture of each substrate table is DATA:
// scripts/verification/rls-table-postures-*.json files override/extend the
// built-in canonical posture below, so future policy migrations extend the
// battery by adding data, not code. See the header for the entry schema and
// the merge/duplicate/validation rules.
// ---------------------------------------------------------------------------
export const POSTURE_FILE_PATTERN = /^rls-table-postures-.+\.json$/;
export const TABLE_POSTURES = ["zero-policy", "policy-backed"];
const TABLE_NAME_PATTERN = /^[a-z_][a-z0-9_]*$/;
const SQL_IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]*$/;

// The current canonical posture (built-in default fallback): EVERY cg_*
// substrate table applied to the canonical project, enumerated from the applied
// migrations (source migration cited per table). Postures:
//   zero-policy   — RLS on, zero policies: deny-by-default strongest form.
//   policy-backed — post J-005/J-006 (20261002000013): FORCED RLS + neutral
//                   tenant-membership policies; proven by genuine cross-
//                   tenant probes.
// Keep this list byte-for-byte equivalent to the posture proven in
// RLS_ISOLATION_BATTERY.md §7 (36/36 PASS, canonical 2026-10-02).
export const BUILTIN_TABLE_POSTURES = [
  { name: "cg_entity", source: "20260903000000_coregrid_universal_kernel_substrate.sql", posture: "zero-policy" },
  { name: "cg_relationship", source: "20260903000000_coregrid_universal_kernel_substrate.sql", posture: "zero-policy" },
  { name: "cg_event", source: "20260903000000_coregrid_universal_kernel_substrate.sql", posture: "zero-policy" },
  { name: "cg_observation", source: "20260903000000_coregrid_universal_kernel_substrate.sql", posture: "zero-policy" },
  { name: "cg_workspace", source: "20260930000000_coregrid_v1_workspace_persistence.sql", posture: "zero-policy" },
  { name: "cg_workspace_member", source: "20260930000000_coregrid_v1_workspace_persistence.sql", posture: "zero-policy" },
  { name: "cg_org_unit", source: "20261001000000_coregrid_v1_org_model.sql", posture: "zero-policy" },
  {
    name: "cg_org_membership",
    source: "20261001000000_coregrid_v1_org_model.sql",
    posture: "policy-backed",
    forceRls: true,
    tenantColumn: "tenant_id",
    policies: [
      "org_membership_select_own_tenant",
      "org_membership_insert_tenant_admin",
      "org_membership_update_tenant_admin",
    ],
  },
  {
    name: "cg_role_assignment",
    source: "20260907000800_coregrid_role_assignment_substrate.sql",
    posture: "policy-backed",
    forceRls: true,
    tenantColumn: "tenant_ref",
    policies: [
      "role_assignment_select_own_tenant",
      "role_assignment_insert_tenant_admin",
      "role_assignment_update_tenant_admin",
    ],
  },
  {
    name: "cg_role_grant",
    source: "20260907000800_coregrid_role_assignment_substrate.sql",
    posture: "policy-backed",
    forceRls: true,
    tenantColumn: "tenant_ref",
    policies: [
      "role_grant_select_own_tenant",
      "role_grant_insert_tenant_admin",
      "role_grant_update_tenant_admin",
    ],
  },
  { name: "cg_worker_definition", source: "20261002000002_coregrid_v1_worker_definitions.sql", posture: "zero-policy" },
  { name: "cg_worker_capability", source: "20261002000002_coregrid_v1_worker_definitions.sql", posture: "zero-policy" },
  { name: "cg_worker_delegation", source: "20261002000002_coregrid_v1_worker_definitions.sql", posture: "zero-policy" },
  { name: "cg_memory_scope", source: "20261002000004_coregrid_v1_memory_tier.sql", posture: "zero-policy" },
  { name: "cg_memory_record", source: "20261002000004_coregrid_v1_memory_tier.sql", posture: "zero-policy" },
  { name: "cg_memory_access_log", source: "20261002000004_coregrid_v1_memory_tier.sql", posture: "zero-policy" },
  // TEAM 3 hardening continuation — wave applied to canonical 2026-10-02.
  { name: "cg_reconciliation_verdict", source: "20261002000005_coregrid_v1_reconciliation.sql", posture: "zero-policy" },
  { name: "cg_reconciliation_input", source: "20261002000005_coregrid_v1_reconciliation.sql", posture: "zero-policy" },
  { name: "cg_event_security", source: "20261002000006_coregrid_v1_event_security.sql", posture: "zero-policy" },
  { name: "cg_event_security_denial", source: "20261002000006_coregrid_v1_event_security.sql", posture: "zero-policy" },
  { name: "cg_event_security_redaction", source: "20261002000006_coregrid_v1_event_security.sql", posture: "zero-policy" },
  { name: "cg_event_route_subscription", source: "20261002000007_coregrid_v1_event_routing.sql", posture: "zero-policy" },
  { name: "cg_event_route_queue", source: "20261002000007_coregrid_v1_event_routing.sql", posture: "zero-policy" },
  { name: "cg_event_route_cursor", source: "20261002000007_coregrid_v1_event_routing.sql", posture: "zero-policy" },
  { name: "cg_event_route_outcome", source: "20261002000007_coregrid_v1_event_routing.sql", posture: "zero-policy" },
  { name: "cg_evidence_record", source: "20261002000008_coregrid_v1_evidence_lifecycle.sql", posture: "zero-policy" },
  { name: "cg_evidence_lifecycle_act", source: "20261002000008_coregrid_v1_evidence_lifecycle.sql", posture: "zero-policy" },
  { name: "cg_reasoning_provenance_snapshot", source: "20261002000009_coregrid_v1_reasoning_provenance.sql", posture: "zero-policy" },
  { name: "cg_usage_attribution_rollup", source: "20261002000010_coregrid_v1_cost_attribution.sql", posture: "zero-policy" },
  { name: "cg_usage_attribution_bucket", source: "20261002000010_coregrid_v1_cost_attribution.sql", posture: "zero-policy" },
  { name: "cg_knowledge_source", source: "20261002000011_coregrid_v1_knowledge_currency.sql", posture: "zero-policy" },
  { name: "cg_knowledge_freshness_contract", source: "20261002000011_coregrid_v1_knowledge_currency.sql", posture: "zero-policy" },
  { name: "cg_knowledge_invalidation", source: "20261002000011_coregrid_v1_knowledge_currency.sql", posture: "zero-policy" },
  { name: "cg_knowledge_downgrade", source: "20261002000011_coregrid_v1_knowledge_currency.sql", posture: "zero-policy" },
  { name: "cg_tool_runtime_tool", source: "20261002000012_coregrid_v1_tool_runtime.sql", posture: "zero-policy" },
  { name: "cg_tool_runtime_invocation", source: "20261002000012_coregrid_v1_tool_runtime.sql", posture: "zero-policy" },
];

// The J-005/J-006 policy migration that introduced the policy-backed posture
// (cited by RLS_ISOLATION_BATTERY.md §7; kept as battery provenance).
const POLICY_MIGRATION = "20261002000013_coregrid_v1_neutral_membership_policies.sql";

function failInvalidPosture(fileName, message) {
  throw new Error(`invalid posture file ${fileName}: ${message}`);
}

// Validate + normalize ONE posture entry. Throws (never warns) on any shape
// that would weaken or ambiguate a security check — posture data is security
// data and must fail closed. Unknown fields pass through untouched as
// provenance (rationale, appendOnly, absentPolicies, …).
export function validatePostureEntry(rawEntry, fileName) {
  if (rawEntry === null || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
    failInvalidPosture(fileName, "entry must be a JSON object naming the table, posture, expected policy names and force expectation");
  }
  const tableName = rawEntry.table ?? rawEntry.name;
  if (typeof tableName !== "string" || !TABLE_NAME_PATTERN.test(tableName)) {
    failInvalidPosture(
      fileName,
      `entry must name a table via "table" (or "name") matching ${TABLE_NAME_PATTERN} (got ${JSON.stringify(tableName ?? null)})`,
    );
  }
  if (rawEntry.table !== undefined && rawEntry.name !== undefined && rawEntry.table !== rawEntry.name) {
    failInvalidPosture(
      fileName,
      `entry declares conflicting table names: ${JSON.stringify(rawEntry.table)} vs ${JSON.stringify(rawEntry.name)}`,
    );
  }
  if (!TABLE_POSTURES.includes(rawEntry.posture)) {
    failInvalidPosture(
      fileName,
      `entry ${tableName}: posture must be one of ${TABLE_POSTURES.join(" | ")} (got ${JSON.stringify(rawEntry.posture ?? null)})`,
    );
  }
  const rawSource = rawEntry.source ?? rawEntry.sourceMigration;
  if (rawSource !== undefined && (typeof rawSource !== "string" || rawSource.trim() === "")) {
    failInvalidPosture(fileName, `entry ${tableName}: source/sourceMigration must be a non-empty string (migration provenance)`);
  }
  if (rawEntry.policies !== undefined && !Array.isArray(rawEntry.policies)) {
    failInvalidPosture(fileName, `entry ${tableName}: policies must be an array of policy names or declaration objects`);
  }
  const policyDeclarations = rawEntry.policies ?? [];
  const policyNames = policyDeclarations.map((p) => {
    if (typeof p === "string") {
      if (p.trim() === "") failInvalidPosture(fileName, `entry ${tableName}: policy names must be non-empty strings`);
      return p;
    }
    if (p !== null && typeof p === "object" && !Array.isArray(p) && typeof p.name === "string" && p.name.trim() !== "") {
      return p.name;
    }
    failInvalidPosture(
      fileName,
      `entry ${tableName}: policies entries must be policy-name strings or declaration objects with a non-empty "name" (got ${JSON.stringify(p ?? null)})`,
    );
  });
  if (new Set(policyNames).size !== policyNames.length) {
    failInvalidPosture(fileName, `entry ${tableName}: policies must not repeat a policy name`);
  }
  if (
    rawEntry.tenantColumn !== undefined &&
    (typeof rawEntry.tenantColumn !== "string" || !SQL_IDENTIFIER_PATTERN.test(rawEntry.tenantColumn))
  ) {
    failInvalidPosture(fileName, `entry ${tableName}: tenantColumn must be a plain SQL identifier when present`);
  }
  if (rawEntry.forceRls !== undefined && typeof rawEntry.forceRls !== "boolean") {
    failInvalidPosture(fileName, `entry ${tableName}: forceRls must be a boolean when present`);
  }
  if (rawEntry.privileges !== undefined) {
    if (rawEntry.privileges === null || typeof rawEntry.privileges !== "object" || Array.isArray(rawEntry.privileges)) {
      failInvalidPosture(fileName, `entry ${tableName}: privileges must be an object keyed by role when present`);
    }
    for (const role of ["anon", "authenticated", "public", "service_role"]) {
      const declared = rawEntry.privileges[role];
      if (declared === undefined) continue;
      if (!Array.isArray(declared) || declared.some((x) => typeof x !== "string" || x.trim() === "")) {
        failInvalidPosture(fileName, `entry ${tableName}: privileges.${role} must be an array of non-empty privilege names when declared`);
      }
    }
    if (
      rawEntry.posture === "policy-backed" &&
      rawEntry.privileges.authenticated !== undefined &&
      rawEntry.privileges.authenticated.length === 0
    ) {
      failInvalidPosture(
        fileName,
        `entry ${tableName}: policy-backed privileges.authenticated must be non-empty when declared (the policies must be the operative row gate)`,
      );
    }
  }
  const hasSeedRows = rawEntry.probeSeedRows !== undefined;
  const hasInsertPayload = rawEntry.probeInsertPayload !== undefined;
  if (hasSeedRows || hasInsertPayload) {
    if (rawEntry.posture !== "policy-backed") {
      failInvalidPosture(fileName, `entry ${tableName}: a §4.4 probe recipe is only meaningful on the policy-backed posture`);
    }
    if (!hasSeedRows || !hasInsertPayload) {
      failInvalidPosture(
        fileName,
        `entry ${tableName}: the probe recipe must declare BOTH probeSeedRows and probeInsertPayload (partial declarations are rejected)`,
      );
    }
    if (
      !Array.isArray(rawEntry.probeSeedRows) ||
      rawEntry.probeSeedRows.length === 0 ||
      rawEntry.probeSeedRows.some(
        (r) => r === null || typeof r !== "object" || Array.isArray(r) || Object.keys(r).length === 0,
      )
    ) {
      failInvalidPosture(
        fileName,
        `entry ${tableName}: probeSeedRows must be a non-empty array of non-empty column->value objects`,
      );
    }
    if (rawEntry.probeInsertPayload === null || typeof rawEntry.probeInsertPayload !== "object" || Array.isArray(rawEntry.probeInsertPayload)) {
      failInvalidPosture(fileName, `entry ${tableName}: probeInsertPayload must be a column->value object`);
    }
  }
  if (rawEntry.probeAuxTables !== undefined) {
    if (rawEntry.posture !== "policy-backed" || !hasSeedRows) {
      failInvalidPosture(
        fileName,
        `entry ${tableName}: probeAuxTables is only meaningful alongside a policy-backed §4.4 probe recipe (probeSeedRows + probeInsertPayload)`,
      );
    }
    if (!Array.isArray(rawEntry.probeAuxTables) || rawEntry.probeAuxTables.length === 0) {
      failInvalidPosture(fileName, `entry ${tableName}: probeAuxTables must be a non-empty array when present`);
    }
    for (const aux of rawEntry.probeAuxTables) {
      if (aux === null || typeof aux !== "object" || Array.isArray(aux)) {
        failInvalidPosture(fileName, `entry ${tableName}: probeAuxTables entries must be objects`);
      }
      if (typeof aux.table !== "string" || !SQL_IDENTIFIER_PATTERN.test(aux.table) || !aux.table.startsWith("cg_")) {
        failInvalidPosture(fileName, `entry ${tableName}: probeAuxTables.table must be a cg_-prefixed SQL identifier`);
      }
      if (typeof aux.tenantColumn !== "string" || !SQL_IDENTIFIER_PATTERN.test(aux.tenantColumn)) {
        failInvalidPosture(fileName, `entry ${tableName}: probeAuxTables.tenantColumn must be a plain SQL identifier`);
      }
      if (
        !Array.isArray(aux.seedRows) ||
        aux.seedRows.length === 0 ||
        aux.seedRows.some((r) => r === null || typeof r !== "object" || Array.isArray(r) || Object.keys(r).length === 0)
      ) {
        failInvalidPosture(
          fileName,
          `entry ${tableName}: probeAuxTables.seedRows must be a non-empty array of non-empty column->value objects`,
        );
      }
    }
  }

  const normalized = {
    ...rawEntry,
    name: tableName,
    // Provenance (AGENTS §12): a posture entry must answer WHERE it came from.
    source: rawSource ?? `posture-file:${fileName}`,
    posture: rawEntry.posture,
    forceRls: rawEntry.forceRls ?? rawEntry.posture === "policy-backed",
    postureSource: fileName,
  };
  normalized.policies = policyNames;
  if (policyDeclarations.some((p) => typeof p !== "string")) {
    normalized.policyDeclarations = policyDeclarations;
  }
  if (rawEntry.posture === "policy-backed") {
    if (policyNames.length === 0) {
      failInvalidPosture(fileName, `entry ${tableName}: policy-backed posture must declare the exact expected policy names (non-empty policies array)`);
    }
    if (typeof rawEntry.tenantColumn !== "string") {
      failInvalidPosture(fileName, `entry ${tableName}: policy-backed posture must declare tenantColumn (the cross-tenant probes filter by it)`);
    }
    if (normalized.forceRls !== true) {
      failInvalidPosture(fileName, `entry ${tableName}: policy-backed posture must expect FORCE RLS (forceRls=true)`);
    }
  } else {
    if (policyNames.length > 0) {
      failInvalidPosture(fileName, `entry ${tableName}: zero-policy posture must not declare policies (zero policies IS the posture)`);
    }
    if (normalized.forceRls === true) {
      failInvalidPosture(
        fileName,
        `entry ${tableName}: zero-policy posture cannot expect FORCE RLS (force cannot strengthen a posture with no policy expression)`,
      );
    }
  }
  return normalized;
}

// Parse ONE posture file: a JSON array of entries, or an object with a
// "tables" (landed sibling shape) or "postures" array. Throws with the file
// name on any defect.
export function parsePostureFile(text, fileName) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`invalid posture file ${fileName}: not valid JSON (${err.message})`);
  }
  let list;
  if (Array.isArray(parsed)) {
    list = parsed;
  } else if (parsed && typeof parsed === "object" && Array.isArray(parsed.tables)) {
    list = parsed.tables;
  } else if (parsed && typeof parsed === "object" && Array.isArray(parsed.postures)) {
    list = parsed.postures;
  } else {
    failInvalidPosture(
      fileName,
      'file must be a JSON array of posture entries, or an object with a "tables" (or "postures") array',
    );
  }
  return list.map((entry) => validatePostureEntry(entry, fileName));
}

// Merge parsed posture files over the built-in canonical posture. Files apply
// in the given order; duplicate table declarations (within or across files)
// are rejected — a security posture must have exactly one source of truth.
export function resolvePostureRegistry(files, fallback = BUILTIN_TABLE_POSTURES) {
  const tables = fallback.map((t) => ({ ...t, postureSource: "builtin-canonical" }));
  const indexByName = new Map(tables.map((t, i) => [t.name, i]));
  const overridden = [];
  const added = [];
  const declaredBy = new Map();
  for (const file of files) {
    const seenInFile = new Set();
    for (const rawEntry of file.entries) {
      const entry = validatePostureEntry(rawEntry, file.name);
      const priorFile = declaredBy.get(entry.name);
      if (priorFile !== undefined || seenInFile.has(entry.name)) {
        throw new Error(
          `invalid posture registry: table ${entry.name} declared more than once (${priorFile ?? file.name} and ${file.name}) — a security posture must have exactly one source of truth`,
        );
      }
      seenInFile.add(entry.name);
      declaredBy.set(entry.name, file.name);
      if (indexByName.has(entry.name)) {
        tables[indexByName.get(entry.name)] = entry;
        overridden.push(entry.name);
      } else {
        indexByName.set(entry.name, tables.length);
        tables.push(entry);
        added.push(entry.name);
      }
    }
  }
  return {
    tables,
    files: files.map((f) => f.name),
    fallbackUsed: files.length === 0,
    overridden,
    added,
  };
}

// I/O wrapper (offline-safe: reads only the repo's posture directory). A
// missing or unreadable directory yields the built-in canonical posture.
export function loadPostureRegistry(dir) {
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    names = [];
  }
  const postureFileNames = names.filter((n) => POSTURE_FILE_PATTERN.test(n)).sort();
  const files = postureFileNames.map((name) => ({
    name,
    entries: parsePostureFile(readFileSync(join(dir, name), "utf8"), name),
  }));
  return resolvePostureRegistry(files);
}

// ---------------------------------------------------------------------------
// §4.4 cross-tenant probe stage resolution (data-declared, fail closed).
// The neutral-membership exemplar tables (J-005/J-006) have the built-in probe
// stage; any other policy-backed table must declare probeSeedRows +
// probeInsertPayload in its posture entry. A policy-backed table with no
// declared probe stage canNOT be given an isolation proof — the battery
// reports CROSS_TENANT_PROBE_STAGE_NOT_DECLARED, never a silent pass.
// ---------------------------------------------------------------------------
export const NEUTRAL_MEMBERSHIP_PROBE_TABLES = new Set([
  "cg_org_membership",
  "cg_role_assignment",
  "cg_role_grant",
]);

export function resolveProbeStage(table) {
  if (table.posture !== "policy-backed") return "not-applicable";
  const hasSeed = Array.isArray(table.probeSeedRows) && table.probeSeedRows.length > 0;
  const hasPayload = table.probeInsertPayload !== undefined && table.probeInsertPayload !== null;
  if (hasSeed && hasPayload) return "recipe";
  if (hasSeed || hasPayload) return "undeclared";
  return NEUTRAL_MEMBERSHIP_PROBE_TABLES.has(table.name) ? "neutral-membership" : "undeclared";
}

// Substitute §4.4 probe-recipe placeholders — exact-match on string values
// only, applied recursively through rows/payloads.
//
// Template form (additive, H3-wave): a value of the shape
// {"$template": "<text>"} substitutes every canonical placeholder occurrence
// INSIDE the text (e.g. "$TENANT_A/evidence/probe.txt"). Exact-match strings
// and all other shapes are untouched — a plain "prefix-$TENANT_A" string still
// stays literal, exactly as before. This exists because derived CHECK
// constraints (e.g. cg_file_object.content_ref = tenant_id || '/' || purpose
// || '/' || filename) cannot be expressed with exact-match placeholders.
export const PROBE_PLACEHOLDERS = ["$TENANT_A", "$TENANT_B", "$ACTOR_A_ID", "$ACTOR_B_ID", "$ACTOR_C_ID", "$RUN_ID"];

export function substituteTemplateText(text, ctx) {
  return PROBE_PLACEHOLDERS.reduce(
    (out, token) => out.split(token).join(Object.hasOwn(ctx, token) ? ctx[token] : token),
    text,
  );
}

export function substituteProbeValue(value, ctx) {
  if (typeof value === "string") return Object.hasOwn(ctx, value) ? ctx[value] : value;
  if (Array.isArray(value)) return value.map((v) => substituteProbeValue(v, ctx));
  if (value !== null && typeof value === "object") {
    if (Object.keys(value).length === 1 && Object.hasOwn(value, "$template") && typeof value.$template === "string") {
      return substituteTemplateText(value.$template, ctx);
    }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substituteProbeValue(v, ctx)]));
  }
  return value;
}

// SQL literal for probe seed rows (probe values are non-secret by construction;
// strings are still escaped defensively — never interpolate raw text).
export function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return `'${text.replace(/'/g, "''")}'`;
}

// Build the privileged-channel INSERT statements for a data-declared probe
// recipe. Table/column identifiers come from the validated posture file and
// are re-checked here — never interpolate unvalidated text into SQL.
export function buildProbeSeedSql(tableName, rows) {
  if (!SQL_IDENTIFIER_PATTERN.test(tableName)) {
    throw new Error(`unsafe probe seed target table: ${JSON.stringify(tableName)}`);
  }
  return rows
    .map((row) => {
      const columns = Object.keys(row);
      if (columns.length === 0) throw new Error(`probe seed row for ${tableName} is empty`);
      for (const column of columns) {
        if (!SQL_IDENTIFIER_PATTERN.test(column)) {
          throw new Error(`unsafe probe seed column ${JSON.stringify(column)} on ${tableName}`);
        }
      }
      return `INSERT INTO public.${tableName} (${columns.join(", ")}) VALUES (${columns.map((c) => sqlLiteral(row[c])).join(", ")});`;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// Credentials (values are never printed)
// ---------------------------------------------------------------------------
const supabaseUrl = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
// Defensive: without SUPABASE_URL the credential gate below must reach its
// documented BLOCKED_NO_CREDENTIAL exit, not an unhandled URL-parse throw.
const projectRef = supabaseUrl ? new URL(supabaseUrl).hostname.split(".")[0] : "";
const managementEndpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;

// Resolved only on the CLI path (ensureCredentials). Importing this module —
// as the unit suite does — must not require credentials, touch the network,
// write artifacts, or exit. Environment first (the documented contract),
// .env.local as the interactive fallback.
let token = process.env.SUPABASE_ACCESS_TOKEN ?? "";
let anonKey = "";
let anonKeyProvenance = null;

// The anon key is the credential EVERY unauthenticated client shares (public
// by design). Resolve it from the environment when it structurally validates
// for THIS project; otherwise fetch the project's own legacy anon key through
// the already-authorized management API — no new credentials, and the
// service_role / secret entries are never requested. The key value itself is
// never printed; only its source and claims are logged.
function anonKeyClaims(key) {
  try {
    const payload = key.split(".")[1];
    if (!payload) return { valid: false, reason: "not-a-jwt" };
    const claims = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
    if (claims.ref !== projectRef) return { valid: false, reason: "ref-mismatch", ref: claims.ref ?? null };
    if (claims.role !== "anon") return { valid: false, reason: "role-not-anon", role: claims.role ?? null };
    if (typeof claims.exp !== "number" || claims.exp * 1000 <= Date.now())
      return { valid: false, reason: "expired-or-missing-exp" };
    return { valid: true, ref: claims.ref, role: claims.role, exp: claims.exp };
  } catch {
    return { valid: false, reason: "unparseable-payload" };
  }
}

async function resolveAnonKey() {
  const envKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
  if (envKey) {
    const claims = anonKeyClaims(envKey);
    if (claims.valid) return { key: envKey, source: "env", claims };
  }
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/api-keys?type=legacy`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    return { key: "", source: "unavailable", claims: { valid: false, reason: `management-api-${res.status}` } };
  }
  const keys = await res.json();
  const anon = keys.find((k) => k.name === "anon" && typeof k.api_key === "string");
  if (!anon) return { key: "", source: "unavailable", claims: { valid: false, reason: "anon-key-not-listed" } };
  return { key: anon.api_key, source: "management-api-legacy", claims: anonKeyClaims(anon.api_key) };
}

// The privileged seed path (RLS battery §4.4 cross-tenant probes) needs the
// auth-admin surface: resolve the service key through the same management API
// (never printed), mirroring scripts/exercise-foundation-loop.mjs.
async function resolveServiceKey() {
  const envKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (envKey) return envKey;
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/api-keys`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const keys = await res.json();
  const service = keys.find((k) => /service|secret/i.test(`${k.name ?? ""} ${k.type ?? ""}`));
  return typeof service?.api_key === "string" ? service.api_key : null;
}

async function ensureCredentials() {
  if (!token) {
    try {
      const envFile = readFileSync(join(root, ".env.local"), "utf8");
      for (const line of envFile.split(/\r?\n/)) {
        const match = line.trim().match(/^(?:export\s+)?SUPABASE_ACCESS_TOKEN\s*=\s*(.*)$/);
        if (match) token = match[1].trim().replace(/^['"]|['"]$/g, "");
      }
    } catch {
      // .env.local absent — env var was the only source.
    }
  }
  if (!supabaseUrl || !token) {
    console.error(
      "BLOCKED_NO_CREDENTIAL need SUPABASE_URL + SUPABASE_ACCESS_TOKEN.",
    );
    process.exit(2);
  }

  const resolved = await resolveAnonKey();
  anonKey = resolved.key;
  anonKeyProvenance = {
    source: resolved.source,
    claims: resolved.claims,
    keyPrefix: anonKey ? anonKey.slice(0, 10) : null,
  };
  if (!anonKey) {
    console.error(
      `BLOCKED_NO_CREDENTIAL could not resolve a structurally valid anon key for project ${projectRef} (env key invalid: ${JSON.stringify(resolved.claims)}; management API fallback failed).`,
    );
    process.exit(2);
  }
}

// ---------------------------------------------------------------------------
// Offline CLI surface (H2-05): --help documents the battery; --dry-parse-scope
// validates the declarative posture registry with no credentials, no network,
// and no live database (canonical serialization stays coordinator-owned).
// ---------------------------------------------------------------------------
function printUsage() {
  process.stdout.write(`COREGRID RLS ISOLATION BATTERY — MISSION-R-85 (V1CAP-073 / J-041) + H2-05 declarative posture registry

Usage:
  node scripts/verify-rls-isolation-battery.mjs                    run the live battery (needs SUPABASE_URL + SUPABASE_ACCESS_TOKEN)
  node scripts/verify-rls-isolation-battery.mjs --help             this help (offline, no credentials touched)
  node scripts/verify-rls-isolation-battery.mjs --dry-parse-scope  resolve the declarative posture registry and print the battery scope (offline)

Exit codes:
  0  PASS (every table proves its declared posture)
  1  FAIL (at least one FINDING — nothing is fixed) or an invalid posture registry (--dry-parse-scope)
  2  BLOCKED_NO_CREDENTIAL

Declarative posture registry (H2-05): per-table posture is DATA in
scripts/verification/rls-table-postures-*.json, applied on top of the built-in
canonical posture (BUILTIN_TABLE_POSTURES), so future policy migrations extend
the battery by adding data, not code. Each entry names the table ("name" or
"table") and carries posture ("zero-policy" | "policy-backed"), the exact
expected policy names ("policies" — strings or declaration objects with a
"name"), the force expectation ("forceRls" — true for policy-backed,
false/absent for zero-policy), and for policy-backed tables the tenantColumn
(plus optionally a declared privileges expectation and a §4.4 probe recipe:
probeSeedRows + probeInsertPayload with $TENANT_A/$TENANT_B/$ACTOR_* /$RUN_ID
placeholders).

Registry rules: files merge in lexical file-name order; a table declared more
than once is REJECTED (a security posture must have exactly one source of
truth); every entry is validated fail-closed before use.
`);
}

function dryParseScope() {
  let registry;
  try {
    registry = loadPostureRegistry(join(root, "scripts", "verification"));
  } catch (err) {
    console.error(`DRY_PARSE_FAIL ${err.message}`);
    process.exit(1);
  }
  process.stdout.write(
    "COREGRID RLS ISOLATION BATTERY — dry-parse of the declarative posture registry (no credentials, no network, no live database)\n",
  );
  process.stdout.write(
    `posture files: ${registry.files.length ? registry.files.join(", ") : "none (built-in canonical posture fallback)"}\n`,
  );
  for (const t of registry.tables) {
    const policies = t.policies?.length
      ? ` policies=${t.policies.length}(${t.policies.join(",")})`
      : " policies=0";
    const force = t.forceRls ?? t.posture === "policy-backed";
    process.stdout.write(
      `${t.name} posture=${t.posture} forceRls=${force}${policies} tenantColumn=${t.tenantColumn ?? "n/a"} source=${t.source} postureSource=${t.postureSource ?? "builtin-canonical"}\n`,
    );
  }
  const policyBacked = registry.tables.filter((t) => t.posture === "policy-backed").length;
  process.stdout.write(
    `DRY_PARSE_OK tables=${registry.tables.length} zero-policy=${registry.tables.length - policyBacked} policy-backed=${policyBacked} overridden=[${registry.overridden.join(", ") || "none"}] added=[${registry.added.join(", ") || "none"}]\n`,
  );
}

function handleCliFlags() {
  const args = process.argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    printUsage();
    process.exit(0);
  }
  if (args.includes("--dry-parse-scope")) {
    dryParseScope();
    process.exit(0);
  }
}

// ---------------------------------------------------------------------------
// Output plumbing: console + human log, and structured JSON results.
// ---------------------------------------------------------------------------
let results = null;

function report(line) {
  process.stdout.write(line + "\n");
  appendFileSync(logPath, line + "\n");
}

function truncateEvidence(text, max = 200) {
  const safe = String(text)
    .replace(/sbp_[A-Za-z0-9_\-]+/g, "[redacted]")
    .replace(/eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/g, "[redacted-jwt]")
    .replace(/\s+/g, " ")
    .trim();
  return safe.length > max ? safe.slice(0, max) + "…" : safe;
}

async function runCatalogQuery(query) {
  const res = await fetch(managementEndpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  let rows = null;
  try {
    rows = JSON.parse(text);
  } catch {
    rows = null;
  }
  return { ok: res.ok, status: res.status, rows, text };
}

async function restGet(table, search, headers) {
  const url = `${supabaseUrl}/rest/v1/${table}${search}`;
  const res = await fetch(url, { headers });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { url, status: res.status, text, body };
}

async function anonRestProbe(table) {
  // The probe a real unauthenticated client performs: shared anon key only,
  // no user JWT, no service credentials.
  const probe = await restGet(table, "?select=*&limit=1", {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
  });
  const permissionDenied =
    probe.status === 401 || probe.status === 403
      ? /42501|permission denied/i.test(probe.text)
      : false;
  const invalidApiKey = /Invalid API key/i.test(probe.text);
  const deniedWithZeroRows = probe.status === 200 && Array.isArray(probe.body) && probe.body.length === 0;
  const leaked = probe.status === 200 && Array.isArray(probe.body) && probe.body.length > 0;
  // Honesty rule: only a GENUINE RLS/privilege denial (or an RLS-filtered
  // empty set) counts as proof. An API-key rejection ("Invalid API key")
  // proves nothing about row security and is recorded as INCONCLUSIVE.
  const verdict = leaked
    ? "FAIL"
    : deniedWithZeroRows || permissionDenied
      ? "PASS"
      : "INCONCLUSIVE";
  const denialForm = permissionDenied
    ? "permission-denied-42501"
    : deniedWithZeroRows
      ? "zero-rows"
      : invalidApiKey
        ? "invalid-api-key"
        : null;
  return {
    url: probe.url,
    status: probe.status,
    bodyPreview: truncateEvidence(probe.text),
    verdict,
    denialForm,
  };
}

// ---------------------------------------------------------------------------
// Catalog enforcement + privilege queries (read-only, pg_catalog / information_schema).
// The cg_% enumeration stays (it powers the scope-drift INFO check); tables
// declared by posture files outside the cg_ namespace (e.g. transport_buses)
// are matched by name. Table names are validated identifiers, never raw text.
// ---------------------------------------------------------------------------
const CATALOG_TABLE_FILTER = (column, declaredNonCg) =>
  declaredNonCg.length === 0
    ? `${column} LIKE 'cg\\_%'`
    : `(${column} LIKE 'cg\\_%' OR ${column} IN (${declaredNonCg.map((n) => `'${n}'`).join(", ")}))`;

const rlsCatalogQuery = (declaredNonCg) => `
  SELECT c.relname AS table_name,
         c.relrowsecurity AS rls_enabled,
         c.relforcerowsecurity AS rls_forced
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND ${CATALOG_TABLE_FILTER("c.relname", declaredNonCg)}
   ORDER BY 1;
`;
const policyCatalogQuery = (declaredNonCg) => `
  SELECT tablename, policyname, permissive, cmd
    FROM pg_policies
   WHERE schemaname = 'public' AND ${CATALOG_TABLE_FILTER("tablename", declaredNonCg)}
   ORDER BY 1, 2;
`;
const grantCatalogQuery = (declaredNonCg) => `
  SELECT table_name, grantee, privilege_type
    FROM information_schema.table_privileges
   WHERE table_schema = 'public'
     AND ${CATALOG_TABLE_FILTER("table_name", declaredNonCg)}
     AND grantee IN ('anon', 'authenticated', 'public')
   ORDER BY 1, 2, 3;
`;

// ---------------------------------------------------------------------------
// Cross-tenant probe harness (RLS battery §4.4, post J-005/J-006).
// Privileged seed/cleanup via the management channel; probe users are real
// authenticated principals created through the auth admin API. Every probe
// row/user is cleaned up and the cleanup is verified (probe_cleaned=true).
// The probed-table rows themselves are data-declared: neutral-membership
// exemplar tables are probed through their own bindings; any other
// policy-backed table must declare probeSeedRows + probeInsertPayload in its
// posture entry (placeholders substituted per run).
// ---------------------------------------------------------------------------
async function crossTenantProbe(table, entry) {
  const probeStage = resolveProbeStage(table);
  const recipeSeeded = probeStage === "recipe";
  const probe = {
    privilegedSeed: "PRIVILEGED_SEED_USED_EXPLICITLY — management-channel SQL seed for §4.4 cross-tenant probes; explicit and logged, never a client data path",
    stage: probeStage,
    runId: randomBytes(6).toString("hex"),
    tenantA: null,
    tenantB: null,
    seeded: false,
    tenantAVisible: null,
    tenantBInvisible: null,
    rowsReturnedAllTenantA: null,
    expiredAccessFails: null,
    crossTenantInsertDenied: null,
    forgedGrantorInsertDenied: null,
    cleaned: false,
    cleanupVerified: null,
  };
  const suffix = probe.runId;
  probe.tenantA = `battery-tenant-a-${suffix}`;
  probe.tenantB = `battery-tenant-b-${suffix}`;
  const password = randomBytes(18).toString("base64url");
  const users = {
    a: { email: `battery-rls-a-${suffix}@example.invalid`, id: null, password },
    b: { email: `battery-rls-b-${suffix}@example.invalid`, id: null, password: randomBytes(18).toString("base64url") },
    c: { email: `battery-rls-c-${suffix}@example.invalid`, id: null, password: randomBytes(18).toString("base64url") },
  };
  const tenantCol = table.tenantColumn;
  const isGrantTable = table.name === "cg_role_grant";
  const probeContext = () => ({
    $TENANT_A: probe.tenantA,
    $TENANT_B: probe.tenantB,
    $ACTOR_A_ID: users.a.id,
    $ACTOR_B_ID: users.b.id,
    $ACTOR_C_ID: users.c.id,
    $RUN_ID: suffix,
  });

  async function sql(statements) {
    const res = await runCatalogQuery(statements);
    if (!res.ok) throw new Error(`probe SQL failed [${res.status}]: ${truncateEvidence(res.text, 300)}`);
    return res.rows;
  }

  async function authAdmin(path, init = {}) {
    const res = await fetch(`${supabaseUrl}/auth/v1${path}`, {
      ...init,
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    return res;
  }

  async function cleanup() {
    try {
      const auxTables = recipeSeeded ? (table.probeAuxTables ?? []) : [];
      const recipeDelete = recipeSeeded
        ? `DELETE FROM public.${table.name} WHERE ${tenantCol} IN ('${probe.tenantA}','${probe.tenantB}');\n        `
        : "";
      const auxDeletes = auxTables
        .map((aux) => `DELETE FROM public.${aux.table} WHERE ${aux.tenantColumn} IN ('${probe.tenantA}','${probe.tenantB}');`)
        .join("\n        ");
      const recipeCount = recipeSeeded
        ? `
        + (SELECT count(*) FROM public.${table.name} WHERE ${tenantCol} IN ('${probe.tenantA}','${probe.tenantB}'))`
        : "";
      const auxCount = auxTables
        .map(
          (aux) => `
        + (SELECT count(*) FROM public.${aux.table} WHERE ${aux.tenantColumn} IN ('${probe.tenantA}','${probe.tenantB}'))`,
        )
        .join("");
      await sql(`
        ${recipeDelete}${auxDeletes.length > 0 ? `${auxDeletes}\n        ` : ""}DELETE FROM public.cg_org_membership WHERE tenant_id IN ('${probe.tenantA}','${probe.tenantB}');
        DELETE FROM public.cg_role_grant WHERE tenant_ref IN ('${probe.tenantA}','${probe.tenantB}');
        DELETE FROM public.cg_role_assignment WHERE tenant_ref IN ('${probe.tenantA}','${probe.tenantB}');
        DELETE FROM public.cg_org_unit WHERE tenant_id IN ('${probe.tenantA}','${probe.tenantB}');
      `);
      for (const u of Object.values(users)) {
        if (u.id) await authAdmin(`/admin/users/${u.id}`, { method: "DELETE" });
      }
      const leftover = await sql(`
        SELECT
          (SELECT count(*) FROM public.cg_role_assignment WHERE tenant_ref IN ('${probe.tenantA}','${probe.tenantB}'))
        + (SELECT count(*) FROM public.cg_role_grant WHERE tenant_ref IN ('${probe.tenantA}','${probe.tenantB}'))
        + (SELECT count(*) FROM public.cg_org_membership WHERE tenant_id IN ('${probe.tenantA}','${probe.tenantB}'))
        + (SELECT count(*) FROM public.cg_org_unit WHERE tenant_id IN ('${probe.tenantA}','${probe.tenantB}'))${recipeCount}${auxCount} AS remaining;
      `);
      probe.cleanupVerified = Number(leftover[0]?.remaining ?? -1) === 0;
      probe.cleaned = probe.cleanupVerified;
      report(`probe cleanup: probe_cleaned=${probe.cleaned} (re-count verified=${probe.cleanupVerified})`);
    } catch (err) {
      probe.cleaned = false;
      probe.cleanupVerified = false;
      report(`FINDING probe cleanup failed: ${truncateEvidence(err.message, 300)}`);
      results.findings.push({
        table: table.name,
        section: "crossTenantProbe",
        finding: "PROBE_CLEANUP_FAILED",
        evidence: truncateEvidence(err.message, 300),
      });
    }
  }

  let serviceKey = null;
  try {
    serviceKey = await resolveServiceKey();
    if (!serviceKey) throw new Error("service key unavailable through the authorized management API");

    // 1. Seed: two tenants, three real auth principals, neutral bindings.
    for (const [key, u] of Object.entries(users)) {
      const created = await authAdmin("/admin/users", {
        method: "POST",
        body: JSON.stringify({ email: u.email, password: u.password, email_confirm: true }),
      });
      if (!created.ok) throw new Error(`create probe user ${key} failed [${created.status}]: ${truncateEvidence(await created.text(), 300)}`);
      const body = await created.json();
      u.id = body.id ?? body.user?.id;
      if (!u.id) throw new Error(`created probe user ${key} has no id`);
    }
    await sql(`
      INSERT INTO public.cg_org_unit (id, tenant_id, kind, created_by) VALUES
        ('battery-unit-a-${suffix}', '${probe.tenantA}', 'organization', 'battery-seed'),
        ('battery-unit-b-${suffix}', '${probe.tenantB}', 'organization', 'battery-seed');
      -- Tenant A: active neutral bindings for principal A (assignment + membership)
      INSERT INTO public.cg_role_assignment (tenant_ref, identity_ref, role_id, status) VALUES
        ('${probe.tenantA}', '${users.a.id}', 'role:actor', 'active'),
        ('${probe.tenantA}', 'battery-ghost-${suffix}', 'role:contributor', 'active');
      INSERT INTO public.cg_role_grant (tenant_ref, role_id, capability, granted_by) VALUES
        ('${probe.tenantA}', 'role:actor', 'battery-probe-${suffix}', 'battery-seed');
      INSERT INTO public.cg_org_membership (id, tenant_id, org_unit_id, principal_ref, role_ref, state, created_by) VALUES
        ('battery-mem-a-${suffix}', '${probe.tenantA}', 'battery-unit-a-${suffix}', '${users.a.id}', 'role:actor', 'active', 'battery-seed');
      -- Tenant B: principal B active; principal C holds an EXPIRED binding (ended_on < today)
      INSERT INTO public.cg_role_assignment (tenant_ref, identity_ref, role_id, status) VALUES
        ('${probe.tenantB}', '${users.b.id}', 'role:actor', 'active');
      INSERT INTO public.cg_role_assignment (tenant_ref, identity_ref, role_id, status, started_on, ended_on) VALUES
        ('${probe.tenantB}', '${users.c.id}', 'role:actor', 'active', CURRENT_DATE - 30, CURRENT_DATE - 1);
      INSERT INTO public.cg_role_grant (tenant_ref, role_id, capability, granted_by) VALUES
        ('${probe.tenantB}', 'role:actor', 'battery-probe-${suffix}', 'battery-seed');
      INSERT INTO public.cg_org_membership (id, tenant_id, org_unit_id, principal_ref, role_ref, state, created_by) VALUES
        ('battery-mem-b-${suffix}', '${probe.tenantB}', 'battery-unit-b-${suffix}', '${users.b.id}', 'role:actor', 'active', 'battery-seed');
    `);
    if (recipeSeeded) {
      for (const aux of table.probeAuxTables ?? []) {
        const auxRows = aux.seedRows.map((row) => substituteProbeValue(row, probeContext()));
        await sql(buildProbeSeedSql(aux.table, auxRows));
        report(`probe aux seed: ${auxRows.length} parent row(s) inserted into ${aux.table} via the privileged channel (composite-FK parent of the §4.4 probe; values non-secret by construction)`);
      }
      const seedRows = table.probeSeedRows.map((row) => substituteProbeValue(row, probeContext()));
      await sql(buildProbeSeedSql(table.name, seedRows));
      report(`probe seed: ${table.probeSeedRows.length} Tenant-A row(s) inserted into ${table.name} via the privileged channel (data-declared probe recipe; values non-secret by construction)`);
    }
    probe.seeded = true;
    report(`seed complete: tenantA=${probe.tenantA} tenantB=${probe.tenantB} principals=3 (A active-in-A, B active-in-B, C expired-in-B); probe row values are non-secret by construction`);

    // 2. Authenticated Tenant A session (password grant — a real client login).
    const signedIn = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email: users.a.email, password }),
    });
    if (!signedIn.ok) throw new Error(`probe sign-in failed [${signedIn.status}]: ${truncateEvidence(await signedIn.text(), 300)}`);
    const session = await signedIn.json();
    const userAToken = session.access_token;
    if (!userAToken) throw new Error("probe session returned no access token");
    const userAHeaders = { apikey: anonKey, Authorization: `Bearer ${userAToken}` };

    // 3. Read as authenticated Tenant A principal: ALL of tenant A's own rows
    //    must be visible (a policy that denies Tenant A its own rows is a
    //    finding too) and NOTHING of tenant B's.
    const ownRead = await restGet(table.name, `?select=*`, userAHeaders);
    if (ownRead.status !== 200 || !Array.isArray(ownRead.body)) {
      throw new Error(`authenticated own-tenant read failed [${ownRead.status}]: ${truncateEvidence(ownRead.text, 300)}`);
    }
    probe.tenantAVisible = ownRead.body.length >= 1;
    probe.rowsReturnedAllTenantA = ownRead.body.every((r) => r[tenantCol] === probe.tenantA);

    const crossRead = await restGet(table.name, `?select=*&${tenantCol}=eq.${probe.tenantB}`, userAHeaders);
    probe.tenantBInvisible = crossRead.status === 200 && Array.isArray(crossRead.body) && crossRead.body.length === 0;

    // 4. Expired/revoked access fails: principal C (binding ended yesterday)
    //    must see zero rows even in the tenant where it once held a binding.
    const signedInC = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email: users.c.email, password: users.c.password }),
    });
    if (!signedInC.ok) throw new Error(`expired-principal sign-in failed [${signedInC.status}]: ${truncateEvidence(await signedInC.text(), 300)}`);
    const sessionC = await signedInC.json();
    const userCToken = sessionC.access_token;
    const expiredRead = await restGet(table.name, `?select=*`, { apikey: anonKey, Authorization: `Bearer ${userCToken}` });
    probe.expiredAccessFails = expiredRead.status === 200 && Array.isArray(expiredRead.body) && expiredRead.body.length === 0;

    // 5. Negative write probes (no rows are created when policies hold):
    //    cross-tenant INSERT denied; forged grantor denied (cg_role_grant).
    //    For data-declared probe recipes the payload comes from the posture
    //    entry (placeholders substituted per run).
    async function restInsert(payload) {
      const res = await fetch(`${supabaseUrl}/rest/v1/${table.name}`, {
        method: "POST",
        headers: { ...userAHeaders, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      return { status: res.status, text };
    }
    const crossInsertPayload = recipeSeeded
      ? substituteProbeValue(table.probeInsertPayload, probeContext())
      : isGrantTable
        ? { tenant_ref: probe.tenantB, role_id: "role:actor", capability: `battery-x-${suffix}`, granted_by: users.a.id }
        : table.name === "cg_org_membership"
          ? { id: `battery-x-${suffix}`, tenant_id: probe.tenantB, org_unit_id: `battery-unit-b-${suffix}`, principal_ref: users.a.id, role_ref: "role:actor", state: "active" }
          : { tenant_ref: probe.tenantB, identity_ref: users.a.id, role_id: "role:actor", status: "active" };
    const crossInsert = await restInsert(crossInsertPayload);
    probe.crossTenantInsertDenied =
      (crossInsert.status === 400 || crossInsert.status === 401 || crossInsert.status === 403) &&
      /row-level security|42501|permission denied/i.test(crossInsert.text);
    probe.crossTenantInsertEvidence = truncateEvidence(crossInsert.text);

    if (isGrantTable) {
      const forged = await restInsert({
        tenant_ref: probe.tenantA,
        role_id: "role:actor",
        capability: `battery-forged-${suffix}`,
        granted_by: users.b.id,
      });
      probe.forgedGrantorInsertDenied =
        (forged.status === 400 || forged.status === 401 || forged.status === 403) &&
        /row-level security|42501|permission denied/i.test(forged.text);
      probe.forgedGrantorInsertEvidence = truncateEvidence(forged.text);
    }
  } catch (err) {
    probe.error = truncateEvidence(err.message, 300);
    report(`FINDING cross-tenant probe error on ${table.name}: ${probe.error}`);
    results.findings.push({
      table: table.name,
      section: "crossTenantProbe",
      finding: "PROBE_ERROR",
      evidence: probe.error,
    });
  } finally {
    await cleanup();
  }

  // Verdicts (FINDINGS, never silent passes).
  const checks = [
    ["tenantAVisible", probe.tenantAVisible, "Tenant A cannot see its OWN rows (policy over-restrictive)"],
    ["tenantBInvisible", probe.tenantBInvisible, "TENANT B ROWS VISIBLE to Tenant A principal (cross-tenant leak)"],
    ["rowsReturnedAllTenantA", probe.rowsReturnedAllTenantA, "authenticated read returned rows outside Tenant A"],
    ["expiredAccessFails", probe.expiredAccessFails, "EXPIRED binding still sees rows (revoked/expired access did not fail)"],
    ["crossTenantInsertDenied", probe.crossTenantInsertDenied, "cross-tenant INSERT was NOT denied"],
  ];
  if (isGrantTable) {
    checks.push(["forgedGrantorInsertDenied", probe.forgedGrantorInsertDenied, "FORGED GRANTOR accepted on INSERT (client-supplied grantor identity)"]);
  }
  for (const [key, ok, failureText] of checks) {
    if (ok === true) {
      report(`PASS cross-tenant probe: ${key}`);
    } else {
      report(`FAIL cross-tenant probe: ${failureText}`);
      results.findings.push({
        table: table.name,
        section: "crossTenantProbe",
        finding: key.toUpperCase(),
        evidence: probe[`${key}Evidence`] ?? probe,
      });
    }
  }
  if (!probe.cleaned) {
    report("FAIL cross-tenant probe: probe rows/users not verifiably cleaned (probe_cleaned=false).");
    results.findings.push({
      table: table.name,
      section: "crossTenantProbe",
      finding: "PROBE_NOT_CLEANED",
      evidence: { cleanupVerified: probe.cleanupVerified },
    });
  }
  return probe;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
async function runBattery() {
  // Declarative posture registry (H2-05): posture files override/extend the
  // built-in canonical posture. An invalid or ambiguous registry BLOCKS the
  // battery — security posture data fails closed, never open.
  const registry = loadPostureRegistry(join(root, "scripts", "verification"));
  const TABLES = registry.tables;
  const TABLE_NAMES = TABLES.map((t) => t.name);

  mkdirSync(artifactsDir, { recursive: true });
  appendFileSync(logPath, `\n=== run ${new Date().toISOString()} project=${projectRef} ===\n`);

  results = {
    mission: "MISSION-R-85",
    capability: "V1CAP-073",
    gap: "J-041",
    projectRef,
    supabaseUrlHost: new URL(supabaseUrl).host,
    executedAt: new Date().toISOString(),
    scope: TABLES,
    transport: [
      "supabase-rest-anon",
      "supabase-rest-authenticated-cross-tenant-probe",
      "supabase-management-api-readonly-sql",
      "supabase-management-api-privileged-seed-clean",
    ],
    anonKeyProvenance,
    postureSource: {
      files: registry.files,
      fallbackUsed: registry.fallbackUsed,
      overriddenTables: registry.overridden,
      addedTables: registry.added,
    },
    tables: [],
    findings: [],
    serviceRoleContrast: null,
    summary: null,
  };

  report(`COREGRID RLS ISOLATION BATTERY — ${results.mission} (${results.capability} / ${results.gap})`);
  report(`project=${projectRef} transport=rest-anon + rest-authenticated-cross-tenant + management-api(readonly catalog SQL + privileged seed/clean)`);
  report(
    `anon key provenance: source=${anonKeyProvenance.source} ref=${anonKeyProvenance.claims.ref ?? "n/a"} role=${anonKeyProvenance.claims.role ?? "n/a"} prefix=${anonKeyProvenance.keyPrefix ?? "n/a"} (value never printed)`,
  );
  report(`honesty rule: zero-policy tables prove DENY (deny is the pass condition); policy-backed tables prove tenant-scoped visibility (genuine cross-tenant probes, §4.4). Deny of Tenant A's own rows is a FINDING too.`);
  report(
    `posture registry (H2-05): files=[${registry.files.join(", ") || "none"}] fallbackUsed=${registry.fallbackUsed} overridden=[${registry.overridden.join(", ") || "none"}] added=[${registry.added.join(", ") || "none"}] policy-migration=${POLICY_MIGRATION}`,
  );
  report("--- catalog enforcement metadata (pg_catalog) ---");

  const declaredNonCgTables = TABLE_NAMES.filter((n) => !n.startsWith("cg_"));
  const [rlsRes, polRes, grantRes] = await Promise.all([
    runCatalogQuery(rlsCatalogQuery(declaredNonCgTables)),
    runCatalogQuery(policyCatalogQuery(declaredNonCgTables)),
    runCatalogQuery(grantCatalogQuery(declaredNonCgTables)),
  ]);

  if (!rlsRes.ok || !polRes.ok || !grantRes.ok) {
    for (const [label, r] of [["rls", rlsRes], ["policies", polRes], ["grants", grantRes]]) {
      if (!r.ok) report(`FAIL catalog query (${label}) [${r.status}] ${truncateEvidence(r.text)}`);
    }
    process.exit(1);
  }

  const rlsRows = Array.isArray(rlsRes.rows) ? rlsRes.rows : [];
  const polRows = Array.isArray(polRes.rows) ? polRes.rows : [];
  const grantRows = Array.isArray(grantRes.rows) ? grantRes.rows : [];

  // Scope check: enumerate every cg_* table actually present, flag drift from
  // the migration-derived scope (extra tables are INFO, not battery failures —
  // they belong to other missions' batteries when they gain RLS scope).
  const presentTables = rlsRows.map((r) => r.table_name);
  const extras = presentTables.filter((t) => !TABLE_NAMES.includes(t));
  const missing = TABLE_NAMES.filter((t) => !presentTables.includes(t));
  for (const extra of extras) report(`INFO table present outside battery scope (source migration not in MISSION-R-85 list): ${extra}`);
  for (const m of missing) report(`FINDING expected substrate table ABSENT from database (migration not applied?): ${m}`);

  // --- per-table sections ---
  for (const table of TABLES) {
    report(`--- table ${table.name} (source: ${table.source}; posture: ${table.posture}; posture source: ${table.postureSource ?? "builtin-canonical"}) ---`);
    const entry = {
      table: table.name,
      source: table.source,
      posture: table.posture,
      postureSource: table.postureSource ?? "builtin-canonical",
      present: !missing.includes(table.name),
      anonRestProbe: null,
      catalogEnforcement: null,
      privileges: null,
      isolationProof: null,
      crossTenantProbe: null,
      verdict: "FAIL",
    };
    results.tables.push(entry);

    const rls = rlsRows.find((r) => r.table_name === table.name);
    const tablePolicies = polRows.filter((p) => p.tablename === table.name);
    const permissivePolicies = tablePolicies.filter((p) => p.permissive === "PERMISSIVE");
    const tableGrants = grantRows.filter((g) => g.table_name === table.name);

    // (b) catalog enforcement — posture-dependent
    const rlsEnabled = rls?.rls_enabled === true;
    const rlsForced = rls?.rls_forced === true;
    if (table.posture === "policy-backed") {
      // Force expectation is data-driven (H2-05): the posture entry declares
      // it; validation guarantees policy-backed entries expect FORCE RLS.
      const forceExpected = table.forceRls ?? true;
      const policiesExact =
        tablePolicies.length === table.policies.length &&
        table.policies.every((name) => tablePolicies.some((p) => p.policyname === name));
      entry.catalogEnforcement = {
        rlsEnabled,
        rlsForced,
        forceExpected,
        policiesTotal: tablePolicies.length,
        policies: tablePolicies.map((p) => ({ name: p.policyname, permissive: p.permissive, cmd: p.cmd })),
        policiesExact,
        verdict: rlsEnabled && rlsForced === forceExpected && policiesExact ? "PASS" : "FAIL",
      };
      report(
        `${entry.catalogEnforcement.verdict} relrowsecurity=${rlsEnabled} relforcerowsecurity=${rlsForced} (expected=${forceExpected}) policies=${tablePolicies.length} exact-declared-set=${policiesExact}`,
      );
      if (!rlsEnabled || rlsForced !== forceExpected || !policiesExact) {
        results.findings.push({
          table: table.name,
          section: "catalogEnforcement",
          finding: !rlsEnabled ? "RLS_DISABLED" : rlsForced !== forceExpected ? "RLS_NOT_FORCED" : "POLICY_SET_MISMATCH",
          evidence: entry.catalogEnforcement,
        });
      }
    } else {
      const zeroPolicies = tablePolicies.length === 0;
      const zeroPermissive = permissivePolicies.length === 0;
      entry.catalogEnforcement = {
        rlsEnabled,
        rlsForced,
        policiesTotal: tablePolicies.length,
        policiesPermissive: permissivePolicies.length,
        policies: tablePolicies.map((p) => ({ name: p.policyname, permissive: p.permissive })),
        verdict: rlsEnabled && zeroPermissive ? "PASS" : "FAIL",
      };
      report(
        `${entry.catalogEnforcement.verdict} relrowsecurity=${rlsEnabled} relforcerowsecurity=${rlsForced} policies=${tablePolicies.length} permissive=${permissivePolicies.length}`,
      );
      report(`INFO relforcerowsecurity=${rlsForced} on zero-policy posture (no policy can evaluate true regardless; force-RLS is asserted true only on policy-backed tables)`);
      if (!rlsEnabled || !zeroPermissive) {
        results.findings.push({
          table: table.name,
          section: "catalogEnforcement",
          finding: !rlsEnabled ? "RLS_DISABLED" : "PERMISSIVE_POLICY_PRESENT",
          evidence: entry.catalogEnforcement,
        });
      }
    }

    // (c) privileges — posture-dependent
    const granteePrivs = (grantee) =>
      tableGrants.filter((g) => g.grantee === grantee).map((g) => g.privilege_type);
    const authPrivs = granteePrivs("authenticated");
    const anonPrivs = granteePrivs("anon");
    const publicPrivs = granteePrivs("public");
    if (table.posture === "policy-backed") {
      // The authenticated privilege expectation is data-driven (H2-05): the
      // canonical J-005/J-006 convention is SELECT/INSERT/UPDATE/DELETE; a
      // posture entry may declare a stricter least-privilege set (e.g.
      // SELECT+INSERT for append-only substrates). The exact declared set is
      // asserted — extras are a mismatch, never tolerated.
      const declaredAuthPrivs = Array.isArray(table.privileges?.authenticated)
        ? table.privileges.authenticated
        : null;
      const expectedAuthPrivs = declaredAuthPrivs ?? ["SELECT", "INSERT", "UPDATE", "DELETE"];
      const expectedAuth = expectedAuthPrivs.slice().sort().join(",");
      const authOk = authPrivs.slice().sort().join(",") === expectedAuth;
      const anonPublicOk = anonPrivs.length === 0 && publicPrivs.length === 0;
      entry.privileges = {
        anon: anonPrivs,
        authenticated: authPrivs,
        public: publicPrivs,
        declaredAuthenticated: declaredAuthPrivs ?? "canonical SELECT,INSERT,UPDATE,DELETE",
        verdict: authOk && anonPublicOk ? "PASS" : "FAIL",
      };
      if (entry.privileges.verdict === "PASS") {
        report(`PASS privileges match policy-backed posture: authenticated=${expectedAuth} (policies are the operative row gate); anon/PUBLIC=none`);
      } else {
        report(`FAIL privilege posture mismatch: anon=[${anonPrivs}] authenticated=[${authPrivs}] public=[${publicPrivs}] expected authenticated=[${expectedAuth}]`);
        results.findings.push({
          table: table.name,
          section: "privileges",
          finding: "PRIVILEGE_POSTURE_MISMATCH",
          evidence: entry.privileges,
        });
      }
    } else {
      entry.privileges = {
        grants: tableGrants,
        verdict: tableGrants.length === 0 ? "PASS" : "FAIL",
      };
      if (tableGrants.length === 0) {
        report(`PASS no table grants to anon / authenticated / PUBLIC`);
      } else {
        report(`FAIL stray grants: ${tableGrants.map((g) => `${g.grantee}:${g.privilege_type}`).join(", ")}`);
        results.findings.push({
          table: table.name,
          section: "privileges",
          finding: "STRAY_GRANTS",
          evidence: tableGrants,
        });
      }
    }

    // (a) anon REST probe — the live public data plane
    const probe = await anonRestProbe(table.name);
    entry.anonRestProbe = probe;
    report(
      `${probe.verdict} anon REST probe status=${probe.status} denialForm=${probe.denialForm ?? "n/a"} evidence="${probe.bodyPreview}"`,
    );
    if (probe.verdict === "FAIL") {
      results.findings.push({
        table: table.name,
        section: "anonRestProbe",
        finding: "ROW_LEAK_VIA_ANON_REST",
        evidence: { status: probe.status, bodyPreview: probe.bodyPreview },
      });
    } else if (probe.verdict === "INCONCLUSIVE") {
      results.findings.push({
        table: table.name,
        section: "anonRestProbe",
        finding: "INCONCLUSIVE_PROBE",
        evidence: { status: probe.status, bodyPreview: probe.bodyPreview },
      });
    }

    // (d) isolation proof — strongest-form derivation (zero-policy) or genuine
    // cross-tenant probes (policy-backed).
    const catalogOk = entry.catalogEnforcement?.verdict === "PASS";
    const privilegesOk = entry.privileges?.verdict === "PASS";
    const probeOk = probe.verdict === "PASS";

    if (table.posture === "policy-backed") {
      // §4.4 probe stage is data-declared (H2-05): neutral-membership exemplar
      // tables use the built-in stage; other policy-backed tables must declare
      // probeSeedRows + probeInsertPayload. Undeclared = FINDING, never a
      // silent pass and never an unprovable claim.
      const stage = resolveProbeStage(table);
      const probesRunnable = catalogOk && privilegesOk && probeOk;
      if (probesRunnable && stage === "undeclared") {
        report(
          `FAIL cross-tenant probe stage not declared for ${table.name}: policy-backed posture without a §4.4 probe recipe (probeSeedRows + probeInsertPayload) and not a neutral-membership exemplar — the battery refuses to claim an unprovable isolation proof.`,
        );
        results.findings.push({
          table: table.name,
          section: "crossTenantProbe",
          finding: "CROSS_TENANT_PROBE_STAGE_NOT_DECLARED",
          evidence: {
            postureSource: table.postureSource ?? "builtin-canonical",
            remediation:
              "declare probeSeedRows + probeInsertPayload in the posture file (data, not code) using the $TENANT_A/$TENANT_B/$ACTOR_A_ID/$ACTOR_B_ID/$ACTOR_C_ID/$RUN_ID placeholders",
          },
        });
      }
      const crossProbe = probesRunnable && stage !== "undeclared" ? await crossTenantProbe(table, entry) : null;
      entry.crossTenantProbe = crossProbe ?? (probesRunnable && stage === "undeclared" ? { stage: "undeclared", note: "probe stage not declared in posture data — see CROSS_TENANT_PROBE_STAGE_NOT_DECLARED finding" } : null);
      const probesOk = Boolean(
        crossProbe &&
          crossProbe.tenantAVisible === true &&
          crossProbe.tenantBInvisible === true &&
          crossProbe.rowsReturnedAllTenantA === true &&
          crossProbe.expiredAccessFails === true &&
          crossProbe.crossTenantInsertDenied === true &&
          (table.name !== "cg_role_grant" || crossProbe.forgedGrantorInsertDenied === true) &&
          crossProbe.cleaned === true,
      );
      entry.isolationProof = {
        posture: "policy-backed — genuine cross-tenant probes (§4.4)",
        statements: [
          {
            invariant: "Tenant A cannot read Tenant B",
            proof: crossProbe?.tenantBInvisible
              ? `PROVEN: authenticated Tenant A principal read ${table.name} filtered to Tenant B — 0 rows returned (live REST, real JWT session).`
              : "NOT PROVEN — see crossTenantProbe findings",
            verdict: crossProbe?.tenantBInvisible ? "PASS" : "FAIL",
          },
          {
            invariant: "User A cannot read User B (own-tenant rows still visible)",
            proof:
              crossProbe?.tenantAVisible && crossProbe?.rowsReturnedAllTenantA
                ? `PROVEN: Tenant A principal sees its own tenant rows (tenantAVisible=${crossProbe.tenantAVisible}) and every returned row belongs to Tenant A; User B's rows live in Tenant B and are absent.`
                : "NOT PROVEN — see crossTenantProbe findings",
            verdict: crossProbe?.tenantAVisible && crossProbe?.rowsReturnedAllTenantA ? "PASS" : "FAIL",
          },
          {
            invariant: "Revoked / expired access fails",
            proof: crossProbe?.expiredAccessFails
              ? "PROVEN: a principal whose only neutral binding ended yesterday (ended_on < CURRENT_DATE) reads 0 rows — the neutral primitive's time-validity excludes expired access."
              : "NOT PROVEN — see crossTenantProbe findings",
            verdict: crossProbe?.expiredAccessFails ? "PASS" : "FAIL",
          },
          {
            invariant: "Agent cannot exceed permissions",
            proof: crossProbe?.crossTenantInsertDenied
              ? `PROVEN: cross-tenant INSERT denied at the policy layer (${crossProbe.crossTenantInsertEvidence || "row-level security violation"}); anon denied in (a); the only privileged path is the explicit logged service/management channel.`
              : "NOT PROVEN — see crossTenantProbe findings",
            verdict: crossProbe?.crossTenantInsertDenied ? "PASS" : "FAIL",
          },
          ...(table.name === "cg_role_grant"
            ? [
                {
                  invariant: "No client-supplied grantor identity",
                  proof: crossProbe?.forgedGrantorInsertDenied
                    ? `PROVEN: INSERT with granted_by = another principal's id is rejected by the policy WITH CHECK (${crossProbe.forgedGrantorInsertEvidence || "row-level security violation"}).`
                    : "NOT PROVEN — see crossTenantProbe findings",
                  verdict: crossProbe?.forgedGrantorInsertDenied ? "PASS" : "FAIL",
                },
              ]
            : []),
        ],
        probeCleaned: crossProbe?.cleaned === true,
        verdict: probesOk ? "PASS" : "FAIL",
      };
      for (const s of entry.isolationProof.statements) report(`${s.verdict} ${s.invariant}: ${s.proof}`);
    } else {
      entry.isolationProof = {
        posture: "zero-policy — STRONGEST FORM derivation",
        strongestFormAsserted: catalogOk && privilegesOk,
        statements: [
          {
            invariant: "Tenant A cannot read Tenant B",
            proof: catalogOk && privilegesOk
              ? "STRONGEST FORM: relrowsecurity=true with zero policies means there is no policy expression anywhere that could evaluate to true for ANY tenant_id — no identity (any tenant) can read a single row. Anon REST probe confirms the public data plane returns no rows."
              : "NOT PROVEN — see catalog/probe findings",
            verdict: catalogOk && privilegesOk ? "PASS" : "FAIL",
          },
          {
            invariant: "User A cannot read User B",
            proof: catalogOk && privilegesOk
              ? "Same mechanism: with zero policies, no auth.uid()-scoped expression exists at all; every authenticated principal is denied identically. Anon REST probe confirms."
              : "NOT PROVEN — see catalog/probe findings",
            verdict: catalogOk && privilegesOk ? "PASS" : "FAIL",
          },
          {
            invariant: "Revoked / expired access fails",
            proof: catalogOk && privilegesOk
              ? "A revoked or expired credential resolves to the anon/authenticated roles through PostgREST; those roles hold no table grants and no policy grants them rows, so every request is denied."
              : "NOT PROVEN — see catalog/probe findings",
            verdict: catalogOk && privilegesOk ? "PASS" : "FAIL",
          },
          {
            invariant: "Agent cannot exceed permissions",
            proof: catalogOk && privilegesOk
              ? "Agents are untrusted identities operating through client roles: no grants + zero policies means no client role — human or agent — can read or write. The ONLY data path is the service_role (explicit, logged, never default — see serviceRoleContrast)."
              : "NOT PROVEN — see catalog/probe findings",
            verdict: catalogOk && privilegesOk ? "PASS" : "FAIL",
          },
        ],
        verdict: catalogOk && privilegesOk && probeOk ? "PASS" : "FAIL",
      };
      for (const s of entry.isolationProof.statements) report(`${s.verdict} ${s.invariant}: ${s.proof}`);
    }

    entry.verdict =
      entry.present &&
      entry.catalogEnforcement.verdict === "PASS" &&
      entry.privileges.verdict === "PASS" &&
      probe.verdict === "PASS" &&
      entry.isolationProof.verdict === "PASS"
        ? "PASS"
        : "FAIL";
    report(`VERDICT ${table.name}: ${entry.verdict}`);
  }

  // ---------------------------------------------------------------------------
  // (e) Service-role contrast — explicit and logged, NEVER default.
  // ---------------------------------------------------------------------------
  if (process.env.COREGRID_BATTERY_ALLOW_SERVICE_ROLE === "1") {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? (await resolveServiceKey());
    if (!serviceKey) {
      report("SKIP service-role contrast requested but no service key is resolvable.");
    } else {
      report("SERVICE_ROLE_USED_EXPLICITLY — opt-in via COREGRID_BATTERY_ALLOW_SERVICE_ROLE=1; contrasting the only privileged data path (never default).");
      const res = await fetch(`${supabaseUrl}/rest/v1/cg_entity?select=*&limit=1`, {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      });
      const text = await res.text();
      results.serviceRoleContrast = {
        explicit: true,
        table: "cg_entity",
        status: res.status,
        bodyPreview: truncateEvidence(text),
        interpretation:
          res.status === 200
            ? "service_role (BYPASSRLS) is the only role that reaches rows; its use is explicit and logged, never a default path."
            : "unexpected — service_role should bypass RLS; investigate.",
      };
      report(`INFO service_role contrast status=${res.status} evidence="${results.serviceRoleContrast.bodyPreview}"`);
    }
  } else {
    report("SKIP service-role contrast not requested (opt-in: COREGRID_BATTERY_ALLOW_SERVICE_ROLE=1). Service-role usage stays explicit and logged, never default.");
  }

  // ---------------------------------------------------------------------------
  // Summary + verdict
  // ---------------------------------------------------------------------------
  const passCount = results.tables.filter((t) => t.verdict === "PASS").length;
  results.summary = { total: results.tables.length, pass: passCount, fail: results.tables.length - passCount };
  report("--- summary ---");
  for (const t of results.tables) report(`${t.verdict} ${t.table} (${t.posture})`);
  report(
    results.summary.fail === 0
      ? `STATUS=PASS — ${passCount}/${results.tables.length} tables prove their declared posture: zero-policy tables prove deny-by-default (RLS on, zero permissive policies, no client grants, anon REST denied, strongest-form isolation); policy-backed tables (J-005/J-006 neutral tenant-membership policies, FORCED RLS) prove genuine cross-tenant isolation (Tenant B invisible, Tenant A own rows visible, expired binding denied, cross-tenant INSERT denied, forged grantor rejected, probes cleaned). Proven against the live database, not reasoned.`
      : `STATUS=FAIL — ${results.summary.fail} table(s) did not prove their declared posture. Recorded as FINDINGS (evidence in ${jsonPath}); per mission law nothing was modified beyond the logged, cleaned probe rows.`,
  );
  if (results.findings.length > 0) {
    report(`FINDINGS (${results.findings.length}):`);
    for (const f of results.findings) report(`  ${f.table} / ${f.section}: ${f.finding}`);
  }

  writeFileSync(jsonPath, JSON.stringify(results, null, 2) + "\n");
  report(`artifacts: ${jsonPath} + ${logPath}`);

  process.exit(results.summary.fail === 0 ? 0 : 1);
}

// ---------------------------------------------------------------------------
// CLI entry: offline flags first (--help / --dry-parse-scope exit before any
// credential or network use), then the credential gate, then the battery.
// Importing this module (unit tests) runs none of this.
// ---------------------------------------------------------------------------
const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  handleCliFlags();
  await ensureCredentials();
  await runBattery();
}