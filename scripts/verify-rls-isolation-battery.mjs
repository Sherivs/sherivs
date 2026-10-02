#!/usr/bin/env node
/**
 * MISSION-R-85 / J-041 / V1CAP-073 — RLS isolation battery.
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
 *                            policy-backed tables grant SELECT/INSERT/UPDATE/
 *                            DELETE to authenticated (the policies are the
 *                            operative row gate) and nothing to anon/PUBLIC.
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
 *   1  FAIL (at least one FINDING — nothing is fixed);
 *   2  BLOCKED_NO_CREDENTIAL.
 *
 * Artifacts (outside the repo):
 *   /opt/cursor/artifacts/rls-battery-results.json
 *   /opt/cursor/artifacts/rls-battery-results.log
 */
import { readFileSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const artifactsDir = "/opt/cursor/artifacts";
const jsonPath = join(artifactsDir, "rls-battery-results.json");
const logPath = join(artifactsDir, "rls-battery-results.log");

// ---------------------------------------------------------------------------
// Credentials (values are never printed)
// ---------------------------------------------------------------------------
const supabaseUrl = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
const managementEndpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;

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
if (!supabaseUrl || !token) {
  console.error(
    "BLOCKED_NO_CREDENTIAL need SUPABASE_URL + SUPABASE_ACCESS_TOKEN.",
  );
  process.exit(2);
}

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

const resolved = await resolveAnonKey();
const anonKey = resolved.key;
const anonKeyProvenance = {
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

// ---------------------------------------------------------------------------
// Battery scope: EVERY cg_* substrate table applied to the canonical project,
// enumerated from the applied migrations (source migrations cited per table).
// Posture per table:
//   zero-policy   — RLS on, zero policies: deny-by-default strongest form.
//   policy-backed — post J-005/J-006 (20261002000013): FORCED RLS + neutral
//                   tenant-membership policies; proven by genuine cross-
//                   tenant probes.
// ---------------------------------------------------------------------------
const POLICY_MIGRATION = "20261002000013_coregrid_v1_neutral_membership_policies.sql";
const TABLES = [
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
const TABLE_NAMES = TABLES.map((t) => t.name);

// ---------------------------------------------------------------------------
// Output plumbing: console + human log, and structured JSON results.
// ---------------------------------------------------------------------------
mkdirSync(artifactsDir, { recursive: true });
appendFileSync(logPath, `\n=== run ${new Date().toISOString()} project=${projectRef} ===\n`);

const results = {
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
  tables: [],
  findings: [],
  serviceRoleContrast: null,
  summary: null,
};

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
// Catalog enforcement + privilege queries (read-only, pg_catalog / information_schema)
// ---------------------------------------------------------------------------
const RLS_CATALOG_QUERY = `
  SELECT c.relname AS table_name,
         c.relrowsecurity AS rls_enabled,
         c.relforcerowsecurity AS rls_forced
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND c.relname LIKE 'cg\\_%'
   ORDER BY 1;
`;
const POLICY_QUERY = `
  SELECT tablename, policyname, permissive, cmd
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename LIKE 'cg\\_%'
   ORDER BY 1, 2;
`;
const GRANT_QUERY = `
  SELECT table_name, grantee, privilege_type
    FROM information_schema.table_privileges
   WHERE table_schema = 'public'
     AND table_name LIKE 'cg\\_%'
     AND grantee IN ('anon', 'authenticated', 'public')
   ORDER BY 1, 2, 3;
`;

// ---------------------------------------------------------------------------
// Cross-tenant probe harness (RLS battery §4.4, post J-005/J-006).
// Privileged seed/cleanup via the management channel; probe users are real
// authenticated principals created through the auth admin API. Every probe
// row/user is cleaned up and the cleanup is verified (probe_cleaned=true).
// ---------------------------------------------------------------------------
async function crossTenantProbe(table, entry) {
  const probe = {
    privilegedSeed: "PRIVILEGED_SEED_USED_EXPLICITLY — management-channel SQL seed for §4.4 cross-tenant probes; explicit and logged, never a client data path",
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
      await sql(`
        DELETE FROM public.cg_org_membership WHERE tenant_id IN ('${probe.tenantA}','${probe.tenantB}');
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
        + (SELECT count(*) FROM public.cg_org_unit WHERE tenant_id IN ('${probe.tenantA}','${probe.tenantB}')) AS remaining;
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
    async function restInsert(payload) {
      const res = await fetch(`${supabaseUrl}/rest/v1/${table.name}`, {
        method: "POST",
        headers: { ...userAHeaders, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      return { status: res.status, text };
    }
    const crossInsert = await restInsert(
      isGrantTable
        ? { tenant_ref: probe.tenantB, role_id: "role:actor", capability: `battery-x-${suffix}`, granted_by: users.a.id }
        : table.name === "cg_org_membership"
          ? { id: `battery-x-${suffix}`, tenant_id: probe.tenantB, org_unit_id: `battery-unit-b-${suffix}`, principal_ref: users.a.id, role_ref: "role:actor", state: "active" }
          : { tenant_ref: probe.tenantB, identity_ref: users.a.id, role_id: "role:actor", status: "active" },
    );
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
report(`COREGRID RLS ISOLATION BATTERY — ${results.mission} (${results.capability} / ${results.gap})`);
report(`project=${projectRef} transport=rest-anon + rest-authenticated-cross-tenant + management-api(readonly catalog SQL + privileged seed/clean)`);
report(
  `anon key provenance: source=${anonKeyProvenance.source} ref=${anonKeyProvenance.claims.ref ?? "n/a"} role=${anonKeyProvenance.claims.role ?? "n/a"} prefix=${anonKeyProvenance.keyPrefix ?? "n/a"} (value never printed)`,
);
report(`honesty rule: zero-policy tables prove DENY (deny is the pass condition); policy-backed tables prove tenant-scoped visibility (genuine cross-tenant probes, §4.4). Deny of Tenant A's own rows is a FINDING too.`);
report("--- catalog enforcement metadata (pg_catalog) ---");

const [rlsRes, polRes, grantRes] = await Promise.all([
  runCatalogQuery(RLS_CATALOG_QUERY),
  runCatalogQuery(POLICY_QUERY),
  runCatalogQuery(GRANT_QUERY),
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
  report(`--- table ${table.name} (source: ${table.source}; posture: ${table.posture}) ---`);
  const entry = {
    table: table.name,
    source: table.source,
    posture: table.posture,
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
    const policiesExact =
      tablePolicies.length === table.policies.length &&
      table.policies.every((name) => tablePolicies.some((p) => p.policyname === name));
    entry.catalogEnforcement = {
      rlsEnabled,
      rlsForced,
      policiesTotal: tablePolicies.length,
      policies: tablePolicies.map((p) => ({ name: p.policyname, permissive: p.permissive, cmd: p.cmd })),
      policiesExact,
      verdict: rlsEnabled && rlsForced && policiesExact ? "PASS" : "FAIL",
    };
    report(
      `${entry.catalogEnforcement.verdict} relrowsecurity=${rlsEnabled} relforcerowsecurity=${rlsForced} policies=${tablePolicies.length} exact-declared-set=${policiesExact}`,
    );
    if (!rlsEnabled || !rlsForced || !policiesExact) {
      results.findings.push({
        table: table.name,
        section: "catalogEnforcement",
        finding: !rlsEnabled ? "RLS_DISABLED" : !rlsForced ? "RLS_NOT_FORCED" : "POLICY_SET_MISMATCH",
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
    const expectedAuth = ["SELECT", "INSERT", "UPDATE", "DELETE"].sort().join(",");
    const authOk = authPrivs.slice().sort().join(",") === expectedAuth;
    const anonPublicOk = anonPrivs.length === 0 && publicPrivs.length === 0;
    entry.privileges = {
      anon: anonPrivs,
      authenticated: authPrivs,
      public: publicPrivs,
      verdict: authOk && anonPublicOk ? "PASS" : "FAIL",
    };
    if (entry.privileges.verdict === "PASS") {
      report(`PASS privileges match policy-backed posture: authenticated=SELECT,INSERT,UPDATE,DELETE (policies are the operative row gate); anon/PUBLIC=none`);
    } else {
      report(`FAIL privilege posture mismatch: anon=[${anonPrivs}] authenticated=[${authPrivs}] public=[${publicPrivs}]`);
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
    const crossProbe = catalogOk && privilegesOk && probeOk ? await crossTenantProbe(table, entry) : null;
    entry.crossTenantProbe = crossProbe;
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
