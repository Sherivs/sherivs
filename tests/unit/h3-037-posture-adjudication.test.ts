/**
 * CoreGrid — H3 wave, team H3-037 (Posture Adjudication Engineer,
 * routing/evidence family), mission D-037.
 *
 * Internal-consistency proof for the Squad D posture adjudication of exactly
 * three tables: cg_event_route_cursor, cg_event_route_outcome,
 * cg_evidence_lifecycle_act. The decisions are recorded in
 * architecture/campaigns/h3/posture-adjudication/<table>.md (ZERO-POLICY-BY-
 * DESIGN, apply nothing). This suite asserts that the decisions agree with
 * the repository's own evidence, entirely offline (no database, no network,
 * no credentials):
 *
 *  - the declarative posture registry (scripts/verification/
 *    rls-table-postures-substrate.json — read via fs, never modified)
 *    declares each table posture=zero-policy with zero policies, forceRls
 *    not forced, sourced from the owning migration, and lists each table in
 *    batteryExpectations.zeroPolicyTables (never in policyBackedTables);
 *  - the owning migrations exist and pin the zero-policy posture in their
 *    text: CREATE TABLE, ENABLE ROW LEVEL SECURITY, REVOKE ALL from
 *    anon/authenticated, and NO `CREATE POLICY` statement for the table;
 *  - the owning service-role adapters exist and own the table-name constants
 *    (single writer path — Constitution §24/§25);
 *  - the RLS isolation battery's offline registry resolution
 *    (`--dry-parse-scope`, read-only, no credentials) resolves each table as
 *    posture=zero-policy from rls-table-postures-substrate.json;
 *  - the decision docs exist and carry the required Squad D structure.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

interface PostureEntry {
  name: string;
  source?: string;
  posture: string;
  forceRls?: boolean;
  policies?: unknown[];
  auditAppendOnly?: boolean;
  clientWritePolicy?: string;
  rationale?: string;
}

interface SubstratePostureFile {
  artifact: string;
  migration: string;
  tables: PostureEntry[];
  batteryExpectations: {
    policyBackedTables: string[];
    zeroPolicyTables: string[];
  };
}

const SUBSTRATE_POSTURES = join(
  ROOT,
  "scripts",
  "verification",
  "rls-table-postures-substrate.json",
);

const ADJUDICATED_TABLES = [
  "cg_event_route_cursor",
  "cg_event_route_outcome",
  "cg_evidence_lifecycle_act",
] as const;

type AdjudicatedTable = (typeof ADJUDICATED_TABLES)[number];

/** Owning migration per table (from the posture file's own `source` field). */
const OWNING_MIGRATIONS: Record<AdjudicatedTable, string> = {
  cg_event_route_cursor: "20261002000007_coregrid_v1_event_routing.sql",
  cg_event_route_outcome: "20261002000007_coregrid_v1_event_routing.sql",
  cg_evidence_lifecycle_act: "20261002000008_coregrid_v1_evidence_lifecycle.sql",
};

/** Owning service-role adapter per table (the only DB-writer path, §24/§25). */
const OWNING_ADAPTERS: Record<AdjudicatedTable, { file: string; constant: string }> = {
  cg_event_route_cursor: {
    file: "frontend/src/lib/adapters/event-routing-store.adapter.ts",
    constant: 'EVENT_ROUTE_CURSOR_TABLE = "cg_event_route_cursor"',
  },
  cg_event_route_outcome: {
    file: "frontend/src/lib/adapters/event-routing-store.adapter.ts",
    constant: 'EVENT_ROUTE_OUTCOME_TABLE = "cg_event_route_outcome"',
  },
  cg_evidence_lifecycle_act: {
    file: "frontend/src/lib/adapters/evidence-capture-store.adapter.ts",
    constant: 'EVIDENCE_LIFECYCLE_ACT_TABLE = "cg_evidence_lifecycle_act"',
  },
};

/** The two audit surfaces carry the strongest append-only justification. */
const AUDIT_APPEND_ONLY_TABLES: readonly AdjudicatedTable[] = [
  "cg_event_route_outcome",
  "cg_evidence_lifecycle_act",
];

const substratePostures: SubstratePostureFile = JSON.parse(
  readFileSync(SUBSTRATE_POSTURES, "utf8"),
) as SubstratePostureFile;

function postureEntry(table: AdjudicatedTable): PostureEntry {
  const entry = substratePostures.tables.find((t) => t.name === table);
  expect(entry, `posture entry must exist for ${table}`).toBeDefined();
  return entry as PostureEntry;
}

function migrationPath(table: AdjudicatedTable): string {
  return join(ROOT, "database", "supabase", "migrations", OWNING_MIGRATIONS[table]);
}

function rollbackPath(table: AdjudicatedTable): string {
  return join(
    ROOT,
    "database",
    "supabase",
    "rollbacks",
    OWNING_MIGRATIONS[table],
  );
}

function readMigration(table: AdjudicatedTable): string {
  return readFileSync(migrationPath(table), "utf8");
}

describe("H3-037 posture adjudication — declarative posture registry (read-only)", () => {
  it("declares each adjudicated table as zero-policy in the substrate posture file", () => {
    for (const table of ADJUDICATED_TABLES) {
      const entry = postureEntry(table);
      expect(entry.posture, `${table} posture`).toBe("zero-policy");
      expect(
        entry.policies == null || entry.policies.length === 0,
        `${table} must declare zero policies (absent or empty)`,
      ).toBe(true);
      expect(entry.forceRls, `${table} must not be forceRls`).not.toBe(true);
      expect(entry.rationale, `${table} must carry a rationale`).toBeTruthy();
      expect(entry.source, `${table} source migration`).toBe(
        OWNING_MIGRATIONS[table],
      );
    }
  });

  it("declares the two audit surfaces as append-only with client write policy NONE", () => {
    for (const table of AUDIT_APPEND_ONLY_TABLES) {
      const entry = postureEntry(table);
      expect(entry.auditAppendOnly, `${table} auditAppendOnly`).toBe(true);
      expect(
        entry.clientWritePolicy?.startsWith("NONE"),
        `${table} client write policy is NONE`,
      ).toBe(true);
    }
  });

  it("lists every adjudicated table in zeroPolicyTables and in no policy-backed set", () => {
    for (const table of ADJUDICATED_TABLES) {
      expect(
        substratePostures.batteryExpectations.zeroPolicyTables,
        `${table} in zeroPolicyTables`,
      ).toContain(table);
      expect(
        substratePostures.batteryExpectations.policyBackedTables,
        `${table} not in policyBackedTables`,
      ).not.toContain(table);
    }
  });
});

describe("H3-037 posture adjudication — owning migrations pin the posture", () => {
  it("has an owning migration and rollback for every adjudicated table", () => {
    for (const table of ADJUDICATED_TABLES) {
      expect(existsSync(migrationPath(table)), `migration for ${table}`).toBe(
        true,
      );
      expect(existsSync(rollbackPath(table)), `rollback for ${table}`).toBe(
        true,
      );
    }
  });

  it("creates each table, enables RLS, and revokes all client privileges", () => {
    for (const table of ADJUDICATED_TABLES) {
      const sql = readMigration(table);
      expect(
        sql.includes(`CREATE TABLE IF NOT EXISTS public.${table}`),
        `${table} created`,
      ).toBe(true);
      expect(
        sql.includes(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`),
        `${table} RLS enabled`,
      ).toBe(true);
      expect(
        sql.includes(`REVOKE ALL ON public.${table} FROM anon, authenticated`),
        `${table} client privileges revoked`,
      ).toBe(true);
    }
  });

  it("authors NO policy for any adjudicated table (zero-policy is the posture)", () => {
    for (const table of ADJUDICATED_TABLES) {
      const sql = readMigration(table);
      const policyOnTable = sql
        .split("\n")
        .some((line) => line.includes("CREATE POLICY") && line.includes(table));
      expect(policyOnTable, `${table}: no CREATE POLICY authored`).toBe(false);
    }
  });
});

describe("H3-037 posture adjudication — owning adapters (single writer path)", () => {
  it("owns each table through the service-role adapter table-name constant", () => {
    for (const table of ADJUDICATED_TABLES) {
      const { file, constant } = OWNING_ADAPTERS[table];
      const adapterPath = join(ROOT, file);
      expect(existsSync(adapterPath), `adapter ${file}`).toBe(true);
      const adapter = readFileSync(adapterPath, "utf8");
      expect(adapter.includes(constant), `${file} exports ${constant}`).toBe(
        true,
      );
    }
  });

  it("declares service-role-only access in the adapters (no client surface)", () => {
    for (const file of [
      OWNING_ADAPTERS.cg_event_route_cursor.file,
      OWNING_ADAPTERS.cg_evidence_lifecycle_act.file,
    ]) {
      const adapter = readFileSync(join(ROOT, file), "utf8");
      expect(
        adapter.includes("Service-role access only"),
        `${file} documents service-role-only access`,
      ).toBe(true);
    }
  });
});

describe("H3-037 posture adjudication — battery scope resolution (offline)", () => {
  it("resolves every adjudicated table as zero-policy via --dry-parse-scope", () => {
    const result = spawnSync(
      process.execPath,
      [
        join(ROOT, "scripts", "verify-rls-isolation-battery.mjs"),
        "--dry-parse-scope",
      ],
      { encoding: "utf8" },
    );
    expect(result.status, "dry-parse exits 0 (valid registry)").toBe(0);
    expect(result.stdout).toContain("DRY_PARSE_OK");

    for (const table of ADJUDICATED_TABLES) {
      const line = result.stdout
        .split("\n")
        .find((l) => l.startsWith(`${table} `));
      expect(line, `${table} appears in the battery scope`).toBeDefined();
      expect(line).toContain("posture=zero-policy");
      expect(line).toContain("forceRls=false");
      expect(line).toContain("policies=0");
      expect(line).toContain("postureSource=rls-table-postures-substrate.json");
    }
  });
});

describe("H3-037 posture adjudication — decision docs", () => {
  it("exists for every adjudicated table with the required Squad D structure", () => {
    const requiredSections = [
      "OWNERSHIP",
      "EVIDENCE",
      "DECISION",
      "RATIONALE",
      "CONSTITUTION SECTIONS",
      "PROPOSED-POLICY-IF-ANY",
    ];
    for (const table of ADJUDICATED_TABLES) {
      const docPath = join(
        ROOT,
        "architecture",
        "campaigns",
        "h3",
        "posture-adjudication",
        `${table}.md`,
      );
      expect(existsSync(docPath), `decision doc for ${table}`).toBe(true);
      const doc = readFileSync(docPath, "utf8");
      for (const section of requiredSections) {
        expect(
          doc.includes(section),
          `${table} decision doc has ${section}`,
        ).toBe(true);
      }
      expect(doc.includes("ZERO-POLICY-BY-DESIGN")).toBe(true);
    }
  });
});