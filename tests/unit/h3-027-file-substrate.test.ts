/**
 * CoreGrid — MISSION H3-027: V1 file-plane substrate (L-T-011).
 *
 * Pins the authored migration 20261003000016_coregrid_v1_file_substrate.sql
 * and its genuine-inverse rollback. OFFLINE unit suite: SQL text assertions
 * only — no database, no network, no applied artifact:
 *
 *  1. AUTHORED, NOT APPLIED status and the rollback pointer (repository
 *     rollback convention: database/supabase/rollbacks/<migration-basename>);
 *  2. the intended posture entry is authored in the SQL header (table name,
 *     zeroPolicy: false, FORCE RLS, policy summary) and deliberately NOT in
 *     the posture JSON files (owned by other teams);
 *  3. exactly one table (cg_file_object) with FORCED RLS and the exact
 *     three-policy inventory (SELECT tenant-equality; INSERT/UPDATE
 *     tenant-equality + owner self-derivation; NO DELETE policy);
 *  4. every predicate built ONLY on the J-005 neutral primitives plus
 *     auth.uid() actor self-derivation — no domain helper, no domain role
 *     name, no hard-coded tenant (J-005/J-006 law);
 *  5. the DB-level tenant boundary on content_ref (L-T-011): the storage
 *     path is CHECK-pinned to the row's own tenant prefix, mirroring the
 *     storage adapter's buildObjectPath shape;
 *  6. privileges: deny-first REVOKE from anon AND authenticated; then
 *     authenticated = SELECT + INSERT + UPDATE exactly (no DELETE);
 *     anon never granted; service_role bypass-path parity (ALL);
 *  7. the rollback is the genuine inverse (policies dropped, grants
 *     revoked, RLS unforced but ENABLED, table dropped);
 *  8. domain-neutrality sweep on both SQL files (J-037 vocabulary guard).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MIGRATION_PATH =
  "database/supabase/migrations/20261003000016_coregrid_v1_file_substrate.sql";
const ROLLBACK_PATH =
  "database/supabase/rollbacks/20261003000016_coregrid_v1_file_substrate.sql";

const MIGRATION = readFileSync(join(ROOT, MIGRATION_PATH), "utf8");
const ROLLBACK = readFileSync(join(ROOT, ROLLBACK_PATH), "utf8");

const TABLE = "cg_file_object";

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
  "owner_ref",
  "public",
  "get_my_tenant_id",
  "auth",
  "uid",
  "text",
  "AND",
]);

function predicateIdentifiers(body: string): string[] {
  const cleaned = body
    .replace(/USING/i, " ")
    .replace(/WITH CHECK/i, " ")
    .replace(/[(),]/g, " ");
  return [...cleaned.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)].map((m) => m[0]);
}

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

describe("H3-027 file substrate — authored posture", () => {
  it("is AUTHORED, NOT APPLIED and points at its genuine-inverse rollback", () => {
    expect(MIGRATION).toContain("Status: AUTHORED, NOT APPLIED");
    expect(MIGRATION).toContain(
      "database/supabase/rollbacks/20261003000016_coregrid_v1_file_substrate.sql",
    );
    expect(ROLLBACK).toContain("genuine inverse of the file-substrate migration");
  });

  it("authors the intended posture entry in the SQL header — never in the posture JSON files", () => {
    expect(MIGRATION).toContain('"name": "cg_file_object"');
    expect(MIGRATION).toContain('"zeroPolicy": false');
    expect(MIGRATION).toContain('"posture": "policy-backed"');
    expect(MIGRATION).toContain('"forceRls": true');
    expect(MIGRATION).toContain('"tenantColumn": "tenant_id"');
    // The posture entry is documented as SQL-header-only: the migration must
    // explicitly record that the posture JSON files are NOT authored here.
    expect(MIGRATION).toMatch(
      /INTENDED POSTURE ENTRY \(declarative; authored HERE ONLY[\s\S]*?NOT\s*\n?--\s+written into scripts\/verification\/rls-table-postures-\*\.json/,
    );
  });

  it("creates exactly one table — cg_file_object — and forces RLS on it", () => {
    const created = [
      ...MIGRATION.matchAll(/CREATE TABLE IF NOT EXISTS public\.(\w+) \(/g),
    ].map((m) => m[1]);
    expect(created).toEqual([TABLE]);

    const enabled = [
      ...MIGRATION.matchAll(/ALTER TABLE public\.(\w+)\s+ENABLE ROW LEVEL SECURITY;/g),
    ].map((m) => m[1]);
    expect(enabled).toEqual([TABLE]);

    const forced = [
      ...MIGRATION.matchAll(/ALTER TABLE public\.(\w+)\s+FORCE ROW LEVEL SECURITY;/g),
    ].map((m) => m[1]);
    expect(forced).toEqual([TABLE]);
  });

  it("authors exactly the three-policy inventory with no DELETE policy (tombstone law, §28)", () => {
    expect(POLICIES.map((p) => p.name).sort()).toEqual(
      [
        "file_object_select_own_tenant",
        "file_object_insert_own_tenant",
        "file_object_update_own_tenant",
      ].sort(),
    );
    for (const policy of POLICIES) {
      expect(policy.table).toBe(TABLE);
      expect(policy.roles).toEqual(["authenticated"]);
    }
    const commands = POLICIES.map((p) => p.command).sort();
    expect(commands).toEqual(["INSERT", "SELECT", "UPDATE"]);
    expect(MIGRATION).not.toMatch(/FOR DELETE/);
    expect(MIGRATION).toMatch(/NO policy AND no privilege/);
  });

  it("builds every predicate ONLY from the neutral primitives + auth.uid() self-derivation", () => {
    for (const policy of POLICIES) {
      const identifiers = predicateIdentifiers(policy.body);
      const unlawful = identifiers.filter((id) => !PREDICATE_ALLOWED_IDENTIFIERS.has(id));
      expect(unlawful).toEqual([]);
      // The tenant column is always resolved through the neutral primitive.
      expect(policy.body).toContain("tenant_id = public.get_my_tenant_id()");
    }
    // The per-table actor pin (§26 — a client can never assert another owner).
    const insert = POLICIES.find((p) => p.name === "file_object_insert_own_tenant");
    expect(insert?.body).toContain("owner_ref = auth.uid()::text");
    const update = POLICIES.find((p) => p.name === "file_object_update_own_tenant");
    expect(update?.body).toContain("owner_ref = auth.uid()::text");
    // UPDATE filters (USING) and re-validates (WITH CHECK) on the same pin —
    // a row cannot be re-attributed nor moved across tenants.
    expect(update?.body).toMatch(/USING[\s\S]*owner_ref = auth\.uid\(\)::text[\s\S]*WITH CHECK[\s\S]*owner_ref = auth\.uid\(\)::text/);
  });

  it("references no legacy domain helper, domain role literal, or hard-coded tenant", () => {
    for (const policy of POLICIES) {
      expect(policy.body).not.toMatch(/get_my_school_id|is_school_admin/i);
      expect(policy.body).not.toMatch(/'role:(?!administrator)/);
      expect(policy.body).not.toMatch(/=\s*'[0-9a-fA-F-]{8,}'/);
      expect(policy.body).not.toMatch(/is_tenant_admin|holds_tenant_role/);
    }
  });

  it("carries the DB-level tenant boundary on content_ref (L-T-011)", () => {
    // The storage path is pinned to the row's own tenant prefix — the exact
    // adapter shape <tenant_id>/<purpose>/<filename> — so a cross-tenant or
    // traversal content ref can never satisfy the constraint.
    expect(MIGRATION).toMatch(
      /content_ref\s+text NOT NULL CHECK \([\s\S]*content_ref = tenant_id \|\| '\/' \|\| purpose \|\| '\/' \|\| filename/,
    );
    // The filename CHECK repeats the adapter's refusal shapes.
    expect(MIGRATION).toMatch(/position\('\/' in filename\) = 0/);
    expect(MIGRATION).toMatch(/position\(chr\(92\) in filename\) = 0/);
    expect(MIGRATION).toMatch(/position\('\.\.' in filename\) = 0/);
  });

  it("revokes from anon AND authenticated first, then grants least-privilege", () => {
    expect(MIGRATION).toContain(
      "REVOKE ALL ON public.cg_file_object FROM anon, authenticated;",
    );
    const grants = [
      ...MIGRATION.matchAll(/GRANT ([A-Z, ]+?) ON TABLE public\.(\w+)\s+TO (\w+);/g),
    ].map(([, privileges, table, role]) => ({ privileges: privileges.trim(), table, role }));
    const authenticatedGrants = grants.filter((g) => g.role === "authenticated");
    expect(authenticatedGrants).toHaveLength(1);
    expect(authenticatedGrants[0].table).toBe(TABLE);
    expect(authenticatedGrants[0].privileges).toBe("SELECT, INSERT, UPDATE");
    const serviceGrants = grants.filter((g) => g.role === "service_role");
    expect(serviceGrants).toHaveLength(1);
    expect(serviceGrants[0].table).toBe(TABLE);
    expect(serviceGrants[0].privileges).toBe("ALL");
    // anon never receives a grant and never a policy (checked above).
    expect(MIGRATION).not.toMatch(/GRANT[^;]*TO anon/);
  });

  it("documents the sharing-model layering (RLS is the tenant boundary, not the sharing gate)", () => {
    expect(MIGRATION).toMatch(
      /RLS here is the TENANT boundary, not the per-actor sharing gate/,
    );
    expect(MIGRATION).toMatch(/Sharing-model layering/);
  });

  it("is free of domain vocabulary (J-037 neutrality guard surface)", () => {
    expect(domainViolations(MIGRATION)).toEqual([]);
    expect(domainViolations(ROLLBACK)).toEqual([]);
  });
});

describe("H3-027 file substrate — genuine inverse rollback", () => {
  it("drops exactly the three authored policies", () => {
    const dropped = [
      ...ROLLBACK.matchAll(/DROP POLICY IF EXISTS (\w+)\s+ON public\.(\w+);/g),
    ].map(([, name, table]) => ({ name, table }));
    expect(dropped.map((d) => d.name).sort()).toEqual(POLICIES.map((p) => p.name).sort());
    for (const { name, table } of dropped) {
      const authored = POLICIES.find((p) => p.name === name);
      expect(authored?.table).toBe(table);
    }
  });

  it("restores the pre-migration grant state exactly (authenticated + service_role revoked, anon stays revoked)", () => {
    expect(ROLLBACK).toContain(
      "REVOKE SELECT, INSERT, UPDATE ON TABLE public.cg_file_object FROM authenticated;",
    );
    expect(ROLLBACK).toContain("REVOKE ALL ON TABLE public.cg_file_object FROM service_role;");
    expect(ROLLBACK).toContain("REVOKE ALL ON public.cg_file_object FROM anon, authenticated;");
    // The rollback grants nothing.
    expect(ROLLBACK).not.toMatch(/GRANT[^;]*TO (anon|authenticated|service_role)/);
  });

  it("unforces RLS while keeping it ENABLED (deny-by-default restored exactly)", () => {
    const unforced = [
      ...ROLLBACK.matchAll(/ALTER TABLE public\.(\w+)\s+NO FORCE ROW LEVEL SECURITY;/g),
    ].map((m) => m[1]);
    expect(unforced).toEqual([TABLE]);
    expect(ROLLBACK).toContain("RLS remains ENABLED");
    expect(ROLLBACK).not.toMatch(/DISABLE ROW LEVEL SECURITY/);
  });

  it("drops the substrate table — the migration created it, its inverse removes it", () => {
    expect(ROLLBACK).toContain("DROP TABLE IF EXISTS public.cg_file_object;");
    // The rollback touches ONLY cg_file_object.
    const touched = [...ROLLBACK.matchAll(/public\.(\w+)/g)].map((m) => m[1]);
    for (const table of new Set(touched)) {
      expect(table).toBe(TABLE);
    }
  });
});