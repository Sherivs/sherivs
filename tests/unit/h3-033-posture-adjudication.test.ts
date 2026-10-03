/**
 * H3-033 — Posture Adjudication (Squad D, D-033): internal-consistency suite
 * for the zero-policy-by-design adjudications of `cg_org_unit`,
 * `cg_worker_definition` and `cg_worker_capability`.
 *
 * All inputs are read-only: migration files, the battery script's exported
 * declarative posture registry (imported, never executed as a CLI), the two
 * posture-declaration JSON files (read via fs), the ratified battery report,
 * and the mission's own decision docs. No database, no network, no writes.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// @ts-expect-error — plain-JS verification script imported into the TS unit
// suite (read-only import of the exported declarative registry; same pattern
// as tests/unit/mh-05-battery-postures.test.ts).
import * as batteryMjs from "../../scripts/verify-rls-isolation-battery.mjs";

interface PostureEntry {
  name: string;
  source: string;
  posture: string;
}

interface BatteryModule {
  BUILTIN_TABLE_POSTURES: PostureEntry[];
}

const battery = batteryMjs as unknown as BatteryModule;

const repoRoot = join(import.meta.dirname, "..", "..");

const readRepoFile = (...segments: string[]): string =>
  readFileSync(join(repoRoot, ...segments), "utf8");

const ORG_MIGRATION = "database/supabase/migrations/20261001000000_coregrid_v1_org_model.sql";
const WORKER_MIGRATION =
  "database/supabase/migrations/20261002000002_coregrid_v1_worker_definitions.sql";
const POSTURE_JSONS = [
  "scripts/verification/rls-table-postures-substrate.json",
  "scripts/verification/rls-table-postures-transport.json",
] as const;

interface AdjudicatedTable {
  table: string;
  migration: string;
  doc: string;
}

/** The mission's three adjudications, as asserted by the decision docs. */
const ADJUDICATED: AdjudicatedTable[] = [
  { table: "cg_org_unit", migration: ORG_MIGRATION, doc: "cg_org_unit.md" },
  {
    table: "cg_worker_definition",
    migration: WORKER_MIGRATION,
    doc: "cg_worker_definition.md",
  },
  {
    table: "cg_worker_capability",
    migration: WORKER_MIGRATION,
    doc: "cg_worker_capability.md",
  },
];

const postureDir = "architecture/campaigns/h3/posture-adjudication";

describe("h3-033 posture adjudication — battery scope", () => {
  it("registers every adjudicated table in the declarative battery registry as zero-policy with its cited source migration", () => {
    for (const { table, migration } of ADJUDICATED) {
      const entry = battery.BUILTIN_TABLE_POSTURES.find((t) => t.name === table);
      expect(entry, `battery registry entry for ${table}`).toBeDefined();
      expect(entry?.posture).toBe("zero-policy");
      // The registry cites the source migration by bare filename.
      expect(entry?.source).toBe(migration.split("/").pop());
    }
  });

  it("does not let a posture-declaration JSON override or extend any adjudicated entry (the built-in zero-policy posture is operative)", () => {
    for (const jsonPath of POSTURE_JSONS) {
      const parsed: unknown = JSON.parse(readRepoFile(jsonPath));
      expect(parsed, `${jsonPath} shape`).toHaveProperty("tables");
      const tables = (parsed as { tables: { name: string }[] }).tables;
      for (const { table } of ADJUDICATED) {
        expect(
          tables.some((t) => t.name === table),
          `${jsonPath} must carry no ${table} entry`,
        ).toBe(false);
      }
    }
  });

  it("matches the ratified battery report: each adjudicated table is a zero-policy PASS row (RLS true, force false INFO, 0 policies)", () => {
    const report = readRepoFile(
      "architecture/coregrid-mvp-architecture/ratification/RLS_ISOLATION_BATTERY.md",
    );
    for (const { table } of ADJUDICATED) {
      const rowPattern = new RegExp(
        `\\| \`${table}\` \\| [^|]+ \\| zero-policy \\| true \\| false \\(INFO\\) \\| 0 \\| 401 / 42501 \\| \\*\\*PASS\\*\\* \\|`,
      );
      expect(report, `battery §7 row for ${table}`).toMatch(rowPattern);
    }
  });
});

describe("h3-033 posture adjudication — migrations", () => {
  it("authors every adjudicated table in its cited migration", () => {
    for (const { table, migration } of ADJUDICATED) {
      const sql = readRepoFile(migration);
      expect(sql, `${migration} creates ${table}`).toContain(
        `CREATE TABLE IF NOT EXISTS public.${table}`,
      );
    }
  });

  it("enables RLS and revokes all anon/authenticated privileges on every adjudicated table", () => {
    for (const { table, migration } of ADJUDICATED) {
      const sql = readRepoFile(migration);
      expect(sql, `${table} ENABLE ROW LEVEL SECURITY`).toContain(
        `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`,
      );
      expect(sql, `${table} privileges revoked`).toContain(
        `REVOKE ALL ON public.${table} FROM anon, authenticated;`,
      );
    }
  });

  it("authors zero policies and zero client grants in both cited migrations (zero-policy-by-design is exact, not assumed)", () => {
    for (const migration of [ORG_MIGRATION, WORKER_MIGRATION]) {
      const sql = readRepoFile(migration);
      expect(sql, `${migration} must contain no CREATE POLICY`).not.toMatch(
        /CREATE POLICY/i,
      );
      // Statement-level check only: SQL comments may legitimately use the
      // English word "grant" (e.g. "this table never grant authorization").
      expect(sql, `${migration} must contain no GRANT statement`).not.toMatch(
        /^\s*GRANT\s/im,
      );
    }
  });

  it("keeps the migrations authored-not-applied (adjudication of posture, never application)", () => {
    for (const migration of [ORG_MIGRATION, WORKER_MIGRATION]) {
      expect(readRepoFile(migration)).toMatch(/AUTHORED, NOT APPLIED/);
    }
  });

  it("provides a rollback for both cited migrations", () => {
    expect(readRepoFile("database/supabase/rollbacks/20261001000000_coregrid_v1_org_model.sql")).toContain(
      "DROP TABLE IF EXISTS public.cg_org_unit",
    );
    const workerRollback = readRepoFile(
      "database/supabase/rollbacks/20261002000002_coregrid_v1_worker_definitions.sql",
    );
    expect(workerRollback).toContain("DROP TABLE IF EXISTS public.cg_worker_definition");
    expect(workerRollback).toContain("DROP TABLE IF EXISTS public.cg_worker_capability");
  });

  it("enforces same-tenant integrity at the database level for the composite-FK tables", () => {
    expect(readRepoFile(ORG_MIGRATION)).toContain("cg_org_unit_parent_same_tenant_fk");
    expect(readRepoFile(WORKER_MIGRATION)).toContain("cg_worker_capability_definition_fk");
  });
});

describe("h3-033 posture adjudication — decision docs", () => {
  const REQUIRED_SECTIONS = [
    "OWNERSHIP",
    "EVIDENCE",
    "DECISION",
    "RATIONALE",
    "CONSTITUTION SECTIONS",
    "PROPOSED-POLICY-IF-ANY",
  ] as const;

  it("exists for every adjudicated table with the required structure", () => {
    for (const { table, doc } of ADJUDICATED) {
      const docText = readRepoFile(postureDir, doc);
      expect(docText, `${doc} names its table`).toContain(`\`${table}\``);
      for (const section of REQUIRED_SECTIONS) {
        expect(docText, `${doc} carries ${section}`).toContain(section);
      }
    }
  });

  it("adjudicates zero-policy-by-design in every decision doc", () => {
    for (const { doc } of ADJUDICATED) {
      expect(readRepoFile(postureDir, doc)).toMatch(/ZERO-POLICY-BY-DESIGN/);
    }
  });

  it("cites the battery registry line as evidence in each decision doc (doc ↔ registry consistency)", () => {
    for (const { table, doc, migration } of ADJUDICATED) {
      const docText = readRepoFile(postureDir, doc);
      expect(docText, `${doc} cites the battery registry entry for ${table}`).toContain(
        `name: "${table}"`,
      );
      expect(docText, `${doc} cites the source migration`).toContain(migration);
    }
  });

  it("cites the worker-contract ownership path in the worker-family decision docs", () => {
    for (const doc of ["cg_worker_definition.md", "cg_worker_capability.md"]) {
      const docText = readRepoFile(postureDir, doc);
      expect(docText).toContain("frontend/src/lib/workforce/worker-definition.ts");
      expect(docText).toContain("capability-registry.ts");
    }
  });

  it("cites team H3-016's FINDING-1 (delegation-history linkage unenforced at the claim boundary) in the cg_worker_definition doc", () => {
    const docText = readRepoFile(postureDir, "cg_worker_definition.md");
    expect(docText).toContain("FINDING-1");
    expect(docText).toContain("delegationHistoryRefs");
    expect(docText).toContain("progress/h3-wave/H3-016.report.md");
  });

  it("keeps every proposal strictly non-binding (nothing applied, no pre-authored policy text)", () => {
    for (const { doc } of ADJUDICATED) {
      const docText = readRepoFile(postureDir, doc);
      expect(docText).toMatch(/nothing applied/i);
      expect(docText).not.toMatch(/CREATE POLICY [a-z_]/i);
    }
  });
});