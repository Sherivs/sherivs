/**
 * CoreGrid — MISSION H2-04: batch-A/B substrate RLS policy layer.
 *
 * Pins the authored migration 20261002000015_coregrid_v1_substrate_policies.sql
 * (+ its genuine inverse rollback) and the declarative posture JSON consumed
 * by the RLS isolation battery steward:
 *
 *  1. AUTHORED, NOT APPLIED status and rollback pointer;
 *  2. exactly four policy-backed tables with FORCED RLS and the exact
 *     eight-policy inventory (SELECT tenant-equality + INSERT tenant-admin);
 *  3. every predicate built ONLY on the J-005 neutral primitives plus
 *     auth.uid() actor self-derivation — no domain helper, no domain role
 *     name, no hard-coded tenant (J-005/J-006 law);
 *  4. the four append-only audit tables receive NO client INSERT/UPDATE/
 *     DELETE policy (Constitution §28) and are documented in the header;
 *  5. provenance columns never filtered (AGENTS §11);
 *  6. privileges: authenticated = SELECT + INSERT exactly; anon untouched;
 *     service_role bypass-path parity;
 *  7. the rollback is the genuine inverse of the migration;
 *  8. the declarative posture JSON is coherent with the migration text and
 *     covers all 21 tables of the eight batch-A/B migrations.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MIGRATION_PATH =
  "database/supabase/migrations/20261002000015_coregrid_v1_substrate_policies.sql";
const ROLLBACK_PATH =
  "database/supabase/rollbacks/20261002000015_coregrid_v1_substrate_policies.sql";
const POSTURE_PATH = "scripts/verification/rls-table-postures-substrate.json";

const MIGRATION = readFileSync(join(ROOT, MIGRATION_PATH), "utf8");
const ROLLBACK = readFileSync(join(ROOT, ROLLBACK_PATH), "utf8");
const POSTURE_RAW = readFileSync(join(ROOT, POSTURE_PATH), "utf8");
const POSTURE = JSON.parse(POSTURE_RAW) as {
  artifact: string;
  migration: string;
  rollback: string;
  policyConstructionLaw: { allowedPredicates: string[]; forbiddenInPredicates: string[] };
  tables: Array<{
    name: string;
    source: string;
    posture: string;
    tenantColumn?: string;
    forceRls?: boolean;
    auditAppendOnly?: boolean;
    clientWritePolicy?: string;
    privileges?: { authenticated: string[]; anon: string[]; service_role: string[] };
    policies?: Array<{ name: string; command: string; predicate: string }>;
    absentPolicies?: Record<string, string>;
  }>;
  batteryExpectations: {
    policyBackedTables: string[];
    zeroPolicyTables: string[];
  };
};

/** The four substrates H2-04 declares legitimate for tenant-scoped client access. */
const POLICY_BACKED = [
  "cg_reconciliation_input",
  "cg_event_route_subscription",
  "cg_evidence_record",
  "cg_usage_attribution_bucket",
] as const;

/** The four append-only audit ledgers — NO client INSERT/UPDATE/DELETE policy. */
const AUDIT_APPEND_ONLY = [
  "cg_event_security_denial",
  "cg_event_security_redaction",
  "cg_event_route_outcome",
  "cg_evidence_lifecycle_act",
] as const;

/** Every table of the eight batch-A/B migrations (20261002000005..12). */
const BATCH_AB_TABLES = [
  "cg_reconciliation_verdict",
  "cg_reconciliation_input",
  "cg_event_security",
  "cg_event_security_denial",
  "cg_event_security_redaction",
  "cg_event_route_subscription",
  "cg_event_route_queue",
  "cg_event_route_cursor",
  "cg_event_route_outcome",
  "cg_evidence_record",
  "cg_evidence_lifecycle_act",
  "cg_reasoning_provenance_snapshot",
  "cg_usage_attribution_rollup",
  "cg_usage_attribution_bucket",
  "cg_knowledge_source",
  "cg_knowledge_freshness_contract",
  "cg_knowledge_invalidation",
  "cg_knowledge_downgrade",
  "cg_tool_runtime_tool",
  "cg_tool_runtime_invocation",
] as const;

/**
 * H3-wave posture extension (battery steward, 2026-10-03): the coordinator
 * merged the INTENDED POSTURE ENTRY authored in each H3 migration header into
 * this posture file after canonical apply. These two policy-backed entries are
 * OUTSIDE the H2-04 inventory — this suite pins them as declared extensions
 * (presence, shape, law compliance), while the H2-04-owned inventory above
 * stays pinned exactly.
 */
const H3_WAVE_POLICY_BACKED = ["cg_file_object", "cg_idempotency_record"] as const;

const SOURCE_MIGRATIONS = [
  "20261002000005_coregrid_v1_reconciliation.sql",
  "20261002000006_coregrid_v1_event_security.sql",
  "20261002000007_coregrid_v1_event_routing.sql",
  "20261002000008_coregrid_v1_evidence_lifecycle.sql",
  "20261002000009_coregrid_v1_reasoning_provenance.sql",
  "20261002000010_coregrid_v1_cost_attribution.sql",
  "20261002000011_coregrid_v1_knowledge_currency.sql",
  "20261002000012_coregrid_v1_tool_runtime.sql",
] as const;

interface ParsedPolicy {
  name: string;
  table: string;
  command: string;
  roles: string[];
  body: string;
}

function parsePolicies(sql: string): ParsedPolicy[] {
  const policies: ParsedPolicy[] = [];
  const re = /CREATE POLICY (\w+)\s+ON public\.(\w+)\s+FOR (SELECT|INSERT|UPDATE|DELETE)([\s\S]*?);/g;
  for (const [, name, table, command, tail] of sql.matchAll(re)) {
    const roles = [...tail.matchAll(/TO (anon|authenticated|service_role)/g)].map((m) => m[1]);
    const body = tail
      .replace(/TO (anon|authenticated|service_role)/g, " ")
      .trim();
    policies.push({ name, table, command, roles, body });
  }
  return policies;
}

const POLICIES = parsePolicies(MIGRATION);

/** Identifiers a lawful predicate may reference (neutral primitives + pins). */
const PREDICATE_ALLOWED_IDENTIFIERS = new Set([
  "tenant_id",
  "public",
  "get_my_tenant_id",
  "is_tenant_admin",
  "auth",
  "uid",
  "text",
  "AND",
  "subscriber_id",
  "captured_by",
  "created_by",
]);

function predicateIdentifiers(body: string): string[] {
  const cleaned = body
    .replace(/USING/i, " ")
    .replace(/WITH CHECK/i, " ")
    .replace(/[(),]/g, " ");
  return [...cleaned.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)].map((m) => m[0]);
}

/** Provenance/content columns that must never appear in a policy predicate (§11). */
const PROVENANCE_COLUMNS = [
  "recorded_at",
  "observed_at",
  "captured_at",
  "confidence",
  "confidence_basis",
  "evidence_class",
  "prior_class",
  "reliability",
  "valid_from",
  "valid_until",
  "valid_time_known",
  "declared_at",
  "recorded_from",
  "recorded_to",
  "period_from",
  "period_to",
  "totals",
  "grand_total",
  "dimension",
  "bucket_key",
  "claim",
  "lineage",
  "promotion",
  "revocation",
  "supersedes",
  "revokes",
  "delivery",
  "delivery_decision",
  "event_types",
  "visibility_scopes",
  "max_sensitivity",
  "digest",
  "issuer_id",
  "source",
  "source_ref",
  "retention_policy_id",
  "sufficiency",
  "provenance",
  "policy_context",
  "status",
  "state",
];

/** STREAM-I domain vocabulary (scripts/verify-domain-neutrality.mjs STRICT_TOKENS). */
const DOMAIN_TERMS = [
  "scholar",
  "student",
  "teacher",
  "school",
  "classroom",
  "curriculum",
  "exam",
  "examination",
  "grade",
  "grading",
  "attendance",
  "fee",
  "fees",
  "tuition",
  "timetable",
  "admission",
  "lesson",
  "homework",
  "library",
  "hostel",
  "bursar",
  "principal",
  "guardian",
  "enrollment",
  "enrolment",
  "academic",
  "discipline",
  "payroll",
  "textbook",
  "vibeora",
  "get_my_school_id",
  "is_school_admin",
];

function domainViolations(text: string): string[] {
  const violations: string[] = [];
  for (const term of DOMAIN_TERMS) {
    if (new RegExp(`\\b${term}\\b`, "i").test(text)) violations.push(term);
  }
  return violations;
}

describe("H2-04 substrate policies — authored posture", () => {
  it("is AUTHORED, NOT APPLIED and points at its genuine-inverse rollback", () => {
    expect(MIGRATION).toContain("Status: AUTHORED, NOT APPLIED");
    expect(MIGRATION).toContain(
      "database/supabase/rollbacks/20261002000015_coregrid_v1_substrate_policies.sql",
    );
    expect(ROLLBACK).toContain("genuine inverse of the substrate policy migration");
  });

  it("forces RLS on exactly the four policy-backed tables", () => {
    const forced = [
      ...MIGRATION.matchAll(/ALTER TABLE public\.(\w+)\s+FORCE ROW LEVEL SECURITY;/g),
    ]
      .map((m) => m[1])
      .sort();
    expect(forced).toEqual([...POLICY_BACKED].sort());
  });

  it("authors exactly the eight-policy inventory on the four tables", () => {
    expect(POLICIES.map((p) => p.name).sort()).toEqual(
      [
        "reconciliation_input_select_own_tenant",
        "reconciliation_input_insert_tenant_admin",
        "event_route_subscription_select_own_tenant",
        "event_route_subscription_insert_tenant_admin",
        "evidence_record_select_own_tenant",
        "evidence_record_insert_tenant_admin",
        "usage_attribution_bucket_select_own_tenant",
        "usage_attribution_bucket_insert_tenant_admin",
      ].sort(),
    );
    for (const table of POLICY_BACKED) {
      const onTable = POLICIES.filter((p) => p.table === table);
      expect(onTable.map((p) => p.command).sort()).toEqual(["INSERT", "SELECT"]);
    }
  });

  it("grants policies only to authenticated — never anon or service_role", () => {
    for (const policy of POLICIES) {
      expect(policy.roles).toEqual(["authenticated"]);
    }
  });

  it("authors NO UPDATE or DELETE policy on any table (append-only law, §28)", () => {
    expect(MIGRATION).not.toMatch(/FOR UPDATE/);
    expect(MIGRATION).not.toMatch(/FOR DELETE/);
    for (const table of POLICY_BACKED) {
      expect(POLICIES.filter((p) => p.table === table && p.command === "SELECT")).toHaveLength(1);
      expect(POLICIES.filter((p) => p.table === table && p.command === "INSERT")).toHaveLength(1);
    }
  });

  it("builds every predicate ONLY from the neutral primitives + auth.uid() self-derivation", () => {
    for (const policy of POLICIES) {
      const identifiers = predicateIdentifiers(policy.body);
      const unlawful = identifiers.filter((id) => !PREDICATE_ALLOWED_IDENTIFIERS.has(id));
      expect(unlawful).toEqual([]);
      // The tenant column is always tested; SELECT resolves the actor's tenant
      // through the primitive, INSERT through the per-tenant admin predicate.
      expect(identifiers).toContain("tenant_id");
      expect(policy.body).toMatch(/public\.(get_my_tenant_id|is_tenant_admin)/);
    }
    // The per-table actor pins (§26 — a client can never assert another actor).
    const subscriptionInsert = POLICIES.find(
      (p) => p.name === "event_route_subscription_insert_tenant_admin",
    );
    expect(subscriptionInsert?.body).toContain("subscriber_id = auth.uid()::text");
    const evidenceInsert = POLICIES.find((p) => p.name === "evidence_record_insert_tenant_admin");
    expect(evidenceInsert?.body).toContain("captured_by = auth.uid()::text");
    expect(evidenceInsert?.body).toContain("created_by = auth.uid()::text");
    // No non-admin role gate is imported: holds_tenant_role stays unused in predicates.
    for (const policy of POLICIES) {
      expect(policy.body).not.toContain("holds_tenant_role");
    }
  });

  it("references no legacy domain helper, domain role literal, or hard-coded tenant", () => {
    for (const policy of POLICIES) {
      expect(policy.body).not.toMatch(/get_my_school_id|is_school_admin/i);
      expect(policy.body).not.toMatch(/'role:(?!administrator)/);
      expect(policy.body).not.toMatch(/=\s*'[0-9a-fA-F-]{8,}'/);
    }
  });

  it("never filters a provenance column (AGENTS §11)", () => {
    for (const policy of POLICIES) {
      const identifiers = predicateIdentifiers(policy.body);
      const leaked = identifiers.filter((id) => PROVENANCE_COLUMNS.includes(id));
      expect(leaked).toEqual([]);
    }
  });

  it("documents the four append-only audit tables as NO-client-write (no policy at all)", () => {
    expect(MIGRATION).toMatch(/NO client INSERT\/UPDATE\/DELETE policy/);
    for (const table of AUDIT_APPEND_ONLY) {
      expect(POLICIES.filter((p) => p.table === table)).toHaveLength(0);
      expect(MIGRATION).toContain(table);
    }
    // The audit ledgers keep their source-migration deny-by-default posture:
    // this migration adds no policy and no grant touching them.
    expect(MIGRATION).not.toMatch(new RegExp(`GRANT[^;]*public\\.${AUDIT_APPEND_ONLY[0]}`));
    expect(MIGRATION).not.toMatch(new RegExp(`GRANT[^;]*public\\.${AUDIT_APPEND_ONLY[1]}`));
    expect(MIGRATION).not.toMatch(new RegExp(`GRANT[^;]*public\\.${AUDIT_APPEND_ONLY[2]}`));
    expect(MIGRATION).not.toMatch(new RegExp(`GRANT[^;]*public\\.${AUDIT_APPEND_ONLY[3]}`));
  });

  it("grants authenticated exactly SELECT + INSERT on the four (least privilege)", () => {
    const grants = [
      ...MIGRATION.matchAll(/GRANT ([A-Z, ]+?) ON TABLE public\.(\w+)\s+TO (\w+);/g),
    ].map(([, privileges, table, role]) => ({ privileges: privileges.trim(), table, role }));
    const authenticatedGrants = grants.filter((g) => g.role === "authenticated");
    expect(authenticatedGrants).toHaveLength(4);
    for (const grant of authenticatedGrants) {
      expect(POLICY_BACKED).toContain(grant.table as (typeof POLICY_BACKED)[number]);
      expect(grant.privileges).toBe("SELECT, INSERT");
    }
    expect(MIGRATION).not.toMatch(/GRANT[^;]*TO anon/);
    const serviceGrants = grants.filter((g) => g.role === "service_role");
    expect(serviceGrants).toHaveLength(4);
    for (const grant of serviceGrants) {
      expect(POLICY_BACKED).toContain(grant.table as (typeof POLICY_BACKED)[number]);
      expect(grant.privileges).toBe("ALL");
    }
  });

  it("touches no other table of the eight batch-A/B families with FORCE or grants", () => {
    const untouched = BATCH_AB_TABLES.filter(
      (t) => !(POLICY_BACKED as readonly string[]).includes(t),
    );
    for (const table of untouched) {
      expect(MIGRATION).not.toMatch(
        new RegExp(`ALTER TABLE public\\.${table} FORCE ROW LEVEL SECURITY`),
      );
      expect(MIGRATION).not.toMatch(new RegExp(`GRANT[^;]*public\\.${table} `));
      expect(MIGRATION).not.toMatch(new RegExp(`CREATE POLICY \\w+\\s+ON public\\.${table}\\b`));
    }
  });

  it("is free of domain vocabulary (J-037 neutrality guard surface)", () => {
    expect(domainViolations(MIGRATION)).toEqual([]);
    expect(domainViolations(ROLLBACK)).toEqual([]);
    expect(domainViolations(POSTURE_RAW)).toEqual([]);
  });
});

describe("H2-04 substrate policies — genuine inverse rollback", () => {
  it("drops exactly the eight authored policies", () => {
    const dropped = [
      ...ROLLBACK.matchAll(/DROP POLICY IF EXISTS (\w+)\s+ON public\.(\w+);/g),
    ].map(([, name, table]) => ({ name, table }));
    expect(dropped.map((d) => d.name).sort()).toEqual(POLICIES.map((p) => p.name).sort());
    for (const { name, table } of dropped) {
      const authored = POLICIES.find((p) => p.name === name);
      expect(authored?.table).toBe(table);
    }
  });

  it("restores the pre-migration grant state exactly (authenticated revoked, service_role silent)", () => {
    const revokes = [
      ...ROLLBACK.matchAll(/REVOKE ([A-Z, ]+?) ON TABLE public\.(\w+)\s+FROM (\w+);/g),
    ].map(([, privileges, table, role]) => ({ privileges: privileges.trim(), table, role }));
    const authenticatedRevokes = revokes.filter((r) => r.role === "authenticated");
    expect(authenticatedRevokes).toHaveLength(4);
    for (const revoke of authenticatedRevokes) {
      expect(POLICY_BACKED).toContain(revoke.table as (typeof POLICY_BACKED)[number]);
      expect(revoke.privileges).toBe("SELECT, INSERT");
    }
    const serviceRevokes = revokes.filter((r) => r.role === "service_role");
    expect(serviceRevokes).toHaveLength(4);
    for (const revoke of serviceRevokes) {
      expect(POLICY_BACKED).toContain(revoke.table as (typeof POLICY_BACKED)[number]);
      expect(revoke.privileges).toBe("ALL");
    }
  });

  it("unforces RLS while keeping it ENABLED (deny-by-default restored exactly)", () => {
    const unforced = [
      ...ROLLBACK.matchAll(/ALTER TABLE public\.(\w+)\s+NO FORCE ROW LEVEL SECURITY;/g),
    ]
      .map((m) => m[1])
      .sort();
    expect(unforced).toEqual([...POLICY_BACKED].sort());
    expect(ROLLBACK).toContain("RLS remains ENABLED");
    expect(ROLLBACK).not.toMatch(/DISABLE ROW LEVEL SECURITY/);
  });

  it("touches only the four policy-backed tables — audit and out-of-scope tables untouched", () => {
    const touched = [...ROLLBACK.matchAll(/public\.(\w+)/g)].map((m) => m[1]);
    for (const table of new Set(touched)) {
      expect(POLICY_BACKED).toContain(table as (typeof POLICY_BACKED)[number]);
    }
    for (const table of AUDIT_APPEND_ONLY) {
      expect(ROLLBACK).not.toContain(`public.${table}`);
    }
  });
});

describe("H2-04 substrate policies — declarative posture JSON (battery steward contract)", () => {
  it("declares exactly the four policy-backed tables with the authored policy inventory", () => {
    const backed = POSTURE.tables.filter((t) => t.posture === "policy-backed");
    // H2-04's own four substrates are pinned exactly; the H3-wave extension
    // entries are pinned separately below (never silently absorbed here).
    expect(backed.map((t) => t.name).sort()).toEqual(
      [...POLICY_BACKED, ...H3_WAVE_POLICY_BACKED].sort(),
    );
    const h2Backed = backed.filter((t) => (POLICY_BACKED as readonly string[]).includes(t.name));
    for (const table of h2Backed) {
      expect(table.forceRls).toBe(true);
      expect(table.tenantColumn).toBe("tenant_id");
      expect(table.privileges).toEqual({
        authenticated: ["SELECT", "INSERT"],
        anon: [],
        service_role: ["ALL"],
      });
      expect(table.policies?.map((p) => p.command).sort()).toEqual(["INSERT", "SELECT"]);
      for (const policy of table.policies ?? []) {
        const authored = POLICIES.find((p) => p.name === policy.name);
        expect(authored).toBeDefined();
        expect(authored?.table).toBe(table.name);
        expect(authored?.command).toBe(policy.command);
        // The declared predicate is the authored one (whitespace-normalized).
        const normalizedAuthored = authored?.body.replace(/\s+/g, " ").trim() ?? "";
        const normalizedDeclared = policy.predicate.replace(/\s+/g, " ").trim();
        expect(normalizedAuthored).toContain(normalizedDeclared);
      }
      expect(table.absentPolicies?.UPDATE).toBeDefined();
      expect(table.absentPolicies?.DELETE).toBeDefined();
    }
  });

  it("carries the H3-wave extension entries with FORCE RLS, owner/actor pins and tombstone/immutable-tombstone law", () => {
    const backed = POSTURE.tables.filter((t) => t.posture === "policy-backed");
    for (const table of backed.filter((t) =>
      (H3_WAVE_POLICY_BACKED as readonly string[]).includes(t.name),
    )) {
      expect(table.forceRls).toBe(true);
      expect(table.tenantColumn).toBe("tenant_id");
      // H3 substrates grant UPDATE (policy-gated) but NEVER DELETE — the
      // tombstone law (§28) holds on both entries.
      expect(table.privileges?.authenticated.sort()).toEqual(
        ["INSERT", "SELECT", "UPDATE"].sort(),
      );
      expect(table.privileges?.anon).toEqual([]);
      expect(table.absentPolicies?.DELETE).toBeDefined();
      // Every declared predicate is built ONLY on the J-005 neutral primitives
      // plus the auth.uid() self-derivation pin — no domain helper, no domain
      // role name, no hard-coded tenant.
      for (const policy of table.policies ?? []) {
        expect(policy.predicate).toMatch(
          /get_my_tenant_id|is_tenant_admin|holds_tenant_role|auth\.uid\(\)/,
        );
      }
    }
    // cg_file_object: SELECT tenant-equality; INSERT/UPDATE tenant-equality AND
    // the owner self-derivation pin; DELETE has no policy and no privilege.
    const file = backed.find((t) => t.name === "cg_file_object");
    expect(file?.policies?.map((p) => p.command).sort()).toEqual(["INSERT", "SELECT", "UPDATE"]);
    const fileInsert = file?.policies?.find((p) => p.command === "INSERT");
    expect(fileInsert?.predicate).toContain("owner_ref = auth.uid()::text");
    // cg_idempotency_record: INSERT requires the neutral administrator binding
    // AND the actor pin; UPDATE is replace-expired-only (USING filters to
    // already-expired rows — a live recorded outcome can never be rewritten).
    const idem = backed.find((t) => t.name === "cg_idempotency_record");
    const idemInsert = idem?.policies?.find((p) => p.command === "INSERT");
    expect(idemInsert?.predicate).toContain("public.is_tenant_admin(tenant_id)");
    expect(idemInsert?.predicate).toContain("actor_id = auth.uid()::text");
    const idemUpdate = idem?.policies?.find((p) => p.command === "UPDATE");
    expect(idemUpdate?.predicate).toContain("expires_at <= now()");
  });

  it("covers every table of the eight batch-A/B migrations with cited sources", () => {
    const names = POSTURE.tables.map((t) => t.name);
    // The H2-04 inventory is covered exhaustively; the H3-wave extension adds
    // entries beyond it (declared, pinned, never absorbed into this list).
    for (const table of BATCH_AB_TABLES) {
      expect(names).toContain(table);
    }
    expect(names.filter((n) => !(BATCH_AB_TABLES as readonly string[]).includes(n))).toEqual(
      [...H3_WAVE_POLICY_BACKED],
    );
    for (const table of POSTURE.tables.filter((t) =>
      (BATCH_AB_TABLES as readonly string[]).includes(t.name),
    )) {
      expect(SOURCE_MIGRATIONS).toContain(
        table.source as (typeof SOURCE_MIGRATIONS)[number],
      );
    }
    expect(POSTURE.migration).toBe(MIGRATION_PATH);
    expect(POSTURE.rollback).toBe(ROLLBACK_PATH);
  });

  it("declares the audit ledgers zero-policy with an explicit NONE client-write policy", () => {
    for (const table of AUDIT_APPEND_ONLY) {
      const entry = POSTURE.tables.find((t) => t.name === table);
      expect(entry?.posture).toBe("zero-policy");
      expect(entry?.auditAppendOnly).toBe(true);
      expect(entry?.clientWritePolicy).toMatch(/^NONE/);
    }
  });

  it("keeps the battery expectations consistent with the table inventory", () => {
    const backed = POSTURE.tables.filter((t) => t.posture === "policy-backed").map((t) => t.name);
    const zero = POSTURE.tables.filter((t) => t.posture === "zero-policy").map((t) => t.name);
    expect(POSTURE.batteryExpectations.policyBackedTables.sort()).toEqual(backed.sort());
    expect(POSTURE.batteryExpectations.zeroPolicyTables.sort()).toEqual(zero.sort());
    expect(backed.length + zero.length).toBe(
      BATCH_AB_TABLES.length + H3_WAVE_POLICY_BACKED.length,
    );
  });

  it("declares the policy construction law and its forbidden vocabulary", () => {
    expect(POSTURE.policyConstructionLaw.allowedPredicates).toContain(
      "public.get_my_tenant_id()",
    );
    expect(POSTURE.policyConstructionLaw.allowedPredicates).toContain(
      "public.is_tenant_admin(p_tenant)",
    );
    expect(POSTURE.policyConstructionLaw.allowedPredicates).toContain(
      "public.holds_tenant_role(p_tenant, p_role_ref)",
    );
    expect(POSTURE.policyConstructionLaw.forbiddenInPredicates).toEqual(
      expect.arrayContaining([
        "legacy domain helpers (the pre-J-005 domain tenancy/role reader pair)",
        "domain role names (J-006: mapping lives in DomainDefinition.roleMappings)",
        "hard-coded tenant ids",
      ]),
    );
  });
});