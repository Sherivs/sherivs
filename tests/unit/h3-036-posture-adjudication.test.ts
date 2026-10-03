/**
 * CoreGrid — H3-036 posture-adjudication consistency tests (Squad D).
 * Adjudicates the RLS posture of cg_event_security_denial,
 * cg_event_security_redaction and cg_event_route_queue as
 * zero-policy-by-design, and proves the decisions' internal consistency:
 *   - each table exists in its authoring migration (with RLS enabled and
 *     client privileges revoked);
 *   - each table appears in the battery posture scope as a zero-policy
 *     entry (no policies, no FORCE) and in batteryExpectations.zeroPolicyTables;
 *   - the battery's own exported posture validation accepts every entry;
 *   - each table has a decision doc adjudicating zero-policy-by-design.
 * Read-only throughout: posture JSONs, battery script, migrations and
 * decision docs are imported/read, never written. Pure offline.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain-JS verification script without type declarations imported into the TS unit suite (read-only module import; same pattern as tests/unit/mh-05-battery-postures.test.ts)
import * as batteryMjs from "../../scripts/verify-rls-isolation-battery.mjs";

const battery = batteryMjs as unknown as {
  parsePostureFile: (contents: string, fileName: string) => PostureEntry[];
  validatePostureEntry: (entry: unknown, fileName: string) => unknown;
};

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const ADJUDICATED_TABLES = [
  "cg_event_security_denial",
  "cg_event_security_redaction",
  "cg_event_route_queue",
] as const;

type AdjudicatedTable = (typeof ADJUDICATED_TABLES)[number];

interface PostureEntry {
  name?: string;
  table?: string;
  posture: string;
  policies?: unknown;
  forceRls?: boolean;
  source?: string;
  sourceMigration?: string;
  [key: string]: unknown;
}

interface SubstratePostureFile {
  tables: PostureEntry[];
  batteryExpectations?: { zeroPolicyTables?: string[] };
  [key: string]: unknown;
}

const MIGRATION_BY_TABLE: Record<AdjudicatedTable, string> = {
  cg_event_security_denial:
    "database/supabase/migrations/20261002000006_coregrid_v1_event_security.sql",
  cg_event_security_redaction:
    "database/supabase/migrations/20261002000006_coregrid_v1_event_security.sql",
  cg_event_route_queue:
    "database/supabase/migrations/20261002000007_coregrid_v1_event_routing.sql",
};

const DECISION_DOC_BY_TABLE: Record<AdjudicatedTable, string> = {
  cg_event_security_denial:
    "architecture/campaigns/h3/posture-adjudication/cg_event_security_denial.md",
  cg_event_security_redaction:
    "architecture/campaigns/h3/posture-adjudication/cg_event_security_redaction.md",
  cg_event_route_queue:
    "architecture/campaigns/h3/posture-adjudication/cg_event_route_queue.md",
};

const POSTURE_FILE = "scripts/verification/rls-table-postures-substrate.json";
const TRANSPORT_POSTURE_FILE = "scripts/verification/rls-table-postures-transport.json";

function readRepoFile(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8");
}

function loadSubstratePostureFile(): SubstratePostureFile {
  return JSON.parse(readRepoFile(POSTURE_FILE)) as SubstratePostureFile;
}

function entryFor(table: AdjudicatedTable): PostureEntry {
  const file = loadSubstratePostureFile();
  const entries = file.tables.filter(
    (entry) => entry.name === table || entry.table === table,
  );
  expect(entries, `exactly one posture entry for ${table}`).toHaveLength(1);
  return entries[0];
}

describe("H3-036 posture adjudication — battery scope (read-only)", () => {
  it("declares every adjudicated table in the substrate posture file", () => {
    const file = loadSubstratePostureFile();
    for (const table of ADJUDICATED_TABLES) {
      entryFor(table);
    }
    expect(file.tables.length).toBeGreaterThan(0);
  });

  it("declares every adjudicated table as zero-policy with no policies and no FORCE", () => {
    for (const table of ADJUDICATED_TABLES) {
      const entry = entryFor(table);
      expect(entry.posture, `${table} posture`).toBe("zero-policy");
      const policies = entry.policies;
      expect(
        policies === undefined || (Array.isArray(policies) && policies.length === 0),
        `${table} must carry zero policies — zero policies IS the posture`,
      ).toBe(true);
      expect(entry.forceRls, `${table} must not declare FORCE (it cannot strengthen zero-policy)`).toBeFalsy();
    }
  });

  it("lists every adjudicated table in batteryExpectations.zeroPolicyTables", () => {
    const file = loadSubstratePostureFile();
    const zeroPolicy = file.batteryExpectations?.zeroPolicyTables ?? [];
    for (const table of ADJUDICATED_TABLES) {
      expect(zeroPolicy, `${table} in zeroPolicyTables`).toContain(table);
    }
  });

  it("is accepted by the battery's own exported posture validation", () => {
    const raw = readRepoFile(POSTURE_FILE);
    const parsed = battery.parsePostureFile(raw, POSTURE_FILE) as PostureEntry[];
    for (const table of ADJUDICATED_TABLES) {
      const entry = parsed.find((e) => e.name === table || e.table === table);
      expect(entry, `${table} entry parses`).toBeDefined();
      expect(() => battery.validatePostureEntry(entry, POSTURE_FILE)).not.toThrow();
      expect(entry?.posture).toBe("zero-policy");
    }
  });

  it("finds no duplicate declaration of the adjudicated tables in the transport posture file", () => {
    const raw = readRepoFile(TRANSPORT_POSTURE_FILE);
    const parsed = battery.parsePostureFile(raw, TRANSPORT_POSTURE_FILE) as PostureEntry[];
    for (const table of ADJUDICATED_TABLES) {
      expect(
        parsed.filter((e) => e.name === table || e.table === table),
        `${table} must not be declared twice across posture files`,
      ).toHaveLength(0);
    }
  });
});

describe("H3-036 posture adjudication — migrations (read-only)", () => {
  it("creates every adjudicated table in its authoring migration", () => {
    for (const table of ADJUDICATED_TABLES) {
      const migration = readRepoFile(MIGRATION_BY_TABLE[table]);
      expect(
        migration.includes(`CREATE TABLE IF NOT EXISTS public.${table}`),
        `${table} created by ${MIGRATION_BY_TABLE[table]}`,
      ).toBe(true);
    }
  });

  it("enables RLS and revokes all client privileges on every adjudicated table", () => {
    for (const table of ADJUDICATED_TABLES) {
      const migration = readRepoFile(MIGRATION_BY_TABLE[table]);
      expect(
        migration.includes(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`),
        `${table} has RLS enabled`,
      ).toBe(true);
      expect(
        migration.includes(`REVOKE ALL ON public.${table} FROM anon, authenticated`),
        `${table} client privileges revoked`,
      ).toBe(true);
    }
  });

  it("authored zero policies for the adjudicated tables in the migrations", () => {
    for (const table of ADJUDICATED_TABLES) {
      const migration = readRepoFile(MIGRATION_BY_TABLE[table]);
      const policyStatements = migration
        .split("\n")
        .filter((line) => /CREATE POLICY/i.test(line))
        .filter((line) => line.includes(table));
      expect(
        policyStatements,
        `${table} must have zero authored policies in its migration`,
      ).toHaveLength(0);
    }
  });
});

describe("H3-036 posture adjudication — decision docs (read-only)", () => {
  it("has one decision doc per adjudicated table", () => {
    for (const table of ADJUDICATED_TABLES) {
      expect(existsSync(join(REPO_ROOT, DECISION_DOC_BY_TABLE[table])), `${table} doc exists`).toBe(true);
    }
  });

  it("adjudicates zero-policy-by-design with the required structure in every doc", () => {
    for (const table of ADJUDICATED_TABLES) {
      const doc = readRepoFile(DECISION_DOC_BY_TABLE[table]);
      for (const section of ["OWNERSHIP", "EVIDENCE", "DECISION", "RATIONALE", "CONSTITUTION SECTIONS", "PROPOSED-POLICY-IF-ANY"]) {
        expect(doc.includes(`## ${section}`), `${table} doc has ${section}`).toBe(true);
      }
      expect(doc.includes("ZERO-POLICY-BY-DESIGN"), `${table} doc adjudicates zero-policy-by-design`).toBe(true);
      expect(doc.includes(`\`${table}\``), `${table} doc names its table`).toBe(true);
    }
  });

  it("cites the owning server paths and the battery/posture evidence in every doc", () => {
    const docEvidence: Record<AdjudicatedTable, string[]> = {
      cg_event_security_denial: [
        "frontend/src/lib/adapters/event-security-store.adapter.ts",
        "20261002000006_coregrid_v1_event_security.sql",
        "rls-table-postures-substrate.json",
        "verify-rls-isolation-battery.mjs",
      ],
      cg_event_security_redaction: [
        "frontend/src/lib/adapters/event-security-store.adapter.ts",
        "20261002000006_coregrid_v1_event_security.sql",
        "rls-table-postures-substrate.json",
        "verify-rls-isolation-battery.mjs",
      ],
      cg_event_route_queue: [
        "frontend/src/lib/adapters/event-routing-store.adapter.ts",
        "20261002000007_coregrid_v1_event_routing.sql",
        "rls-table-postures-substrate.json",
        "verify-rls-isolation-battery.mjs",
      ],
    };
    for (const table of ADJUDICATED_TABLES) {
      const doc = readRepoFile(DECISION_DOC_BY_TABLE[table]);
      for (const citation of docEvidence[table]) {
        expect(doc.includes(citation), `${table} doc cites ${citation}`).toBe(true);
      }
    }
  });

  it("cites Constitution §28 and §35 in every rationale (append-only audit + realtime security)", () => {
    for (const table of ADJUDICATED_TABLES) {
      const doc = readRepoFile(DECISION_DOC_BY_TABLE[table]);
      expect(doc.includes("§28"), `${table} doc cites §28`).toBe(true);
      expect(doc.includes("§35"), `${table} doc cites §35`).toBe(true);
    }
  });

  it("proposes no policy for any adjudicated table", () => {
    for (const table of ADJUDICATED_TABLES) {
      const doc = readRepoFile(DECISION_DOC_BY_TABLE[table]);
      const proposed = doc.slice(doc.indexOf("## PROPOSED-POLICY-IF-ANY"));
      expect(proposed.includes("**None.**"), `${table} proposes no policy`).toBe(true);
    }
  });
});
