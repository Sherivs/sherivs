/**
 * MISSION H2-03 — transport fleet RLS re-verify + normalization: migration
 * pinning (Database Security Engineer, RLS author role).
 *
 * Covers: authored-integrity pinning for migration 20261002000014 and its
 * genuine inverse rollback, the declared per-table posture (zero-policy
 * deny-by-default — the RLS_ISOLATION_BATTERY.md dual-posture strongest
 * form), the schema-source lineage (legacy definition 20260626150625 +
 * correction 20260904010000), and the battery-steward adoption contract
 * (scripts/verification/rls-table-postures-transport.json). Static pinning
 * only — the migration is AUTHORED, NOT APPLIED: no live battery, no
 * canonical access (the battery script is owned by another mission).
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MIGRATION_PATH = "database/supabase/migrations/20261002000014_coregrid_v2_transport_buses_rls.sql";
const ROLLBACK_PATH = "database/supabase/rollbacks/20261002000014_coregrid_v2_transport_buses_rls.sql";
const POSTURES_PATH = "scripts/verification/rls-table-postures-transport.json";
const LEGACY_SOURCE_PATH =
  "database/supabase/migrations/20260626150625_35a08443-45fd-46ae-807b-3644b44efe26.sql";
const CORRECTION_PATH =
  "database/supabase/migrations/20260904010000_coregrid_rls_transport_and_grants.sql";
const BATTERY_DOC_PATH =
  "architecture/coregrid-mvp-architecture/ratification/RLS_ISOLATION_BATTERY.md";

const MIGRATION = readFileSync(join(ROOT, MIGRATION_PATH), "utf8");
const ROLLBACK = readFileSync(join(ROOT, ROLLBACK_PATH), "utf8");
const POSTURES: PostureDeclaration = JSON.parse(
  readFileSync(join(ROOT, POSTURES_PATH), "utf8"),
) as unknown as PostureDeclaration;
const LEGACY_SOURCE = readFileSync(join(ROOT, LEGACY_SOURCE_PATH), "utf8");
const CORRECTION = readFileSync(join(ROOT, CORRECTION_PATH), "utf8");

const TABLE = "public.transport_buses";
const DROPPED_POLICIES = [
  "buses_school_rw",
  "buses_school_read",
  "buses_driver_or_admin_update",
  "buses_school_admin_insert",
  "buses_school_admin_delete",
] as const;

/** Declarative shape of the battery-steward adoption contract. */
interface PostureTable {
  name: string;
  qualifiedName: string;
  posture: "zero-policy" | "policy-backed";
  sourceMigration: string;
  normalizedBy: string;
  expectedCatalog: {
    relrowsecurity: boolean;
    relforcerowsecurity: boolean;
    policies: string[];
    permissivePolicies: number;
  };
  droppedPolicies: string[];
  expectedPrivileges: {
    anon: string[];
    authenticated: string[];
    PUBLIC: string[];
    service_role: string[];
  };
  expectedAnonRestProbe: { denyExpected: boolean; acceptableDenialForms: string[] };
}
interface PostureDeclaration {
  artifact: string;
  status: string;
  migration: string;
  rollback: string;
  tables: PostureTable[];
  outOfScope: { name: string; qualifiedName: string; reason: string }[];
  batteryExpectations: {
    zeroPolicyTables: string[];
    policyBackedTables: string[];
    genuineInverse: string;
  };
}

/* ─────────────────────────────────────────────────────────────
 * 1. Authored integrity (AUTHORED, NOT APPLIED + rollback pointer)
 * ────────────────────────────────────────────────────────────*/

describe("transport RLS migration 20261002000014 — authored integrity", () => {
  it("carries the AUTHORED, NOT APPLIED status and rollback pointer", () => {
    expect(MIGRATION).toContain("Status: AUTHORED, NOT APPLIED");
    expect(MIGRATION).toContain(ROLLBACK_PATH);
    expect(ROLLBACK).toContain("Status: AUTHORED, NOT APPLIED");
    expect(ROLLBACK).toContain(MIGRATION_PATH);
  });

  it("cites its governance authority (battery doc, RULING-2, AGENTS §17/§28)", () => {
    expect(MIGRATION).toContain("RLS_ISOLATION_BATTERY.md");
    expect(MIGRATION).toContain("RULING-2");
    expect(MIGRATION).toContain("AGENTS.md §17");
    expect(MIGRATION).toContain("§28");
  });

  it("pins the inspected schema-source lineage (legacy definition + correction)", () => {
    // Repository discovery law: the schema source is cited, never assumed.
    expect(MIGRATION).toContain(LEGACY_SOURCE_PATH);
    expect(MIGRATION).toContain(CORRECTION_PATH);
    // And those sources are real, inspected files that define the table's RLS.
    expect(LEGACY_SOURCE).toContain(`CREATE TABLE IF NOT EXISTS public.transport_buses (`);
    expect(LEGACY_SOURCE).toContain(
      "ALTER TABLE public.transport_buses ENABLE ROW LEVEL SECURITY;",
    );
    expect(CORRECTION).toContain("DROP POLICY IF EXISTS buses_school_rw ON public.transport_buses;");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 2. Declared posture: RLS enabled, ZERO policies, zero client grants
 * ────────────────────────────────────────────────────────────*/

describe("transport RLS migration 20261002000014 — declared zero-policy posture", () => {
  it("re-asserts RLS ENABLED on the transport fleet table", () => {
    expect(MIGRATION).toContain(
      `ALTER TABLE ${TABLE} ENABLE ROW LEVEL SECURITY;`,
    );
  });

  it("authors ZERO RLS policies (deny-by-default strongest form)", () => {
    expect(MIGRATION).not.toContain("CREATE POLICY");
  });

  it("drops every permissive policy the table is known to have carried", () => {
    for (const policy of DROPPED_POLICIES) {
      expect(MIGRATION).toMatch(new RegExp(`DROP POLICY IF EXISTS ${policy}\\s+ON ${TABLE};`));
    }
  });

  it("normalizes to zero client privileges (anon, authenticated, PUBLIC)", () => {
    expect(MIGRATION).toContain(`REVOKE ALL ON ${TABLE} FROM anon;`);
    expect(MIGRATION).toContain(`REVOKE ALL ON ${TABLE} FROM authenticated;`);
    expect(MIGRATION).toContain(`REVOKE ALL ON ${TABLE} FROM PUBLIC;`);
  });

  it("keeps the sanctioned server-only bypass path (service_role ALL)", () => {
    expect(MIGRATION).toContain(`GRANT ALL ON TABLE ${TABLE} TO service_role;`);
  });

  it("guards the apply: a surviving permissive policy fails loudly", () => {
    expect(MIGRATION).toContain("pg_catalog.pg_policies");
    expect(MIGRATION).toContain("tablename = 'transport_buses'");
    expect(MIGRATION).toContain("RAISE EXCEPTION");
    expect(MIGRATION).toContain("POSTURE VIOLATION");
  });

  it("declares the posture in the header and on the table (machine-readable)", () => {
    expect(MIGRATION).toContain("declared posture: ZERO-POLICY");
    expect(MIGRATION).toContain("COMMENT ON TABLE public.transport_buses IS");
    expect(MIGRATION).toMatch(/ZERO-POLICY\s+deny-by-default/);
  });

  it("does not force RLS (battery INFO convention for zero-policy tables)", () => {
    expect(MIGRATION).not.toContain("FORCE ROW LEVEL SECURITY");
    expect(MIGRATION).toContain("relforcerowsecurity is intentionally left FALSE");
  });

  it("does not run any live battery or canonical probe itself", () => {
    expect(MIGRATION).not.toMatch(/\bselect\b.*\bfrom\b.*rest/i);
    expect(MIGRATION).not.toContain("SUPABASE_URL");
    expect(MIGRATION).not.toContain("DATABASE_URL");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 3. Rollback: genuine inverse, never resurrecting the finding
 * ────────────────────────────────────────────────────────────*/

describe("transport RLS rollback — genuine inverse of 20261002000014", () => {
  it("re-creates the pre-migration policy set (20260904010000 verbatim)", () => {
    for (const policy of DROPPED_POLICIES.slice(1)) {
      expect(ROLLBACK).toContain(`CREATE POLICY ${policy} ON public.transport_buses`);
    }
    expect(ROLLBACK).toContain(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON public.transport_buses TO authenticated;",
    );
    expect(ROLLBACK).toContain("GRANT ALL ON public.transport_buses TO service_role;");
  });

  it("never resurrects the recorded finding (the legacy campus-wide FOR ALL policy stays dropped)", () => {
    expect(ROLLBACK).not.toMatch(/CREATE POLICY\s+"?buses_school_rw"?/);
    expect(ROLLBACK).toContain("buses_school_rw FOR ALL policy stays dropped");
  });

  it("never disables RLS itself (inverse restores the corrected posture, not a bare table)", () => {
    expect(ROLLBACK).not.toContain("NO ROW LEVEL SECURITY");
    expect(ROLLBACK).not.toContain("DISABLE ROW LEVEL SECURITY");
    expect(ROLLBACK).toContain(
      "ALTER TABLE public.transport_buses ENABLE ROW LEVEL SECURITY;",
    );
  });

  it("restores the pre-migration comment state (none) and declares the regression honestly", () => {
    expect(ROLLBACK).toContain("COMMENT ON TABLE public.transport_buses IS NULL;");
    expect(ROLLBACK).toContain("security-posture regression");
    expect(ROLLBACK).toContain("outside the battery's dual-posture model");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 4. Battery-steward adoption contract (declarative posture JSON)
 * ────────────────────────────────────────────────────────────*/

describe("rls-table-postures-transport.json — battery-steward adoption contract", () => {
  it("is a well-formed declaration naming this mission and its files", () => {
    expect(POSTURES.artifact).toBe("rls-table-postures-transport");
    expect(POSTURES.status).toContain("AUTHORED, NOT APPLIED");
    expect(POSTURES.migration).toBe(MIGRATION_PATH);
    expect(POSTURES.rollback).toBe(ROLLBACK_PATH);
    for (const path of [POSTURES.migration, POSTURES.rollback]) {
      expect(existsSync(join(ROOT, path))).toBe(true);
    }
  });

  it("declares exactly one table — the driver families' bus table — as zero-policy", () => {
    expect(POSTURES.tables).toHaveLength(1);
    const table = POSTURES.tables[0];
    expect(table.qualifiedName).toBe(TABLE);
    expect(table.posture).toBe("zero-policy");
    expect(table.sourceMigration).toBe(LEGACY_SOURCE_PATH);
    expect(table.normalizedBy).toBe(MIGRATION_PATH);
  });

  it("pins the battery's zero-policy expected catalog state", () => {
    const table = POSTURES.tables[0];
    expect(table.expectedCatalog.relrowsecurity).toBe(true);
    expect(table.expectedCatalog.relforcerowsecurity).toBe(false);
    expect(table.expectedCatalog.policies).toEqual([]);
    expect(table.expectedCatalog.permissivePolicies).toBe(0);
  });

  it("pins zero client privileges and a genuine-deny anon REST expectation", () => {
    const table = POSTURES.tables[0];
    expect(table.expectedPrivileges.anon).toEqual([]);
    expect(table.expectedPrivileges.authenticated).toEqual([]);
    expect(table.expectedPrivileges.PUBLIC).toEqual([]);
    expect(table.expectedPrivileges.service_role).toEqual(["ALL"]);
    expect(table.expectedAnonRestProbe.denyExpected).toBe(true);
    for (const form of table.expectedAnonRestProbe.acceptableDenialForms) {
      expect(["empty-set-200", "42501-permission-denied"]).toContain(form);
    }
  });

  it("stays consistent with the migration's dropped-policy inventory", () => {
    const table = POSTURES.tables[0];
    expect(table.droppedPolicies).toEqual([...DROPPED_POLICIES]);
    for (const policy of table.droppedPolicies) {
      expect(MIGRATION).toMatch(new RegExp(`DROP POLICY IF EXISTS ${policy}\\s+ON ${TABLE};`));
    }
  });

  it("segregates out-of-scope tables and mirrors the migration's posture wording", () => {
    expect(POSTURES.outOfScope.map((t) => t.qualifiedName)).toEqual([
      "public.school_transport",
    ]);
    expect(POSTURES.batteryExpectations.zeroPolicyTables).toEqual(["transport_buses"]);
    expect(POSTURES.batteryExpectations.policyBackedTables).toEqual([]);
    expect(MIGRATION).toContain("declared posture: ZERO-POLICY");
    expect(POSTURES.tables[0].posture).toBe("zero-policy");
  });

  it("records the genuine-inverse contract for the rollback", () => {
    expect(POSTURES.batteryExpectations.genuineInverse).toContain("restores exactly");
    expect(POSTURES.batteryExpectations.genuineInverse).toContain("20260904010000");
    expect(POSTURES.batteryExpectations.genuineInverse).toContain("buses_school_rw");
  });
});
