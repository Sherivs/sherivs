/**
 * MISSION D-040 — RLS posture adjudication for the tool/transport family:
 * cg_tool_runtime_tool, cg_tool_runtime_invocation, transport_buses
 * (Posture Adjudication Engineer role, H3 wave Squad D).
 *
 * Asserts the internal consistency of the three decision docs under
 * architecture/campaigns/h3/posture-adjudication/:
 *   1. every adjudicated table EXISTS in its cited migration (created, RLS
 *      enabled, zero policies, client privileges revoked);
 *   2. every adjudicated table is battery-scoped as a zero-policy entry
 *      (static cg_ registry in the battery script for the tool-runtime pair;
 *      the declared posture-file path for the non-cg transport_buses);
 *   3. the posture JSONs and the live canonical apply record agree with the
 *      adjudicated zero-policy posture;
 *   4. the decision docs exist, name their table, and adjudicate
 *      zero-policy without authoring any policy (apply-nothing law).
 *
 * READ-ONLY posture verification: the battery script and the posture JSONs
 * are imported via fs and never modified (team J-099 merges rationales).
 * No database access, no network, no secrets.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

const TOOL_RUNTIME_MIGRATION_PATH =
  "database/supabase/migrations/20261002000012_coregrid_v1_tool_runtime.sql";
const TOOL_RUNTIME_ROLLBACK_PATH =
  "database/supabase/rollbacks/20261002000012_coregrid_v1_tool_runtime.sql";
const TRANSPORT_NORMALIZATION_PATH =
  "database/supabase/migrations/20261002000014_coregrid_v2_transport_buses_rls.sql";
const TRANSPORT_LEGACY_PATH =
  "database/supabase/migrations/20260626150625_35a08443-45fd-46ae-807b-3644b44efe26.sql";
const SUBSTRATE_POSTURES_PATH = "scripts/verification/rls-table-postures-substrate.json";
const TRANSPORT_POSTURES_PATH = "scripts/verification/rls-table-postures-transport.json";
const BATTERY_SCRIPT_PATH = "scripts/verify-rls-isolation-battery.mjs";
const CANONICAL_APPLY_RECORD_PATH = "architecture/proofs/CANONICAL_APPLY_RECORD_HARDENING.json";

const DECISION_DOC_PATHS: Record<string, string> = {
  cg_tool_runtime_tool: "architecture/campaigns/h3/posture-adjudication/cg_tool_runtime_tool.md",
  cg_tool_runtime_invocation:
    "architecture/campaigns/h3/posture-adjudication/cg_tool_runtime_invocation.md",
  transport_buses: "architecture/campaigns/h3/posture-adjudication/transport_buses.md",
};

type AdjudicatedTable = keyof typeof DECISION_DOC_PATHS;
const ADJUDICATED_TABLES = Object.keys(DECISION_DOC_PATHS) as AdjudicatedTable[];

/* ── Read-only fixtures ─────────────────────────────────────────── */

const TOOL_RUNTIME_MIGRATION = readFileSync(join(ROOT, TOOL_RUNTIME_MIGRATION_PATH), "utf8");
const TOOL_RUNTIME_ROLLBACK = readFileSync(join(ROOT, TOOL_RUNTIME_ROLLBACK_PATH), "utf8");
const TRANSPORT_NORMALIZATION = readFileSync(join(ROOT, TRANSPORT_NORMALIZATION_PATH), "utf8");
const TRANSPORT_LEGACY = readFileSync(join(ROOT, TRANSPORT_LEGACY_PATH), "utf8");
const BATTERY_SCRIPT = readFileSync(join(ROOT, BATTERY_SCRIPT_PATH), "utf8");
const CANONICAL_APPLY_RECORD = JSON.parse(
  readFileSync(join(ROOT, CANONICAL_APPLY_RECORD_PATH), "utf8"),
) as unknown as {
  rlsPosture?: Array<{ table?: string; posture?: string }>;
  declaredVsApplied?: Array<{ file?: string; state?: string; evidence?: string }>;
};

type SubstratePostureFile = {
  tables?: Array<{ name?: string; posture?: string }>;
  batteryExpectations?: { zeroPolicyTables?: string[] };
};
const SUBSTRATE_POSTURES = JSON.parse(
  readFileSync(join(ROOT, SUBSTRATE_POSTURES_PATH), "utf8"),
) as unknown as SubstratePostureFile;

type TransportPostureFile = {
  tables?: Array<{
    name?: string;
    posture?: string;
    normalizedBy?: string;
    policyBackedBy?: string;
  }>;
  batteryExpectations?: { zeroPolicyTables?: string[]; policyBackedTables?: string[] };
};
const TRANSPORT_POSTURES = JSON.parse(
  readFileSync(join(ROOT, TRANSPORT_POSTURES_PATH), "utf8"),
) as unknown as TransportPostureFile;

/* ── 1. Tables exist in migrations with the zero-policy posture ─── */

describe("D-040 adjudicated tables exist in their cited migrations", () => {
  it("cg_tool_runtime_tool is created by the tool-runtime migration with RLS enabled", () => {
    expect(TOOL_RUNTIME_MIGRATION).toContain(
      "CREATE TABLE IF NOT EXISTS public.cg_tool_runtime_tool (",
    );
    expect(TOOL_RUNTIME_MIGRATION).toContain(
      "ALTER TABLE public.cg_tool_runtime_tool ENABLE ROW LEVEL SECURITY;",
    );
  });

  it("cg_tool_runtime_invocation is created by the tool-runtime migration with RLS enabled", () => {
    expect(TOOL_RUNTIME_MIGRATION).toContain(
      "CREATE TABLE IF NOT EXISTS public.cg_tool_runtime_invocation (",
    );
    expect(TOOL_RUNTIME_MIGRATION).toContain(
      "ALTER TABLE public.cg_tool_runtime_invocation ENABLE ROW LEVEL SECURITY;",
    );
  });

  it("both tool-runtime tables carry zero policies in the migration", () => {
    expect(TOOL_RUNTIME_MIGRATION).toContain("RLS policies: ZERO policies authored");
    expect(TOOL_RUNTIME_MIGRATION).not.toMatch(/CREATE POLICY[^\n]*cg_tool_runtime/);
  });

  it("both tool-runtime tables have all client privileges revoked (deny-by-default strongest form)", () => {
    expect(TOOL_RUNTIME_MIGRATION).toContain(
      "REVOKE ALL ON public.cg_tool_runtime_tool FROM anon, authenticated;",
    );
    expect(TOOL_RUNTIME_MIGRATION).toContain(
      "REVOKE ALL ON public.cg_tool_runtime_invocation FROM anon, authenticated;",
    );
  });

  it("the tool-runtime rollback drops the two tables (genuine inverse exists)", () => {
    expect(TOOL_RUNTIME_ROLLBACK).toContain("DROP TABLE IF EXISTS public.cg_tool_runtime_invocation;");
    expect(TOOL_RUNTIME_ROLLBACK).toContain("DROP TABLE IF EXISTS public.cg_tool_runtime_tool;");
  });

  it("transport_buses is created by the legacy definition migration", () => {
    expect(TRANSPORT_LEGACY).toContain("CREATE TABLE IF NOT EXISTS public.transport_buses (");
    expect(TRANSPORT_LEGACY).toContain("school_id uuid NOT NULL REFERENCES public.schools(id)");
  });

  it("transport_buses carries NO neutral tenant reference in its legacy definition (basis of the zero-policy adjudication)", () => {
    const tableBlock = TRANSPORT_LEGACY.slice(
      TRANSPORT_LEGACY.indexOf("CREATE TABLE IF NOT EXISTS public.transport_buses ("),
      TRANSPORT_LEGACY.indexOf("FOR ALL USING (school_id = public.get_my_school_id() OR public.is_super_admin())", TRANSPORT_LEGACY.indexOf("CREATE TABLE IF NOT EXISTS public.transport_buses (")),
    );
    expect(tableBlock).not.toContain("tenant_id");
  });

  it("transport_buses is normalized to zero-policy by the H2-03 migration", () => {
    expect(TRANSPORT_NORMALIZATION).toContain(
      "ALTER TABLE public.transport_buses ENABLE ROW LEVEL SECURITY;",
    );
    expect(TRANSPORT_NORMALIZATION).not.toMatch(/CREATE POLICY[^\n]*transport_buses/);
    expect(TRANSPORT_NORMALIZATION).toContain(
      "REVOKE ALL ON public.transport_buses FROM anon;",
    );
    expect(TRANSPORT_NORMALIZATION).toContain(
      "REVOKE ALL ON public.transport_buses FROM authenticated;",
    );
    expect(TRANSPORT_NORMALIZATION).toContain(
      "REVOKE ALL ON public.transport_buses FROM PUBLIC;",
    );
    expect(TRANSPORT_NORMALIZATION).toContain(
      "GRANT ALL ON TABLE public.transport_buses TO service_role;",
    );
    expect(TRANSPORT_NORMALIZATION).toMatch(/DROP POLICY IF EXISTS buses_\w+ ON public\.transport_buses;/);
  });
});

/* ── 2. Battery scope contains each table as a zero-policy entry ── */

describe("D-040 adjudicated tables are battery-scoped zero-policy entries", () => {
  it("the battery script's static cg_ registry declares the tool-runtime pair zero-policy", () => {
    expect(BATTERY_SCRIPT).toContain(
      '{ name: "cg_tool_runtime_tool", source: "20261002000012_coregrid_v1_tool_runtime.sql", posture: "zero-policy" }',
    );
    expect(BATTERY_SCRIPT).toContain(
      '{ name: "cg_tool_runtime_invocation", source: "20261002000012_coregrid_v1_tool_runtime.sql", posture: "zero-policy" }',
    );
  });

  it("the battery script's declared-non-cg mechanism scopes transport_buses by name from posture files", () => {
    expect(BATTERY_SCRIPT).toContain("transport_buses");
    expect(BATTERY_SCRIPT).toContain("declaredNonCg");
  });

  it("the substrate posture JSON declares the tool-runtime pair zero-policy", () => {
    for (const table of ["cg_tool_runtime_tool", "cg_tool_runtime_invocation"] as const) {
      const entry = (SUBSTRATE_POSTURES.tables ?? []).find((t) => t.name === table);
      expect(entry, `substrate posture entry for ${table}`).toBeDefined();
      expect(entry?.posture).toBe("zero-policy");
    }
    expect(SUBSTRATE_POSTURES.batteryExpectations?.zeroPolicyTables).toEqual(
      expect.arrayContaining(["cg_tool_runtime_tool", "cg_tool_runtime_invocation"]),
    );
  });

  it("the transport posture JSON declares transport_buses policy-backed (T-D 20261003000041), superseding the H2-03 zero-policy era", () => {
    const entry = (TRANSPORT_POSTURES.tables ?? []).find((t) => t.name === "transport_buses");
    expect(entry).toBeDefined();
    expect(entry?.posture).toBe("policy-backed");
    // Provenance chain: the substrate-era zero-policy normalization (H2-03)
    // and the T-D policy migration that supersedes it for the driver read.
    expect(entry?.normalizedBy).toBe(
      "database/supabase/migrations/20261002000014_coregrid_v2_transport_buses_rls.sql",
    );
    expect(entry?.policyBackedBy).toBe(
      "database/supabase/migrations/20261003000041_coregrid_transport_bus_reads.sql",
    );
    expect(TRANSPORT_POSTURES.batteryExpectations?.policyBackedTables).toEqual([
      "transport_buses",
    ]);
    expect(TRANSPORT_POSTURES.batteryExpectations?.zeroPolicyTables ?? []).not.toContain(
      "transport_buses",
    );
  });

  it("the live canonical apply record proves the posture history and current state of all three tables (tool pair zero-policy; transport superseded → policy-backed by T-D 20261003000041)", () => {
    const recorded = new Map<string, string>();
    for (const row of CANONICAL_APPLY_RECORD.rlsPosture ?? []) {
      if (typeof row.table === "string" && typeof row.posture === "string") {
        recorded.set(row.table, row.posture);
      }
    }
    for (const table of ADJUDICATED_TABLES) {
      if (table === "transport_buses") {
        // Supersession (2026-10-03, T-D integration): the driver assigned-read
        // policy is APPLIED, so the live record truthfully shows the
        // policy-backed posture; the zero-policy era is proven by the
        // SUPERSEDED state of the normalization migration in the same record.
        expect(recorded.get(table), `canonical apply record for ${table}`).toBe(
          "policy-backed (declared policies)",
        );
        const supersededEntry = (CANONICAL_APPLY_RECORD.declaredVsApplied ?? []).find(
          (m) => typeof m.file === "string" && m.file.startsWith("20261002000014"),
        );
        expect(supersededEntry?.state).toBe("SUPERSEDED");
        expect(String(supersededEntry?.evidence ?? "")).toContain("20261003000041");
      } else {
        expect(recorded.get(table), `canonical apply record for ${table}`).toBe(
          "zero-policy (deny-by-default)",
        );
      }
    }
  });
});

/* ── 3. Decision docs are consistent with the evidence ──────────── */

describe("D-040 decision docs are internally consistent and adjudicate nothing applied", () => {
  it.each(ADJUDICATED_TABLES)("the decision doc for %s exists, names the table, and adjudicates zero-policy", (table) => {
    const doc = readFileSync(join(ROOT, DECISION_DOC_PATHS[table]), "utf8");
    expect(doc).toContain(table);
    expect(doc).toContain("Zero-policy by design — CONFIRMED for V1");
    expect(doc).toContain("nothing applied by this mission");
    for (const section of ["OWNERSHIP", "EVIDENCE", "DECISION", "RATIONALE", "CONSTITUTION SECTIONS", "PROPOSED-POLICY-IF-ANY"]) {
      expect(doc).toContain(`## ${section}`);
    }
  });

  it.each(ADJUDICATED_TABLES)("no decision doc for %s authors a CREATE POLICY (apply-nothing law)", (table) => {
    const doc = readFileSync(join(ROOT, DECISION_DOC_PATHS[table]), "utf8");
    expect(doc).not.toMatch(/CREATE POLICY/);
    expect(doc).not.toMatch(/this mission (authored|applies|author)/);
  });

  it("the tool-runtime docs cite the service-role adapter as the owning server path", () => {
    for (const table of ["cg_tool_runtime_tool", "cg_tool_runtime_invocation"] as const) {
      const doc = readFileSync(join(ROOT, DECISION_DOC_PATHS[table]), "utf8");
      expect(doc).toContain("frontend/src/lib/adapters/tool-runtime-store.adapter.ts");
      expect(doc).toContain("20261002000012_coregrid_v1_tool_runtime.sql");
    }
  });

  it("the transport_buses doc cites the owning server paths and the posture-selection law", () => {
    const doc = readFileSync(join(ROOT, DECISION_DOC_PATHS.transport_buses), "utf8");
    expect(doc).toContain("frontend/src/lib/runtime/scholar/driver-portal.functions.ts");
    expect(doc).toContain("frontend/src/lib/runtime/scholar/bus-tracking.functions.ts");
    expect(doc).toContain("frontend/src/lib/runtime/scholar/demo-provision.functions.ts");
    expect(doc).toContain("RULING-2");
  });

  it("the tool-runtime invocation doc records the §21 AI-proposal rationale and the append-only audit law", () => {
    const doc = readFileSync(join(ROOT, DECISION_DOC_PATHS.cg_tool_runtime_invocation), "utf8");
    expect(doc).toContain("§21");
    expect(doc).toContain("append-only audit ledger");
  });
});