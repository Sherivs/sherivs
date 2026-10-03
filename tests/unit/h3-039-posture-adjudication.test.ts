/**
 * CoreGrid — MISSION H3-039: RLS posture adjudication for the knowledge-currency
 * governance tables (Squad D, knowledge family).
 *
 * Asserts the internal consistency of H3-039's decisions — that the adjudicated
 * zero-policy posture in the decision docs is exactly what the repository
 * declares. OFFLINE and READ-ONLY: no database, no network, no writes; the
 * posture JSON files and the battery script are consumed read-only via fs
 * (their ownership belongs to other teams — campaign law §3):
 *
 *  1. tables exist in the creating migration 20261002000011
 *     (CREATE TABLE, tenant column, composite-FK same-tenant law);
 *  2. the migration's access posture is zero-policy deny-by-default
 *     (RLS ENABLED, all anon/authenticated privileges revoked, ZERO
 *     CREATE POLICY statements anywhere in the migration);
 *  3. the declarative posture registry (scripts/verification/
 *     rls-table-postures-*.json) scopes each table as a zero-policy entry —
 *     posture "zero-policy", no policies, no FORCE expectation, source
 *     migration provenance, and exactly one declaration per table (the
 *     battery's single-source-of-truth law, resolvePostureRegistry);
 *  4. the substrate posture file's batteryExpectations lists all three in
 *     zeroPolicyTables (they are battery-scoped, not just file-scoped);
 *  5. each decision doc exists with the required structured sections and a
 *     zero-policy-by-design DECISION — docs and repository agree.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

const MIGRATION_PATH =
  "database/supabase/migrations/20261002000011_coregrid_v1_knowledge_currency.sql";
const SUBSTRATE_POSTURES_PATH =
  "scripts/verification/rls-table-postures-substrate.json";
const TRANSPORT_POSTURES_PATH =
  "scripts/verification/rls-table-postures-transport.json";

const ADJUDICATED_TABLES = [
  "cg_knowledge_freshness_contract",
  "cg_knowledge_invalidation",
  "cg_knowledge_downgrade",
] as const;

interface PostureEntry {
  name?: string;
  table?: string;
  posture: string;
  source?: string;
  policies?: unknown;
  forceRls?: boolean;
  rationale?: string;
  [key: string]: unknown;
}

interface PostureFile {
  tables?: PostureEntry[];
  postures?: PostureEntry[];
  batteryExpectations?: {
    zeroPolicyTables?: string[];
    policyBackedTables?: string[];
  };
  [key: string]: unknown;
}

const MIGRATION = readFileSync(join(ROOT, MIGRATION_PATH), "utf8");
const SUBSTRATE_POSTURES = JSON.parse(
  readFileSync(join(ROOT, SUBSTRATE_POSTURES_PATH), "utf8"),
) as PostureFile;
const TRANSPORT_POSTURES = JSON.parse(
  readFileSync(join(ROOT, TRANSPORT_POSTURES_PATH), "utf8"),
) as PostureFile;

function entriesOf(file: PostureFile): PostureEntry[] {
  return [...(file.tables ?? []), ...(file.postures ?? [])];
}

function nameOf(entry: PostureEntry): string | undefined {
  return entry.table ?? entry.name;
}

/** Registry law (battery resolvePostureRegistry): files in sorted order; a
 * table declared in an earlier file overrides later declarations, and a
 * duplicate within one file is invalid. Files are consumed sorted by name
 * (loadPostureRegistry), so substrate < transport alphabetically. */
function resolveRegistry(
  files: Array<{ name: string; file: PostureFile }>,
): Map<string, { entry: PostureEntry; sourceFile: string }> {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
  const resolved = new Map<string, { entry: PostureEntry; sourceFile: string }>();
  for (const { name, file } of sorted) {
    const seenInFile = new Set<string>();
    for (const entry of entriesOf(file)) {
      const table = nameOf(entry);
      if (table == null) throw new Error(`posture entry without table name in ${name}`);
      if (seenInFile.has(table) || resolved.has(table)) {
        throw new Error(`table ${table} declared more than once — single source of truth violated`);
      }
      seenInFile.add(table);
      resolved.set(table, { entry, sourceFile: name });
    }
  }
  return resolved;
}

const REGISTRY = resolveRegistry([
  { name: SUBSTRATE_POSTURES_PATH, file: SUBSTRATE_POSTURES },
  { name: TRANSPORT_POSTURES_PATH, file: TRANSPORT_POSTURES },
]);

describe("H3-039 posture adjudication — knowledge-currency governance tables", () => {
  it("adjudicates exactly the three mission tables", () => {
    expect([...ADJUDICATED_TABLES]).toEqual([
      "cg_knowledge_freshness_contract",
      "cg_knowledge_invalidation",
      "cg_knowledge_downgrade",
    ]);
  });

  it("tables exist in the creating migration 20261002000011", () => {
    for (const table of ADJUDICATED_TABLES) {
      expect(
        MIGRATION,
        `${table} must be created by 20261002000011_coregrid_v1_knowledge_currency.sql`,
      ).toContain(`CREATE TABLE IF NOT EXISTS public.${table} (`);

      const createBlock = MIGRATION.slice(
        MIGRATION.indexOf(`CREATE TABLE IF NOT EXISTS public.${table} (`),
        MIGRATION.indexOf(");", MIGRATION.indexOf(`CREATE TABLE IF NOT EXISTS public.${table} (`)),
      );
      expect(createBlock, `${table} must carry the tenant column`).toContain("tenant_id");

      const commentBlock = MIGRATION.slice(
        MIGRATION.indexOf(`COMMENT ON TABLE public.${table} IS`),
        MIGRATION.indexOf("$comment$;", MIGRATION.indexOf(`COMMENT ON TABLE public.${table} IS`)),
      );
      expect(
        commentBlock,
        `${table} must pin J-019 / V1CAP-040 provenance in its table comment`,
      ).toContain("J-019 / V1CAP-040");
    }
  });

  it("tables are bound same-tenant by composite FKs in the migration", () => {
    expect(MIGRATION).toContain(
      "CONSTRAINT cg_knowledge_freshness_contract_source_fk",
    );
    expect(MIGRATION).toContain(
      "CONSTRAINT cg_knowledge_invalidation_contract_fk",
    );
    expect(MIGRATION).toContain(
      "CONSTRAINT cg_knowledge_downgrade_source_fk",
    );
    expect(MIGRATION.match(/REFERENCES public\.\w+ \(id, tenant_id\)/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("migration access posture is zero-policy deny-by-default (RLS enabled, revoked, zero policies)", () => {
    for (const table of ADJUDICATED_TABLES) {
      expect(MIGRATION).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`);
      expect(MIGRATION).toContain(`REVOKE ALL ON public.${table} FROM anon, authenticated;`);
    }
    expect(MIGRATION, "zero policies IS the posture — no CREATE POLICY may exist").not.toMatch(
      /CREATE POLICY/i,
    );
    expect(MIGRATION).toContain("RLS ENABLED with ZERO policies");
  });

  it("battery scope contains each table as a zero-policy entry", () => {
    for (const table of ADJUDICATED_TABLES) {
      const resolved = REGISTRY.get(table);
      expect(resolved, `${table} must be declared in the posture registry`).toBeDefined();
      if (resolved == null) continue;

      expect(resolved.sourceFile).toBe(SUBSTRATE_POSTURES_PATH);
      expect(resolved.entry.posture, `${table} posture`).toBe("zero-policy");
      expect(
        resolved.entry.policies,
        `${table}: zero-policy entries must declare no policies`,
      ).toBeUndefined();
      expect(
        resolved.entry.forceRls,
        `${table}: FORCE cannot strengthen a no-policy posture`,
      ).not.toBe(true);
      expect(resolved.entry.source, `${table} source provenance`).toBe(
        "20261002000011_coregrid_v1_knowledge_currency.sql",
      );
    }
  });

  it("no posture file declares a policy-backed posture for these tables", () => {
    for (const { name, file } of [
      { name: SUBSTRATE_POSTURES_PATH, file: SUBSTRATE_POSTURES },
      { name: TRANSPORT_POSTURES_PATH, file: TRANSPORT_POSTURES },
    ]) {
      for (const entry of entriesOf(file)) {
        if (ADJUDICATED_TABLES.includes(nameOf(entry) as (typeof ADJUDICATED_TABLES)[number])) {
          expect(entry.posture, `${nameOf(entry)} in ${name}`).toBe("zero-policy");
        }
      }
    }
  });

  it("substrate batteryExpectations scopes all three tables as zero-policy", () => {
    const expectations = SUBSTRATE_POSTURES.batteryExpectations;
    expect(expectations).toBeDefined();
    expect(expectations?.zeroPolicyTables).toBeDefined();
    for (const table of ADJUDICATED_TABLES) {
      expect(
        expectations?.zeroPolicyTables,
        `${table} must be battery-scoped zero-policy`,
      ).toContain(table);
      expect(
        expectations?.policyBackedTables,
        `${table} must NOT be a policy-backed expectation`,
      ).not.toContain(table);
    }
  });

  it("each decision doc exists, is structured, and decides zero-policy-by-design", () => {
    for (const table of ADJUDICATED_TABLES) {
      const doc = readFileSync(
        join(ROOT, "architecture/campaigns/h3/posture-adjudication", `${table}.md`),
        "utf8",
      );
      for (const section of [
        "## OWNERSHIP",
        "## EVIDENCE",
        "## DECISION",
        "## RATIONALE",
        "## CONSTITUTION SECTIONS",
        "## PROPOSED-POLICY-IF-ANY",
      ]) {
        expect(doc, `${table}.md must carry section ${section}`).toContain(section);
      }
      expect(doc, `${table}.md must cite the creating migration`).toContain(
        "20261002000011_coregrid_v1_knowledge_currency.sql",
      );
      expect(doc, `${table}.md decision must be zero-policy-by-design`).toContain(
        "ZERO-POLICY-BY-DESIGN",
      );
      expect(doc, `${table}.md must record that nothing was applied`).toContain(
        "nothing is applied",
      );
      expect(doc, `${table}.md must cite Constitution §9 canonical-truth boundary`).toContain("§9");
    }
  });

  it("no decision doc proposes an applied change — proposals are PROPOSED only", () => {
    for (const table of ADJUDICATED_TABLES) {
      const doc = readFileSync(
        join(ROOT, "architecture/campaigns/h3/posture-adjudication", `${table}.md`),
        "utf8",
      );
      expect(doc).toContain("None applied");
      expect(doc).not.toMatch(/^APPROVED|migrations? applied|policy authored and applied/im);
    }
  });
});