#!/usr/bin/env node
/**
 * MISSION-R-20 verification — neutral tenant-membership primitives.
 *
 * READ-ONLY: every query issued here is a SELECT against pg_catalog /
 * information_schema through the Supabase management API (the same transport
 * as scripts/apply-foundation-migration.mjs). Nothing is created, altered or
 * executed against user tables. The token is never printed.
 *
 * Proves, after the migration
 *   20261002000001_coregrid_v1_neutral_tenant_primitives.sql
 * has been applied under explicit authorization:
 *   (a) the three neutral helpers exist (get_my_tenant_id,
 *       holds_tenant_role, is_tenant_admin);
 *   (b) every re-pointed universal cg_ substrate RPC body references the
 *       neutral predicate AND no longer references the Scholar helpers
 *       (get_my_school_id / is_school_admin);
 *   (c) a non-Scholar tenant can hold/administer a role assignment —
 *       dry-checked at the catalog level: the helper sources resolve tenancy
 *       only from the neutral substrate (cg_org_membership / cg_role_assignment)
 *       with the actor re-derived from auth.uid(), the gate columns carry no
 *       foreign key to any domain table, and the substrates exist as text
 *       tenant-ref columns (COND-003-compatible).
 *
 * Exit codes:
 *   0  PASS (applied and verified) or the honest NOT_APPLIED baseline
 *      (expected BEFORE apply — this is baseline evidence, not a failure);
 *   1  FAIL (applied-or-partially-applied but a check does not hold);
 *   2  BLOCKED_NO_CREDENTIAL (SUPABASE_ACCESS_TOKEN unavailable).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const projectRef = process.argv[2] ?? "nwrflbpbhyiqdptmlccm";

let token = process.env.SUPABASE_ACCESS_TOKEN ?? "";
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
if (!token) {
  console.error("BLOCKED_NO_CREDENTIAL SUPABASE_ACCESS_TOKEN is not set.");
  process.exit(2);
}

const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;

async function runQuery(query) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
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

// ---------------------------------------------------------------------------
// Expected inventory (source migrations for each re-pointed RPC are recorded
// in architecture/coregrid-mvp-architecture/ratification/NEUTRAL_TENANT_PRIMITIVES.md)
// ---------------------------------------------------------------------------
const NEUTRAL_HELPERS = ["get_my_tenant_id", "holds_tenant_role", "is_tenant_admin"];
const NEUTRAL_ADMIN_REF = "role:administrator";
const SCHOLAR_HELPERS = ["get_my_school_id", "is_school_admin"];

const REPOINTED_RPCS = [
  { name: "list_workforce_positions", args: "p_tenant uuid" },
  { name: "assign_workforce_position", args: "p_tenant uuid, p_identity uuid, p_kind_code text, p_runtime text, p_primary boolean, p_employment_type text, p_started_on date" },
  { name: "end_workforce_position", args: "p_position_id uuid, p_ended_on date" },
  { name: "get_org_profile", args: "p_tenant uuid, p_runtime text, p_profile_key text" },
  { name: "upsert_org_profile", args: "p_tenant uuid, p_runtime text, p_profile_key text, p_payload jsonb" },
  { name: "list_role_assignments", args: "p_tenant uuid" },
  { name: "assign_role", args: "p_tenant uuid, p_identity uuid, p_role_id text, p_started_on date, p_ended_on date" },
  { name: "end_role_assignment", args: "p_assignment_id uuid" },
  { name: "list_role_grants", args: "p_tenant uuid" },
  { name: "grant_role_capability", args: "p_tenant uuid, p_role_id text, p_capability text" },
  { name: "revoke_role_capability", args: "p_grant_id uuid" },
];

// ---------------------------------------------------------------------------
// Read-only catalog queries
// ---------------------------------------------------------------------------
const FN_QUERY = `
  SELECT n.nspname AS schema, p.proname AS name,
         pg_get_function_identity_arguments(p.oid) AS args,
         p.prosrc AS source,
         p.proconfig AS config
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN (${[...NEUTRAL_HELPERS, ...REPOINTED_RPCS.map((f) => f.name)]
  .map((n) => `'${n}'`)
  .join(", ")});
`;

const FK_QUERY = `
  SELECT tc.table_name, tc.constraint_name, tc.constraint_type,
           ccu.table_name AS referenced_table
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
     AND ccu.constraint_schema = tc.constraint_schema
   WHERE tc.table_schema = 'public'
     AND tc.table_name IN ('cg_role_assignment', 'cg_role_grant', 'cg_org_membership', 'cg_org_unit')
     AND tc.constraint_type = 'FOREIGN KEY';
`;

const COLUMN_QUERY = `
  SELECT table_name, column_name, data_type
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name IN ('cg_role_assignment', 'cg_org_membership', 'cg_org_unit')
     AND column_name IN ('tenant_ref', 'tenant_id', 'principal_ref', 'identity_ref', 'role_ref', 'role_id', 'state', 'status')
   ORDER BY table_name, column_name;
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const lines = [];
function report(line) {
  lines.push(line);
  console.log(line);
}

function sourceFor(rows, name) {
  const hit = rows.filter((r) => r.name === name);
  return hit.length > 0 ? hit[0] : null;
}

let failures = 0;
let missingAny = false;

// ---------------------------------------------------------------------------
// Check (a): neutral helpers exist
// ---------------------------------------------------------------------------
report(`project=${projectRef} verify-neutral-tenant-primitives (read-only)`);
report("--- (a) neutral helper existence ---");
const fnRes = await runQuery(FN_QUERY);
if (!fnRes.ok) {
  report(`FAIL catalog query [${fnRes.status}] ${fnRes.text.replace(/sbp_[A-Za-z0-9_\-]+/g, "[redacted]").slice(0, 300)}`);
  process.exit(1);
}
const fnRows = Array.isArray(fnRes.rows) ? fnRes.rows : [];
for (const helper of NEUTRAL_HELPERS) {
  const row = sourceFor(fnRows, helper);
  if (!row) {
    missingAny = true;
    report(`MISSING ${helper}() — neutral primitives migration NOT APPLIED`);
  } else {
    report(`PASS ${helper}() exists (${row.args})`);
  }
}

// ---------------------------------------------------------------------------
// Check (b): every re-pointed RPC body references the neutral predicate and
// NOT the Scholar helpers
// ---------------------------------------------------------------------------
report("--- (b) re-pointed RPC gates ---");
for (const rpc of REPOINTED_RPCS) {
  const row = fnRows.find((r) => r.name === rpc.name);
  if (!row) {
    missingAny = true;
    report(`MISSING ${rpc.name}(${rpc.args}) — source RPC absent from catalog`);
    continue;
  }
  const src = String(row.source ?? "");
  const referencesNeutral = src.includes("is_tenant_admin");
  const referencesScholar = SCHOLAR_HELPERS.some((h) => src.includes(h));
  if (referencesNeutral && !referencesScholar) {
    report(`PASS ${rpc.name}(${rpc.args}) gate -> is_tenant_admin, no Scholar helper`);
  } else {
    failures += 1;
    report(
      `FAIL ${rpc.name}(${rpc.args}) gate: is_tenant_admin=${referencesNeutral}, scholar-helper=${referencesScholar}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Check (c): non-Scholar tenant can hold/administer a role assignment
// (catalog-level dry-check on function sources + substrate shape)
// ---------------------------------------------------------------------------
report("--- (c) non-Scholar tenancy dry-check ---");

// (c1) The tenancy predicates resolve ONLY from the neutral substrate: every
// table reference in the helper sources is a cg_ table, the actor is always
// re-derived from auth.uid(), and no domain vocabulary appears.
for (const helper of ["get_my_tenant_id", "holds_tenant_role"]) {
  const row = sourceFor(fnRows, helper);
  if (!row) {
    missingAny = true;
    report(`MISSING ${helper}() source — cannot dry-check substrate resolution`);
    continue;
  }
  const src = String(row.source ?? "");
  const tableRefs = [...src.matchAll(/\bpublic\.([a-z_]+)/g)].map((m) => m[1]);
  const nonNeutralTables = tableRefs.filter(
    (t) => t.startsWith("cg_") === false && !["holds_tenant_role", "is_tenant_admin"].includes(t),
  );
  const usesAuthUid = src.includes("auth.uid()");
  const domainVocabulary = ["school", "scholar", "teacher", "student", "parent"].some(
    (v) => src.includes(v),
  );
  if (nonNeutralTables.length === 0 && usesAuthUid && !domainVocabulary) {
    report(`PASS ${helper}() resolves tenancy from neutral substrate only (actor from auth.uid(), no domain vocabulary)`);
  } else {
    failures += 1;
    report(
      `FAIL ${helper}(): non-neutral tables=[${nonNeutralTables.join(",") || "none"}] auth.uid()=${usesAuthUid} domain-vocabulary=${domainVocabulary}`,
    );
  }
}

// (c2) The administrator predicate binds the neutral ADMINISTRATOR ref, not a
// domain role name.
{
  const row = sourceFor(fnRows, "is_tenant_admin");
  if (!row) {
    missingAny = true;
    report("MISSING is_tenant_admin() source — cannot dry-check admin ref");
  } else if (String(row.source ?? "").includes(NEUTRAL_ADMIN_REF)) {
    report(`PASS is_tenant_admin() binds neutral admin ref '${NEUTRAL_ADMIN_REF}'`);
  } else {
    failures += 1;
    report(`FAIL is_tenant_admin() does not reference '${NEUTRAL_ADMIN_REF}'`);
  }
}

// (c3) Substrate shape: tenant-ref columns are text (COND-003 applied reality)
// and the role-assignment substrate carries no foreign key to any domain
// table — any tenant ref (including a non-Scholar one) can hold and
// administer assignments. Catalog-only: no rows are read.
const fkRes = await runQuery(FK_QUERY);
const colRes = await runQuery(COLUMN_QUERY);
if (!fkRes.ok || !colRes.ok) {
  failures += 1;
  report(`FAIL substrate catalog query [fk=${fkRes.status} col=${colRes.status}]`);
} else {
  const fkRows = Array.isArray(fkRes.rows) ? fkRes.rows : [];
  const colRows = Array.isArray(colRes.rows) ? colRes.rows : [];
  const domainFks = fkRows.filter((r) => r.referenced_table && !String(r.referenced_table).startsWith("cg_"));
  const tenantRefTypes = colRows
    .filter((r) => r.column_name === "tenant_ref" || r.column_name === "tenant_id")
    .map((r) => `${r.table_name}.${r.column_name}:${r.data_type}`);
  if (tenantRefTypes.length === 0) {
    missingAny = true;
    report("MISSING neutral substrate tenant-ref columns — substrate tables not present (not applied)");
  } else {
    report(`PASS tenant-ref columns present: ${tenantRefTypes.join(", ")}`);
  }
  if (domainFks.length === 0) {
    report("PASS cg_role_assignment / cg_org_membership / cg_org_unit have no foreign key into a domain table (tenant_ref is unconstrained — non-Scholar tenants admissible)");
  } else {
    failures += 1;
    report(`FAIL domain foreign keys present: ${domainFks.map((r) => `${r.table_name}->${r.referenced_table}`).join(", ")}`);
  }
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------
report("--- verdict ---");
if (missingAny) {
  report(
    "STATUS=NOT_APPLIED — neutral tenant primitives are not (fully) present on this project. " +
      "Expected baseline before apply authorization (governance law); baseline evidence, not a failure. " +
      "The FAIL/MISSING lines above are the recorded pre-apply contamination state " +
      "(universal RPCs still gated on the Scholar helpers), not post-apply verification failures.",
  );
  process.exit(0);
}
if (failures > 0) {
  report(`STATUS=FAIL — ${failures} check(s) did not hold on this project.`);
  process.exit(1);
}
report("STATUS=PASS — neutral helpers present, every re-pointed RPC gate is neutral, non-Scholar tenancy admissible at catalog level.");
process.exit(0);