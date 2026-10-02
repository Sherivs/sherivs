#!/usr/bin/env node
/**
 * CoreGrid — role-assignment substrate verifier (WAVE-R39).
 *
 * Proves the R37 substrate (`20260907000800_coregrid_role_assignment_substrate.sql`)
 * against two evidence classes and writes a machine-readable proof artifact:
 *
 *   1. STATIC (always, no database): the migration SOURCE satisfies the
 *      invariants we claim — tables, deny-by-default posture, scoped RPCs whose
 *      tenant is re-derived from the actor, grantor captured from auth.uid(),
 *      and lockstep with the server-function surface that calls those RPCs.
 *      This runs in any environment, including one with no database.
 *
 *   2. LIVE (when DATABASE_URL is present): the APPLIED database satisfies the
 *      same invariants — relations exist, RLS is on with zero policies,
 *      anon/authenticated hold no table privilege, service_role is granted, the
 *      six functions exist as SECURITY DEFINER, and the active-uniqueness
 *      indexes were created.
 *
 * The proof is written to architecture/proofs/role-assignment-substrate.proof.json
 * and is asserted by tests/unit/role-substrate-proof.test.ts. A claim without
 * evidence is not a claim (Constitution §42).
 *
 * Usage:
 *   node scripts/verify-role-assignment-substrate.mjs
 *   $env:DATABASE_URL="postgresql://..." ; node scripts/verify-role-assignment-substrate.mjs
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pgSslConfig } from "./lib/pg-ssl.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MIGRATION_REF =
  "database/supabase/migrations/20260907000800_coregrid_role_assignment_substrate.sql";
const FUNCTIONS_REF = "frontend/src/lib/runtime/scholar/scholar-role-assignments.functions.ts";
const PROOF_REF = "architecture/proofs/role-assignment-substrate.proof.json";

const TABLES = ["cg_role_assignment", "cg_role_grant"];
const POLICY_BACKED_POSTURE = {
  // Post J-005/J-006 (migration 20261002000013): these tables carry FORCED RLS
  // with exactly the neutral tenant-membership policies, and authenticated
  // holds table privileges so those policies are the operative row gate.
  cg_role_assignment: [
    "role_assignment_select_own_tenant",
    "role_assignment_insert_tenant_admin",
    "role_assignment_update_tenant_admin",
  ],
  cg_role_grant: [
    "role_grant_select_own_tenant",
    "role_grant_insert_tenant_admin",
    "role_grant_update_tenant_admin",
  ],
};
const RPCS = [
  "list_role_assignments",
  "assign_role",
  "end_role_assignment",
  "list_role_grants",
  "grant_role_capability",
  "revoke_role_capability",
];
const INDEXES = ["cg_role_assignment_active_idx", "cg_role_grant_active_idx"];

/** Line endings are normalised so the digest is stable across CRLF/LF checkouts. */
function readNormalised(ref) {
  return readFileSync(join(ROOT, ref), "utf8").replace(/\r\n/g, "\n");
}

const checks = [];
function check(id, ok, detail) {
  checks.push({ id, ok, detail });
}

const migration = readNormalised(MIGRATION_REF);
const functions = readNormalised(FUNCTIONS_REF);
/* ── 1. STATIC invariants (source-level, environment-independent) ─────────── */

for (const table of TABLES) {
  check(
    `static:table:${table}`,
    migration.includes(`CREATE TABLE IF NOT EXISTS public.${table} (`),
    `public.${table} is created`,
  );
  check(
    `static:rls:${table}`,
    new RegExp(`ALTER TABLE public\\.${table}\\s+ENABLE ROW LEVEL SECURITY`).test(migration),
    `public.${table} enables row level security`,
  );
}

check(
  "static:deny-by-default",
  !/CREATE\s+POLICY/i.test(migration),
  "no policy is declared — RLS with zero policies denies every client",
);
check(
  "static:revoked-from-clients",
  /REVOKE ALL ON TABLE public\.cg_role_assignment, public\.cg_role_grant\s+FROM anon, authenticated/.test(
    migration,
  ),
  "anon + authenticated hold no table privilege",
);
check(
  "static:granted-to-service-role",
  /GRANT ALL ON TABLE public\.cg_role_assignment, public\.cg_role_grant\s+TO service_role/.test(
    migration,
  ),
  "service_role owns substrate access",
);

for (const rpc of RPCS) {
  check(
    `static:rpc:${rpc}`,
    migration.includes(`CREATE OR REPLACE FUNCTION public.${rpc}(`),
    `public.${rpc}() is declared`,
  );
  check(
    `static:rpc-execute:${rpc}`,
    migration.includes(`GRANT EXECUTE ON FUNCTION public.${rpc}(`),
    `public.${rpc}() is executable by an authenticated caller`,
  );
  check(
    `static:server-lockstep:${rpc}`,
    functions.includes(`"${rpc}"`),
    `the server-function surface calls ${rpc}`,
  );
}

const functionBlocks = migration.split("CREATE OR REPLACE FUNCTION public.").slice(1);
check(
  "static:security-definer",
  functionBlocks.length >= RPCS.length &&
    functionBlocks.every((block) => block.includes("SECURITY DEFINER")),
  `all ${functionBlocks.length} substrate functions are SECURITY DEFINER`,
);

/** Every RPC that reads or writes a tenant must re-derive it from the actor. */
const tenantScoped = functionBlocks.filter((block) => block.includes("p_tenant"));
check(
  "static:tenant-re-derived-from-actor",
  tenantScoped.length > 0 &&
    tenantScoped.every(
      (block) =>
        block.includes("public.is_school_admin()") && block.includes("public.get_my_school_id()"),
    ),
  `${tenantScoped.length} tenant-scoped RPCs re-derive scope from is_school_admin() + get_my_school_id()`,
);
check(
  "static:grantor-captured-from-auth",
  migration.includes("COALESCE(auth.uid()::text, 'service')") && !/p_granted_by/.test(migration),
  "granted_by comes from auth.uid() — no client parameter can assert a grantor",
);
check(
  "static:self-scope-has-no-client-tenant",
  /getMyRealityRoles[\s\S]{0,400}z\.object\(\{\}\)/.test(functions) &&
    /get_my_school_id/.test(functions),
  "the self-scoped reader takes no tenant input and reads its tenant server-side",
);
check(
  "static:history-preserved",
  /revoked_on = now\(\)/.test(migration) && !/DELETE FROM public\.cg_role_grant/i.test(migration),
  "revocation timestamps instead of deleting grant history",
);

const digest = `sha256:${createHash("sha256").update(migration).digest("hex")}`;

/** Live invariants against the applied database, over a strictly-verified TLS channel. */
async function runLiveChecks(client, check) {
  for (const table of TABLES) {
    const rel = await client.query("SELECT to_regclass($1) AS oid", [`public.${table}`]);
    check(
      `live:table:${table}`,
      Boolean(rel.rows[0]?.oid),
      `public.${table} exists in the applied database`,
    );
    const rls = await client.query(
      "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = $1::regclass",
      [`public.${table}`],
    );
    check(
      `live:rls:${table}`,
      rls.rows[0]?.relrowsecurity === true,
      `public.${table} has row level security enabled`,
    );
    const expectedPolicies = POLICY_BACKED_POSTURE[table] ?? null;
    if (expectedPolicies) {
      check(
        `live:rls-forced:${table}`,
        rls.rows[0]?.relforcerowsecurity === true,
        `public.${table} has FORCE ROW LEVEL SECURITY (owner bound for non-bypass owners)`,
      );
      const declared = await client.query(
        "SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = $1 ORDER BY policyname",
        [table],
      );
      const names = declared.rows.map((r) => r.policyname).sort();
      check(
        `live:policies:${table}`,
        names.length === expectedPolicies.length &&
          expectedPolicies.slice().sort().every((name, i) => names[i] === name),
        `public.${table} declares exactly the J-005/J-006 neutral tenant-membership policies: ${expectedPolicies.join(", ")}`,
      );
      for (const [role, expected] of [
        ["anon", false],
        ["authenticated", true],
        ["service_role", true],
      ]) {
        const priv = await client.query(
          "SELECT has_table_privilege($1, $2, 'SELECT,INSERT,UPDATE,DELETE') AS allowed",
          [role, `public.${table}`],
        );
        check(
          `live:privilege:${table}:${role}`,
          priv.rows[0]?.allowed === expected,
          `${role} table access = ${priv.rows[0]?.allowed} (expected ${expected}; policy-backed posture)`,
        );
      }
    } else {
      const policies = await client.query(
        "SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'public' AND tablename = $1",
        [table],
      );
      check(
        `live:policies:${table}`,
        policies.rows[0]?.n === 0,
        `public.${table} declares ${policies.rows[0]?.n} policies (0 = deny by default)`,
      );
      for (const [role, expected] of [
        ["anon", false],
        ["authenticated", false],
        ["service_role", true],
      ]) {
        const priv = await client.query(
          "SELECT has_table_privilege($1, $2, 'SELECT,INSERT,UPDATE,DELETE') AS allowed",
          [role, `public.${table}`],
        );
        check(
          `live:privilege:${table}:${role}`,
          priv.rows[0]?.allowed === expected,
          `${role} table access = ${priv.rows[0]?.allowed} (expected ${expected})`,
        );
      }
    }
  }

  const procs = await client.query(
    `SELECT p.oid AS oid, p.proname AS name, p.prosecdef AS definer
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = ANY($1::text[])`,
    [RPCS],
  );
  const found = new Set(procs.rows.map((row) => row.name));
  for (const rpc of RPCS) {
    const row = procs.rows.find((candidate) => candidate.name === rpc);
    check(
      `live:rpc:${rpc}`,
      Boolean(row) && row.definer === true,
      row
        ? `public.${rpc} is present and SECURITY DEFINER`
        : `public.${rpc} is missing from the applied database`,
    );
    const exec = row
      ? await client
          .query("SELECT has_function_privilege('authenticated', $1::oid, 'EXECUTE') AS allowed", [
            row.oid,
          ])
          .catch(() => null)
      : null;
    check(
      `live:rpc-execute:${rpc}`,
      exec?.rows[0]?.allowed === true,
      exec
        ? `authenticated may execute ${rpc} = ${exec.rows[0].allowed}`
        : `could not resolve ${rpc} for a privilege check`,
    );
  }
  check(
    "live:rpc-complete",
    RPCS.every((rpc) => found.has(rpc)),
    `${found.size}/${RPCS.length} substrate RPCs present`,
  );

  const indexes = await client.query(
    "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY($1::text[])",
    [INDEXES],
  );
  const indexNames = new Set(indexes.rows.map((row) => row.indexname));
  for (const index of INDEXES) {
    check(`live:index:${index}`, indexNames.has(index), `${index} backs active-row uniqueness`);
  }
}

/* ── 2. LIVE invariants (only when a database is provided) ────────────────── */

const dbUrl = process.env.DATABASE_URL;
let mode = "static";

if (dbUrl) {
  const { connectCoregridPostgres } = await import("./lib/pg-connect.mjs");
  const pg = await import("pg").catch(() => null);
  if (!pg) {
    check("live:driver", false, "DATABASE_URL is set but the 'pg' driver is not installed");
  } else {
    let client = null;
    try {
      client = await connectCoregridPostgres(dbUrl, pg, (line) => console.error(line));
    } catch (err) {
      check(
        "live:transport",
        false,
        `could not open a strictly-verified TLS channel (${err instanceof Error ? err.message : String(err)}) — provision COREGRID_DB_CA_CERT with the Supabase project CA; verification is never disabled for convenience`,
      );
    }
    if (client) {
      mode = "live";
      await runLiveChecks(client, check);
      await client.end();
    }
  }
}

/* ── 3. Proof artifact ────────────────────────────────────────────────────── */

const failed = checks.filter((entry) => !entry.ok);
const proof = {
  artifact: "role-assignment-substrate",
  wave: "R39",
  mode,
  generatedAt: new Date().toISOString(),
  migration: MIGRATION_REF,
  migrationDigest: digest,
  serverSurface: FUNCTIONS_REF,
  tables: TABLES,
  rpcs: RPCS,
  checks,
  ok: failed.length === 0,
  liveProcedure: [
    "node scripts/db-apply-one.mjs 20260907000800",
    '$env:DATABASE_URL="postgresql://…" ; node scripts/verify-role-assignment-substrate.mjs',
    "commit the regenerated proof artifact and record the mode=live result in PROGRESS §20",
  ],
  limitations: [
    "Static mode proves the authored source invariants, not the applied database.",
    "Behavioural RPC tests (a non-admin JWT being rejected) need a Supabase JWT harness; the compensating control is that every tenant-scoped function cross-checks is_school_admin() + get_my_school_id().",
    "Tenants cannot persist grants until the migration is applied, so granted-only features fail closed (DENY).",
  ],
};

const proofPath = join(ROOT, PROOF_REF);
mkdirSync(dirname(proofPath), { recursive: true });
writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`, "utf8");

const label = mode === "live" ? "live + static" : "static";
for (const entry of checks) {
  console.log(`${entry.ok ? "OK  " : "FAIL"}  [${label}] ${entry.id} — ${entry.detail}`);
}

console.log(
  `\n${checks.length - failed.length}/${checks.length} substrate invariants hold (mode: ${mode}).`,
);
console.log(`Proof written: ${PROOF_REF} (migration ${digest.slice(0, 19)}…)`);

if (failed.length > 0) {
  console.error(`\n${failed.length} invariant(s) FAILED — the substrate is not proven.`);
  process.exit(1);
}
if (mode === "static") {
  console.log(
    "No DATABASE_URL: source invariants proven. Apply the migration and re-run for live proof (R39).",
  );
}
