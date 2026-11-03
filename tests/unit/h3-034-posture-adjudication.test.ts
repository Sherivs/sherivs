/**
 * H3-034 — Posture Adjudication Engineer (Squad D, mission D-034).
 *
 * Internal-consistency proof for the three tables adjudicated by team H3-034:
 *   cg_worker_delegation, cg_memory_scope, cg_memory_record.
 *
 * What is proven (all read-only, fully offline — no database, no network,
 * no credentials, no writes):
 *  1. Each table EXISTS in its creating migration (`cg_worker_delegation` in
 *     20261002000002_coregrid_v1_worker_definitions.sql; the `cg_memory_*`
 *     pair in 20261002000004_coregrid_v1_memory_tier.sql) with the
 *     deny-by-default posture the adjudication relies on: ENABLE ROW LEVEL
 *     SECURITY + REVOKE ALL from anon/authenticated and ZERO authored
 *     policies.
 *  2. The RLS isolation battery's resolved declarative scope contains each
 *     table exactly once, as a zero-policy entry (policies=0, no force
 *     expectation, RLS-on implied), resolved from the built-in canonical
 *     posture merged with the two landed posture files
 *     (`scripts/verification/rls-table-postures-*.json` read via fs; the
 *     battery's exported pure functions perform no I/O beyond that read and
 *     never touch credentials, the network, or artifacts).
 *  3. Each H3-034 decision doc exists under
 *     `architecture/campaigns/h3/posture-adjudication/` and adjudicates
 *     ZERO-POLICY-BY-DESIGN with the required decision structure (OWNERSHIP /
 *     EVIDENCE / DECISION / RATIONALE / CONSTITUTION SECTIONS /
 *     PROPOSED-POLICY-IF-ANY).
 *  4. Cross-consistency: the migration source cited in each decision doc is
 *     the same source the battery registry reports for that table, and the
 *     owning server-path contract named in each doc exists on disk.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain-JS verification script without type declarations imported into the TS unit suite (read-only module import; same pattern as tests/unit/mh-05-battery-postures.test.ts)
import * as batteryMjs from "../../scripts/verify-rls-isolation-battery.mjs";

const battery = batteryMjs as unknown as {
  BUILTIN_TABLE_POSTURES: BatteryTableEntry[];
  loadPostureRegistry: (dir: string) => {
    tables: BatteryTableEntry[];
    files: string[];
    fallbackUsed: boolean;
  };
};

const root = join(import.meta.dirname, "..", "..");
const migrationsDir = join(root, "database", "supabase", "migrations");
const adjudicationDir = join(root, "architecture", "campaigns", "h3", "posture-adjudication");
const postureDir = join(root, "scripts", "verification");

// The three tables owned by mission D-034 (H3-WAVE-CAMPAIGN.md, Squad D).
const ADJUDICATED_TABLES = ["cg_worker_delegation", "cg_memory_scope", "cg_memory_record"] as const;

type AdjudicatedTable = (typeof ADJUDICATED_TABLES)[number];

// Migration provenance as adjudicated in the decision docs (and reported by
// the battery registry — asserted equal below).
const EXPECTED_SOURCE_MIGRATION: Record<AdjudicatedTable, string> = {
  cg_worker_delegation: "20261002000002_coregrid_v1_worker_definitions.sql",
  cg_memory_scope: "20261002000004_coregrid_v1_memory_tier.sql",
  cg_memory_record: "20261002000004_coregrid_v1_memory_tier.sql",
};

// Owning server-path contract per decision doc (must exist on disk).
const OWNING_SERVER_PATH: Record<AdjudicatedTable, string> = {
  cg_worker_delegation: "frontend/src/lib/workforce/worker-definition.ts",
  cg_memory_scope: "frontend/src/lib/memory/memory-store.ts",
  cg_memory_record: "frontend/src/lib/memory/memory-store.ts",
};

function readRepoFile(relativePath: string): string {
  return readFileSync(join(root, relativePath), "utf8");
}

function readMigration(migrationFileName: string): string {
  return readFileSync(join(migrationsDir, migrationFileName), "utf8");
}

// SQL header rationale wraps across `--` comment lines; strip comment
// prefixes and collapse whitespace so phrase assertions are line-wrap-proof.
// Only used for matching — the raw file is never modified.
function normalizeSqlText(sql: string): string {
  return sql.replace(/--/g, " ").replace(/\s+/g, " ");
}

type BatteryTableEntry = {
  name: string;
  source: string;
  posture: string;
  forceRls?: boolean;
  policies?: string[];
  postureSource?: string;
};

function batteryTableEntry(
  registry: { tables: BatteryTableEntry[] },
  table: AdjudicatedTable,
): BatteryTableEntry {
  const entries = registry.tables.filter((t) => t.name === table);
  expect(
    entries.length,
    `battery scope must contain ${table} exactly once (a security posture has exactly one source of truth)`,
  ).toBe(1);
  return entries[0]!;
}

describe("H3-034 posture adjudication (mission D-034) — internal consistency", () => {
  describe("1. migrations create the adjudicated tables with the deny-by-default posture", () => {
    for (const table of ADJUDICATED_TABLES) {
      it(`${table} exists in its creating migration with RLS enabled, zero policies, and no client grants`, () => {
        const migration = readMigration(EXPECTED_SOURCE_MIGRATION[table]);

        // (a) the table is actually created by this migration
        expect(migration).toContain(`CREATE TABLE IF NOT EXISTS public.${table} (`);

        // (b) RLS is enabled for the table
        expect(migration).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`);

        // (c) no client role holds any privilege (the REVOKE half of the posture)
        expect(migration).toContain(`REVOKE ALL ON public.${table} FROM anon, authenticated;`);
      });
    }

    it("the worker-definitions migration authors ZERO policies (adjudicated rationale is the migration's own law)", () => {
      const migration = normalizeSqlText(
        readMigration(EXPECTED_SOURCE_MIGRATION.cg_worker_delegation),
      );
      expect(migration).not.toMatch(/CREATE\s+POLICY/i);
      expect(migration).toMatch(/Zero policies are deliberate/i);
      expect(migration).toMatch(
        /no tenant-scoped policy exists yet that provably cannot widen worker authority/i,
      );
    });

    it("the memory-tier migration authors ZERO policies (AGENTS §17/§19 + L-T-015 rationale is the migration's own law)", () => {
      const migration = normalizeSqlText(readMigration(EXPECTED_SOURCE_MIGRATION.cg_memory_scope));
      expect(migration).not.toMatch(/CREATE\s+POLICY/i);
      expect(migration).toMatch(/Zero policies are deliberate/i);
      expect(migration).toMatch(/memory is tenant-sensitive platform data/i);
      expect(migration).toMatch(
        /no tenant-scoped policy exists yet that provably cannot widen retrieval beyond the declared scope/i,
      );
      // Non-vector-only law (G-015/J-017): no embedding/vector/similarity column.
      expect(migration).toMatch(/DELIBERATELY NO embedding, vector, or similarity column/i);
    });
  });

  describe("2. the RLS isolation battery scopes each table as zero-policy", () => {
    // Read-only offline resolution of the declarative posture registry:
    // built-in canonical posture merged with the landed posture files.
    const registry = battery.loadPostureRegistry(postureDir);

    it("the posture registry resolves offline from the landed posture files plus the built-in canonical posture", () => {
      expect(registry.fallbackUsed).toBe(false);
      expect(registry.files).toEqual([
        "rls-table-postures-mission-lease.json",
        "rls-table-postures-r-wave.json",
        "rls-table-postures-substrate.json",
        "rls-table-postures-transport.json",
      ]);
      expect(registry.tables.length).toBeGreaterThanOrEqual(battery.BUILTIN_TABLE_POSTURES.length);
    });

    for (const table of ADJUDICATED_TABLES) {
      it(`${table} is a zero-policy battery-scope entry backed by its adjudicated source migration`, () => {
        const entry = batteryTableEntry(registry, table);

        expect(entry.posture).toBe("zero-policy");
        // Zero policies IS the posture — no policy names may be declared.
        expect(entry.policies ?? []).toEqual([]);
        // FORCE cannot strengthen a no-policy posture.
        expect(entry.forceRls ?? false).toBe(false);
        // Provenance: the battery's source must equal the migration the
        // decision doc cites (single source of truth across artifacts).
        expect(entry.source).toBe(EXPECTED_SOURCE_MIGRATION[table]);
      });
    }

    it("neither landed posture file overrides the adjudicated tables (built-in canonical entry stays authoritative)", () => {
      for (const table of ADJUDICATED_TABLES) {
        const entry = batteryTableEntry(registry, table);
        expect(entry.postureSource).toBe("builtin-canonical");
      }
    });

    it("the built-in canonical posture declares each adjudicated table zero-policy with its migration provenance", () => {
      for (const table of ADJUDICATED_TABLES) {
        const builtin = battery.BUILTIN_TABLE_POSTURES.filter((t) => t.name === table);
        expect(builtin.length).toBe(1);
        expect(builtin[0]!.posture).toBe("zero-policy");
        expect(builtin[0]!.source).toBe(EXPECTED_SOURCE_MIGRATION[table]);
      }
    });

    it("the landed posture files (read directly via fs) contain no entry for any adjudicated table", () => {
      for (const postureFileName of [
        "rls-table-postures-substrate.json",
        "rls-table-postures-transport.json",
      ]) {
        const parsed: { tables?: { name?: string }[] } = JSON.parse(
          readRepoFile(join("scripts", "verification", postureFileName)),
        );
        const declaredNames = (parsed.tables ?? []).map((t) => t.name);
        for (const table of ADJUDICATED_TABLES) {
          expect(declaredNames).not.toContain(table);
        }
      }
    });
  });

  describe("3. each decision doc exists and adjudicates zero-policy-by-design", () => {
    const REQUIRED_SECTIONS = [
      "## OWNERSHIP",
      "## EVIDENCE",
      "## DECISION",
      "## RATIONALE",
      "## CONSTITUTION SECTIONS",
      "## PROPOSED-POLICY-IF-ANY",
    ] as const;

    for (const table of ADJUDICATED_TABLES) {
      it(`${table}.md exists with the full decision structure and the zero-policy-by-design adjudication`, () => {
        const doc = readFileSync(join(adjudicationDir, `${table}.md`), "utf8");

        for (const section of REQUIRED_SECTIONS) {
          expect(doc).toContain(section);
        }
        expect(doc).toMatch(/ZERO-POLICY-BY-DESIGN/);
        expect(doc).toMatch(/Team: H3-034/);
        expect(doc).toMatch(/Mission: D-034/);

        // Evidence traceability: the doc must cite the battery confirmation,
        // its creating migration, and its owning server path.
        expect(doc).toContain("--dry-parse-scope");
        expect(doc).toContain(EXPECTED_SOURCE_MIGRATION[table]);
        expect(doc).toContain(OWNING_SERVER_PATH[table]);

        // Memory-table docs must cite the AGENTS §19 privacy law and the
        // L-T-015 authorization-bypass threat (mission law for this family).
        if (table === "cg_memory_scope" || table === "cg_memory_record") {
          expect(doc).toMatch(/§19/);
          expect(doc).toMatch(/L-T-015/);
        }

        // Nothing applied: the doc must not claim a posture change.
        expect(doc).toMatch(/no posture file, migration, or policy was touched/i);
      });
    }
  });

  describe("4. owning server paths cited by the adjudications exist", () => {
    it.each([
      ["cg_worker_delegation", OWNING_SERVER_PATH.cg_worker_delegation],
      ["cg_memory_scope", OWNING_SERVER_PATH.cg_memory_scope],
      ["cg_memory_record", OWNING_SERVER_PATH.cg_memory_record],
    ] as const)("%s's owning server-path contract exists on disk", (_table, serverPath) => {
      const contract = readRepoFile(serverPath);
      expect(contract.length).toBeGreaterThan(0);
      // Memory's repository-vs-production reconciliation lives in ADR-021;
      // its pure contract cites the repository migration without asserting
      // whether that migration is applied in production.
      if (_table === "cg_memory_scope" || _table === "cg_memory_record") {
        expect(contract).toMatch(/20261002000004_coregrid_v1_memory_tier\.sql/);
        expect(contract).toMatch(/ADR-021/);
      } else {
        expect(contract).toMatch(/authored \(NOT applied\)/i);
      }
      expect(contract).toMatch(/deny by default|deny-by-default/i);
    });

    it("the memory contract enforces the identity AND tenant AND scope AND policy authorization gate (L-T-015 mitigation owner)", () => {
      const contract = readRepoFile(OWNING_SERVER_PATH.cg_memory_scope);
      expect(contract).toMatch(/identity AND tenant AND/i);
      expect(contract).toMatch(
        /No silent memory expansion|no silent memory expansion|No silent scope expansion|out-of-scope writes are REJECTED/i,
      );
      expect(contract).toMatch(/20261002000004_coregrid_v1_memory_tier\.sql/);
    });

    it("the worker contract owns the delegation-history write path cited by the adjudication", () => {
      const contract = readRepoFile(OWNING_SERVER_PATH.cg_worker_delegation);
      expect(contract).toMatch(/recordDelegation/);
      expect(contract).toMatch(/20261002000002_coregrid_v1_worker_definitions\.sql/);
    });
  });

  /* ==========================================================================
   * T-D ratchet extension (post-R-wave, TEAM T-D) — EXTEND-ONLY, appended.
   *
   * This mission's three adjudicated tables above stay zero-policy; the
   * transport posture file (rls-table-postures-transport.json) separately
   * moved public.transport_buses to a policy-backed SELECT-only posture
   * (migration 20261003000041, operator-directed). This extension ratchets
   * the battery's fail-closed posture validation against the NEW transport
   * entry so the posture change is asserted, never silently tolerated.
   * ======================================================================== */
  describe("H3-034 T-D transport posture ratchet extension (policy-backed transport_buses)", () => {
    const TRANSPORT_FILE = "rls-table-postures-transport.json";
    const TRANSPORT_POLICY = "transport_buses_select_driver_assigned";
    const TRANSPORT_POLICY_MIGRATION =
      "database/supabase/migrations/20261003000041_coregrid_transport_bus_reads.sql";

    type TransportEntry = {
      name?: string;
      posture?: string;
      policies?: string[];
      tenantColumn?: string;
      forceRls?: boolean;
      policyBackedBy?: string;
      normalizedBy?: string;
      privileges?: { authenticated?: string[]; anon?: string[]; PUBLIC?: string[] };
    };

    const transportRaw = JSON.parse(
      readRepoFile(join("scripts", "verification", TRANSPORT_FILE)),
    ) as { tables?: TransportEntry[] };
    const transportEntry = transportRaw.tables?.find((t) => t.name === "transport_buses");

    it("the transport posture file declares transport_buses policy-backed with exactly the T-D driver read policy", () => {
      expect(transportEntry).toBeDefined();
      expect(transportEntry?.posture).toBe("policy-backed");
      expect(transportEntry?.policies).toEqual([TRANSPORT_POLICY]);
      expect(transportEntry?.policyBackedBy).toBe(TRANSPORT_POLICY_MIGRATION);
      expect(transportEntry?.normalizedBy).toBe(
        "database/supabase/migrations/20261002000014_coregrid_v2_transport_buses_rls.sql",
      );
    });

    it("the T-D entry passes the battery's fail-closed validation gate (validatePostureEntry)", () => {
      const validated = batteryMjs.validatePostureEntry(transportEntry, TRANSPORT_FILE);
      expect(validated.posture).toBe("policy-backed");
      expect(validated.policies).toEqual([TRANSPORT_POLICY]);
      expect(validated.forceRls).toBe(true);
      // The declared least-privilege privilege set must survive validation:
      // SELECT-only for authenticated, zero anon/PUBLIC.
      expect(transportEntry?.privileges?.authenticated).toEqual(["SELECT"]);
      expect(transportEntry?.privileges?.anon ?? []).toEqual([]);
      expect(transportEntry?.privileges?.PUBLIC ?? []).toEqual([]);
    });

    it("the transport posture change does not re-declare this mission's adjudicated tables", () => {
      const declaredNames = (transportRaw.tables ?? []).map((t) => t.name);
      for (const table of ADJUDICATED_TABLES) {
        expect(declaredNames).not.toContain(table);
      }
    });
  });
});
