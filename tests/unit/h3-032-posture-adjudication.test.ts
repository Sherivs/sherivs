/**
 * CoreGrid — H3-032 Posture Adjudication Engineer (Squad D, mission D-032).
 *
 * Internal-consistency proof for the three tables adjudicated by this team:
 * `cg_observation`, `cg_workspace`, `cg_workspace_member`. The suite asserts
 * that the decision docs, the defining migrations, and the RLS isolation
 * battery's declarative posture registry all agree on the adjudicated
 * ZERO-POLICY-BY-DESIGN posture. Invariants under test:
 *
 * - each adjudicated table is created by exactly the migration its decision
 *   doc cites, and that migration ENABLEs RLS on it and REVOKEs all client
 *   privileges (anon, authenticated) — the database-level deny-by-default
 *   substrate the adjudication rests on (Constitution §17, §28);
 * - the battery's built-in canonical posture registry scopes all three
 *   tables as zero-policy, sourced from those same migrations, with zero
 *   declared policies;
 * - no rls-table-postures-*.json file overrides the posture (a security
 *   posture must have exactly one source of truth — the merged registry
 *   resolves them as builtin-canonical zero-policy entries);
 * - the merged registry (posture files applied over the built-in list)
 *   keeps all three tables zero-policy — the posture JSONs never re-grade
 *   an adjudicated table;
 * - every decision doc exists and carries the mission's required structure
 *   (OWNERSHIP / EVIDENCE / DECISION / RATIONALE / CONSTITUTION SECTIONS /
 *   PROPOSED-POLICY-IF-ANY) and adjudicates ZERO-POLICY-BY-DESIGN.
 *
 * READ-ONLY: the battery module is imported (importing performs no I/O and
 * never exits), the posture JSON files and migrations are read via fs, and
 * nothing is written, executed against a database, or fetched. Offline by
 * construction — no credentials, no network.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error — plain-JS verification script without type declarations imported into the TS unit suite (read-only module import; same pattern as tests/unit/mh-05-battery-postures.test.ts)
import * as batteryMjs from "../../scripts/verify-rls-isolation-battery.mjs";

interface BatteryPostureEntry {
  name: string;
  posture?: string;
  source?: string;
  policies?: string[];
}

interface BatteryModule {
  BUILTIN_TABLE_POSTURES: BatteryPostureEntry[];
  parsePostureFile: (contents: string, fileName: string) => unknown[];
  resolvePostureRegistry: (files: Array<{ name: string; entries: unknown[] }>) => unknown;
}

const battery = batteryMjs as unknown as BatteryModule;

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

const ADJUDICATED_TABLES = ["cg_observation", "cg_workspace", "cg_workspace_member"] as const;

type AdjudicatedTable = (typeof ADJUDICATED_TABLES)[number];

// The defining migrations, exactly as cited in each table's decision doc.
const DEFINING_MIGRATIONS: Record<AdjudicatedTable, string> = {
  cg_observation: "20260903000000_coregrid_universal_kernel_substrate.sql",
  cg_workspace: "20260930000000_coregrid_v1_workspace_persistence.sql",
  cg_workspace_member: "20260930000000_coregrid_v1_workspace_persistence.sql",
};

const DECISION_DOCS: Record<AdjudicatedTable, string> = {
  cg_observation: "cg_observation.md",
  cg_workspace: "cg_workspace.md",
  cg_workspace_member: "cg_workspace_member.md",
};

const REQUIRED_DOC_SECTIONS = [
  "## OWNERSHIP",
  "## EVIDENCE",
  "## DECISION",
  "## RATIONALE",
  "## CONSTITUTION SECTIONS",
  "## PROPOSED-POLICY-IF-ANY",
] as const;

const readRepoFile = (relativePath: string): string =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const migrationPath = (fileName: string) => `database/supabase/migrations/${fileName}`;

// The two landed sibling posture files (H2-03/H2-04), in the battery's own
// lexical merge order for the current tree.
const POSTURE_FILES = [
  "rls-table-postures-substrate.json",
  "rls-table-postures-transport.json",
] as const;

describe("H3-032 posture adjudication — internal consistency (D-032)", () => {
  it("every adjudicated table exists in its cited defining migration with RLS enabled and zero client privileges", () => {
    for (const table of ADJUDICATED_TABLES) {
      const migrationSql = readRepoFile(migrationPath(DEFINING_MIGRATIONS[table]));

      expect(
        migrationSql.includes(`CREATE TABLE IF NOT EXISTS public.${table} (`),
        `${table}: CREATE TABLE missing from ${DEFINING_MIGRATIONS[table]}`,
      ).toBe(true);

      expect(
        new RegExp(
          `ALTER TABLE public\\.${table}\\s+ENABLE ROW LEVEL SECURITY;`,
        ).test(migrationSql),
        `${table}: ENABLE ROW LEVEL SECURITY missing from ${DEFINING_MIGRATIONS[table]}`,
      ).toBe(true);

      // The substrate migration revokes via a multi-table list
      // ("REVOKE ALL ON TABLE public.cg_entity, ..., public.cg_observation, ... FROM anon, authenticated"),
      // so the assertion is statement-level: the table is named in a REVOKE
      // ALL statement that ends "FROM anon, authenticated".
      expect(
        new RegExp(
          `REVOKE ALL ON (TABLE )?[^;]*public\\.${table}[^;]*FROM\\s+anon,\\s*authenticated;`,
        ).test(migrationSql),
        `${table}: REVOKE ALL from anon/authenticated missing from ${DEFINING_MIGRATIONS[table]}`,
      ).toBe(true);
    }
  });

  it("no defining migration authors any policy for an adjudicated table (zero policies IS the posture)", () => {
    for (const table of ADJUDICATED_TABLES) {
      const migrationSql = readRepoFile(migrationPath(DEFINING_MIGRATIONS[table]));
      expect(migrationSql.includes("CREATE POLICY"), `${table}: unexpected CREATE POLICY in its defining migration`).toBe(false);
    }
  });

  it("the battery's built-in canonical posture scopes all three tables as zero-policy from the cited migrations", () => {
    for (const table of ADJUDICATED_TABLES) {
      const entry = battery.BUILTIN_TABLE_POSTURES.find(
        (t: { name: string }) => t.name === table,
      );
      expect(entry, `${table}: missing from BUILTIN_TABLE_POSTURES`).toBeDefined();
      expect(entry?.posture).toBe("zero-policy");
      expect(entry?.source).toBe(DEFINING_MIGRATIONS[table]);
      expect(entry?.policies ?? []).toEqual([]);
    }
  });

  it("no posture JSON file overrides the adjudicated posture (single source of truth)", () => {
    for (const fileName of POSTURE_FILES) {
      const entries = battery.parsePostureFile(
        readRepoFile(`scripts/verification/${fileName}`),
        fileName,
      ) as Array<{ name?: string; table?: string }>;
      for (const entry of entries) {
        const name = entry.name ?? entry.table;
        expect(
          ADJUDICATED_TABLES.includes(name as AdjudicatedTable),
          `${fileName} declares ${String(name)} — the posture JSONs must not re-grade an H3-032-adjudicated table`,
        ).toBe(false);
      }
    }
  });

  it("the merged posture registry keeps all three tables zero-policy with builtin-canonical provenance", () => {
    const files = POSTURE_FILES.map((name) => ({
      name,
      entries: battery.parsePostureFile(readRepoFile(`scripts/verification/${name}`), name) as unknown[],
    }));
    const registry = battery.resolvePostureRegistry(files) as {
      tables: Array<{
        name: string;
        posture: string;
        postureSource: string;
        policies: string[];
      }>;
    };
    for (const table of ADJUDICATED_TABLES) {
      const entry = registry.tables.find((t) => t.name === table);
      expect(entry, `${table}: missing from merged registry`).toBeDefined();
      expect(entry?.posture).toBe("zero-policy");
      expect(entry?.postureSource).toBe("builtin-canonical");
      expect(entry?.policies ?? []).toEqual([]);
    }
  });

  it("each decision doc exists, carries the required structure, and adjudicates ZERO-POLICY-BY-DESIGN", () => {
    for (const table of ADJUDICATED_TABLES) {
      const doc = readRepoFile(`architecture/campaigns/h3/posture-adjudication/${DECISION_DOCS[table]}`);

      for (const section of REQUIRED_DOC_SECTIONS) {
        expect(doc.includes(section), `${DECISION_DOCS[table]}: missing required section ${section}`).toBe(true);
      }

      expect(doc.includes("ZERO-POLICY-BY-DESIGN"), `${DECISION_DOCS[table]}: decision is not ZERO-POLICY-BY-DESIGN`).toBe(true);
      expect(doc.includes(DEFINING_MIGRATIONS[table]), `${DECISION_DOCS[table]}: citing migration ${DEFINING_MIGRATIONS[table]} missing`).toBe(true);
      expect(doc.includes("H3-032"), `${DECISION_DOCS[table]}: team identity missing`).toBe(true);
      expect(doc.includes("D-032"), `${DECISION_DOCS[table]}: mission identity missing`).toBe(true);
    }
  });

  it("decision docs cite the battery evidence and never authorize an applied change", () => {
    for (const table of ADJUDICATED_TABLES) {
      const doc = readRepoFile(`architecture/campaigns/h3/posture-adjudication/${DECISION_DOCS[table]}`);

      expect(doc.includes("RLS_ISOLATION_BATTERY.md"), `${DECISION_DOCS[table]}: battery evidence citation missing`).toBe(true);
      expect(doc.includes("verify-rls-isolation-battery.mjs"), `${DECISION_DOCS[table]}: battery scope citation missing`).toBe(true);
      expect(/nothing is applied/i.test(doc), `${DECISION_DOCS[table]}: nothing-applied declaration missing`).toBe(true);
    }
  });
});
