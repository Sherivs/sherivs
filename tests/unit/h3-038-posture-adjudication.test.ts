/**
 * CoreGrid — MISSION H3-038 (Squad D): zero-policy posture adjudication for
 * the provenance/usage family:
 *
 *   - cg_reasoning_provenance_snapshot  (migration 20261002000009)
 *   - cg_usage_attribution_rollup       (migration 20261002000010)
 *   - cg_knowledge_source               (migration 20261002000011)
 *
 * OFFLINE internal-consistency suite for the decision docs under
 * architecture/campaigns/h3/posture-adjudication/. READ-ONLY throughout: it
 * reads migration SQL, the declarative posture JSON files, the owning adapter
 * sources and the decision docs from disk; it imports the battery's exported
 * pure registry loader (which performs repo-file I/O only — no network, no
 * credentials, no database, never exits at import time). Asserts:
 *
 *  1. every adjudicated table is created by exactly its cited migration, with
 *     the deny-by-default SQL posture (RLS enabled, zero CREATE POLICY,
 *     REVOKE ALL from anon + authenticated);
 *  2. the battery's resolved posture registry (posture JSON files merged over
 *     the built-in canonical posture) scopes each table exactly once as
 *     ZERO-POLICY with zero expected policies, forceRls=false, and the cited
 *     source migration;
 *  3. each table's owning adapter names the table and is service-role-only
 *     (no policy-bearing client accepted — the zero-policy rationale);
 *  4. each decision doc exists, carries the required structured sections
 *     (OWNERSHIP / EVIDENCE / DECISION / RATIONALE / CONSTITUTION SECTIONS /
 *     PROPOSED-POLICY-IF-ANY), cites its migration and adapter, and
 *     adjudicates zero-policy-by-design with no policy proposed;
 *  5. the H2-04 policy migration (20261002000015) lists all three tables as
 *     explicitly UNCHANGED — the zero-policy posture survived the policy wave;
 *  6. no policy of any kind names any of the three tables anywhere in the
 *     shipped migrations (zero policies IS the posture).
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MIGRATIONS_DIR = "database/supabase/migrations";
const POSTURES_DIR = join(ROOT, "scripts", "verification");
const DOCS_DIR = "architecture/campaigns/h3/posture-adjudication";

interface AdjudicatedTable {
  readonly table: string;
  readonly migration: string;
  readonly adapter: string;
  readonly decisionDoc: string;
}

const ADJUDICATED: readonly AdjudicatedTable[] = [
  {
    table: "cg_reasoning_provenance_snapshot",
    migration: "20261002000009_coregrid_v1_reasoning_provenance.sql",
    adapter: "frontend/src/lib/adapters/reasoning-provenance-store.adapter.ts",
    decisionDoc: "cg_reasoning_provenance_snapshot.md",
  },
  {
    table: "cg_usage_attribution_rollup",
    migration: "20261002000010_coregrid_v1_cost_attribution.sql",
    adapter: "frontend/src/lib/adapters/cost-attribution-store.adapter.ts",
    decisionDoc: "cg_usage_attribution_rollup.md",
  },
  {
    table: "cg_knowledge_source",
    migration: "20261002000011_coregrid_v1_knowledge_currency.sql",
    adapter: "frontend/src/lib/adapters/knowledge-currency-store.adapter.ts",
    decisionDoc: "cg_knowledge_source.md",
  },
] as const;

const POLICY_MIGRATION = "20261002000015_coregrid_v1_substrate_policies.sql";

const read = (relativePath: string): string =>
  readFileSync(join(ROOT, relativePath), "utf8");

const adapterSrc = new Map<string, string>(
  ADJUDICATED.map((t) => [t.table, read(t.adapter)]),
);
const docSrc = new Map<string, string>(
  ADJUDICATED.map((t) => [t.table, read(join(DOCS_DIR, t.decisionDoc))]),
);
const policyMigrationSrc = read(join(MIGRATIONS_DIR, POLICY_MIGRATION));

const REQUIRED_DOC_SECTIONS = [
  "## OWNERSHIP",
  "## EVIDENCE",
  "## DECISION",
  "## RATIONALE",
  "## CONSTITUTION SECTIONS",
  "## PROPOSED-POLICY-IF-ANY",
] as const;

describe("H3-038 posture adjudication — migration grounding", () => {
  for (const { table, migration } of ADJUDICATED) {
    it(`${table} is created by its cited migration with the deny-by-default SQL posture`, () => {
      const sql = read(join(MIGRATIONS_DIR, migration));

      // (a) the table exists in the migration it is attributed to
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS public.${table}`);

      // (b) RLS is enabled on it
      expect(sql).toContain(
        `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`,
      );

      // (c) anon/authenticated hold no privileges
      expect(sql).toContain(
        `REVOKE ALL ON public.${table} FROM anon, authenticated`,
      );

      // (d) zero policies are authored for it in ANY shipped migration
      //     (zero policies IS the posture)
      for (const file of readdirSync(join(ROOT, MIGRATIONS_DIR))) {
        const migrationSql = read(join(MIGRATIONS_DIR, file));
        expect(
          policyHasTable(migrationSql, table),
          `migration ${file} must not author any policy on ${table}`,
        ).toBe(false);
      }
    });
  }
});

// A CREATE POLICY in `sql` whose ON-clause names `table` (public.<table>).
function policyHasTable(sql: string, table: string): boolean {
  const re = /CREATE POLICY\s+\S+\s+ON\s+public\.([a-z_][a-z0-9_]*)/g;
  for (const [, onTable] of sql.matchAll(re)) {
    if (onTable === table) return true;
  }
  return false;
}

/** Shape of the battery's resolved posture registry (plain-JS module; declared here). */
interface BatteryRegistryEntry {
  name: string;
  posture: string;
  policies: string[];
  forceRls: boolean;
  source: string;
  postureSource: string;
}

interface BatteryRegistry {
  tables: BatteryRegistryEntry[];
}

describe("H3-038 posture adjudication — battery scope (declarative posture registry)", () => {
  it("the resolved battery registry scopes each table exactly once as zero-policy with its cited source migration", async () => {
    // @ts-expect-error — plain-JS verification script without type declarations (read-only module import; same pattern as tests/unit/mh-05-battery-postures.test.ts)
    const batteryModule = await import("../../scripts/verify-rls-isolation-battery.mjs");
    const registry = (
      batteryModule as unknown as { loadPostureRegistry: (dir: string) => BatteryRegistry }
    ).loadPostureRegistry(POSTURES_DIR);

    for (const { table, migration } of ADJUDICATED) {
      const entries = registry.tables.filter((t) => t.name === table);
      expect(entries, `${table} must appear exactly once in the battery scope`).toHaveLength(1);

      const entry = entries[0];
      expect(entry.posture, `${table} battery posture`).toBe("zero-policy");
      expect(entry.policies, `${table} must expect zero policies`).toHaveLength(0);
      expect(entry.forceRls, `${table} must not expect FORCE RLS`).toBe(false);
      expect(entry.source, `${table} source migration provenance`).toBe(migration);
      expect(entry.postureSource, `${table} declared by a posture file`).toBe(
        "rls-table-postures-substrate.json",
      );
    }
  });

  it("the posture JSON files declare each table zero-policy with a non-empty rationale and no force flag", () => {
    const raw = readFileSync(
      join(POSTURES_DIR, "rls-table-postures-substrate.json"),
      "utf8",
    );
    const parsed: unknown = JSON.parse(raw);
    expect(parsed).toBeInstanceOf(Object);
    const tables = (parsed as { tables: unknown }).tables;
    expect(Array.isArray(tables)).toBe(true);

    for (const { table } of ADJUDICATED) {
      const entries = (tables as Array<Record<string, unknown>>).filter(
        (e) => (e["name"] ?? e["table"]) === table,
      );
      expect(entries, `${table} declared exactly once in the posture file`).toHaveLength(1);

      const entry = entries[0];
      expect(entry["posture"]).toBe("zero-policy");
      expect(entry["policies"] === undefined || entry["policies"] === null).toBe(true);
      expect(entry["forceRls"] === undefined || entry["forceRls"] === false).toBe(true);
      expect(typeof entry["rationale"]).toBe("string");
      expect((entry["rationale"] as string).length).toBeGreaterThan(0);
    }
  });
});

describe("H3-038 posture adjudication — owning server paths", () => {
  for (const { table, adapter } of ADJUDICATED) {
    it(`${adapter} names ${table} and accepts only a service-role client`, () => {
      const src = adapterSrc.get(table) ?? "";

      expect(src).toContain(`"${table}"`);

      // Service-role-only law: the adapter documents the zero-policy posture
      // it depends on and accepts no policy-bearing client.
      expect(src.toLowerCase()).toContain("service-role");
      expect(src.toLowerCase()).toContain("zero-policy");
      expect(src).toContain("ON CONFLICT DO NOTHING");
      expect(src).not.toMatch(/\b(UPDATE|DELETE)\b\s+FROM\s+public\./i);
    });
  }
});

describe("H3-038 posture adjudication — decision docs", () => {
  for (const { table, migration, adapter } of ADJUDICATED) {
    it(`${table}.md adjudicates zero-policy-by-design with the required structure`, () => {
      const doc = docSrc.get(table) ?? "";

      for (const section of REQUIRED_DOC_SECTIONS) {
        expect(doc, `decision doc must contain ${section}`).toContain(section);
      }

      // The decision itself
      expect(doc).toMatch(/ZERO-POLICY-BY-DESIGN/);
      expect(doc).toContain("**None.**");

      // Cited evidence: migration + adapter + battery posture
      expect(doc).toContain(migration);
      expect(doc).toContain(adapter);
      expect(doc).toContain("zero-policy");
      expect(doc).toContain(POLICY_MIGRATION);
    });
  }
});

describe("H3-038 posture adjudication — policy-wave survival", () => {
  it("the H2-04 policy migration leaves all three tables explicitly unchanged", () => {
    for (const { table } of ADJUDICATED) {
      expect(
        policyMigrationSrc.includes(table),
        `${table} must be listed as unchanged in ${POLICY_MIGRATION}`,
      ).toBe(true);
      expect(
        policyHasTable(policyMigrationSrc, table),
        `${POLICY_MIGRATION} must not author any policy on ${table}`,
      ).toBe(false);
      expect(
        policyMigrationSrc.includes(
          `GRANT ALL ON public.${table}`,
        ),
        `${POLICY_MIGRATION} must not grant on ${table}`,
      ).toBe(false);
    }
  });
});
