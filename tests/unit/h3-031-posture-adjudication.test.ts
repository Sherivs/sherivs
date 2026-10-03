/**
 * H3-031 — Squad D posture adjudication internal-consistency suite.
 *
 * Team H3-031 (mission D-031) adjudicates the RLS posture of the kernel-family
 * tables cg_entity, cg_relationship, cg_event as zero-policy-by-design. This
 * suite asserts the decisions' internal consistency against the three sources
 * of truth, all READ-ONLY and offline:
 *
 *   1. the RLS isolation battery's built-in canonical posture registry
 *      (scripts/verify-rls-isolation-battery.mjs — module import, no execution);
 *   2. the declarative posture files (scripts/verification/rls-table-postures-*.json
 *      — read via fs, merged with loadPostureRegistry, must NOT override them);
 *   3. the creating migration (20260903000000_coregrid_universal_kernel_substrate.sql
 *      — read via fs: tables exist, RLS enabled, REVOKE anon/authenticated,
 *      GRANT service_role, zero CREATE POLICY statements);
 *   4. this team's decision docs (architecture/campaigns/h3/posture-adjudication/
 *      — read via fs: decision markers must agree with 1–3).
 *
 * No database is touched; no network; no secrets. This suite never applies
 * anything — it proves the adjudication is consistent with the evidence.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// @ts-expect-error — plain-JS verification script imported into the TS unit suite (read-only module import; same pattern as tests/unit/mh-05-battery-postures.test.ts)
import * as batteryMjs from "../../scripts/verify-rls-isolation-battery.mjs";

interface PostureEntry {
  name: string;
  posture: string;
  source?: string;
  postureSource?: string;
  policies?: unknown[];
  forceRls?: boolean;
  [key: string]: unknown;
}

interface PostureRegistry {
  tables: PostureEntry[];
  files: string[];
  fallbackUsed: boolean;
  overridden: string[];
  added: string[];
}

interface BatteryModule {
  BUILTIN_TABLE_POSTURES: PostureEntry[];
  loadPostureRegistry: (dir: string) => PostureRegistry;
}

const battery = batteryMjs as unknown as BatteryModule;

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const POSTURE_DIR = join(repoRoot, "scripts", "verification");
const KERNEL_MIGRATION = "20260903000000_coregrid_universal_kernel_substrate.sql";
const KERNEL_MIGRATION_PATH = join(repoRoot, "database", "supabase", "migrations", KERNEL_MIGRATION);
const ADJUDICATION_DIR = join(repoRoot, "architecture", "campaigns", "h3", "posture-adjudication");

// The three kernel-family tables this mission adjudicates (H3-WAVE-CAMPAIGN.md Squad D, D-031).
const ADJUDICATED_TABLES = ["cg_entity", "cg_relationship", "cg_event"] as const;

const migrationText = readFileSync(KERNEL_MIGRATION_PATH, "utf8");
const mergedRegistry: PostureRegistry = battery.loadPostureRegistry(POSTURE_DIR);

function builtinEntry(table: string): PostureEntry {
  const entry = battery.BUILTIN_TABLE_POSTURES.find((t) => t.name === table);
  if (!entry) throw new Error(`builtin posture entry missing for ${table}`);
  return entry;
}

function mergedEntry(table: string): PostureEntry {
  const entry = mergedRegistry.tables.find((t) => t.name === table);
  if (!entry) throw new Error(`merged registry entry missing for ${table}`);
  return entry;
}

interface DecisionDoc {
  table: string;
  sourceMigration: string;
  batteryPosture: string;
  decision: string;
  sections: string[];
}

function parseDecisionDoc(table: string): DecisionDoc {
  const path = join(ADJUDICATION_DIR, `${table}.md`);
  expect(existsSync(path), `decision doc must exist at ${path}`).toBe(true);
  const text = readFileSync(path, "utf8");
  const field = (label: string): string => {
    const m = text.match(new RegExp(`^${label}: (.+)$`, "m"));
    if (!m) throw new Error(`decision doc ${table}.md is missing the machine-checkable "${label}:" line`);
    return m[1].trim();
  };
  return {
    table: field("TABLE"),
    sourceMigration: field("SOURCE MIGRATION"),
    batteryPosture: field("BATTERY POSTURE"),
    decision: field("DECISION"),
    sections: [
      "OWNERSHIP",
      "EVIDENCE",
      "DECISION",
      "RATIONALE",
      "CONSTITUTION SECTIONS",
      "PROPOSED-POLICY-IF-ANY",
    ].filter((s) => text.includes(`## ${s}`)),
  };
}

describe("h3-031 posture adjudication — battery scope (builtin canonical registry)", () => {
  it.each([...ADJUDICATED_TABLES])("%s is declared zero-policy in BUILTIN_TABLE_POSTURES", (table) => {
    const entry = builtinEntry(table);
    expect(entry.posture).toBe("zero-policy");
  });

  it.each([...ADJUDICATED_TABLES])("%s cites the kernel-substrate migration as its source", (table) => {
    const entry = builtinEntry(table);
    expect(entry.source).toBe(KERNEL_MIGRATION);
  });

  it.each([...ADJUDICATED_TABLES])("%s declares zero policies and is not force-strengthened", (table) => {
    const entry = builtinEntry(table);
    expect(entry.policies ?? []).toHaveLength(0);
    expect(entry.forceRls ?? false).toBe(false);
  });

  it("declares no additional postures beyond the battery's dual-posture vocabulary", () => {
    const legal = new Set(["zero-policy", "policy-backed"]);
    for (const table of ADJUDICATED_TABLES) {
      expect(legal.has(builtinEntry(table).posture)).toBe(true);
    }
  });
});

describe("h3-031 posture adjudication — declarative posture files (fs, read-only)", () => {
  it("merges the real posture JSON directory without error", () => {
    expect(Array.isArray(mergedRegistry.tables)).toBe(true);
    expect(mergedRegistry.fallbackUsed).toBe(false);
    expect(mergedRegistry.files.sort()).toEqual([
      "rls-table-postures-mission-lease.json",
      "rls-table-postures-r-wave.json",
      "rls-table-postures-substrate.json",
      "rls-table-postures-transport.json",
    ]);
  });

  it.each([...ADJUDICATED_TABLES])("%s remains zero-policy after the posture-file merge", (table) => {
    const entry = mergedEntry(table);
    expect(entry.posture).toBe("zero-policy");
    expect(entry.policies ?? []).toHaveLength(0);
  });

  it.each([...ADJUDICATED_TABLES])("%s is resolved from the builtin-canonical source, not overridden or added by a posture file", (table) => {
    const entry = mergedEntry(table);
    expect(entry.postureSource).toBe("builtin-canonical");
    expect(mergedRegistry.overridden).not.toContain(table);
    expect(mergedRegistry.added).not.toContain(table);
  });

  it("leaves no posture file claiming a second source of truth for an adjudicated table", () => {
    const claimed = mergedRegistry.tables.filter(
      (t) => (ADJUDICATED_TABLES as readonly string[]).includes(t.name) && t.postureSource !== "builtin-canonical",
    );
    expect(claimed).toEqual([]);
  });
});

describe("h3-031 posture adjudication — creating migration (fs, read-only)", () => {
  it("exists at the cited path", () => {
    expect(existsSync(KERNEL_MIGRATION_PATH)).toBe(true);
  });

  it.each([...ADJUDICATED_TABLES])("creates %s", (table) => {
    expect(migrationText).toContain(`CREATE TABLE IF NOT EXISTS public.${table} (`);
  });

  it.each([...ADJUDICATED_TABLES])("enables RLS on %s", (table) => {
    // The migration aligns the ALTER TABLE block with padding whitespace.
    expect(migrationText).toMatch(new RegExp(`ALTER TABLE public\\.${table}\\s+ENABLE ROW LEVEL SECURITY`));
  });

  it("grants nothing to anon/authenticated and everything only to service_role", () => {
    expect(migrationText).toContain(
      "REVOKE ALL ON TABLE public.cg_entity, public.cg_relationship, public.cg_event, public.cg_observation, public.cg_domain_runtime",
    );
    expect(migrationText).toContain("FROM anon, authenticated");
    expect(migrationText).toContain(
      "GRANT ALL ON TABLE public.cg_entity, public.cg_relationship, public.cg_event, public.cg_observation, public.cg_domain_runtime",
    );
    expect(migrationText).toContain("TO service_role");
  });

  it("contains zero CREATE POLICY statements — zero policies IS the posture", () => {
    expect((migrationText.match(/CREATE POLICY/g) ?? []).length).toBe(0);
  });
});

describe("h3-031 posture adjudication — decision docs are internally consistent", () => {
  it.each([...ADJUDICATED_TABLES])("%s.md carries the required structured sections", (table) => {
    const doc = parseDecisionDoc(table);
    for (const section of [
      "OWNERSHIP",
      "EVIDENCE",
      "DECISION",
      "RATIONALE",
      "CONSTITUTION SECTIONS",
      "PROPOSED-POLICY-IF-ANY",
    ]) {
      expect(doc.sections, `${table}.md must contain the "## ${section}" section`).toContain(section);
    }
  });

  it.each([...ADJUDICATED_TABLES])("%s.md decision markers agree with the battery scope", (table) => {
    const doc = parseDecisionDoc(table);
    expect(doc.table).toBe(table);
    expect(doc.batteryPosture).toBe("zero-policy");
    expect(doc.decision).toBe("zero-policy-by-design");
    expect(builtinEntry(table).posture).toBe(doc.batteryPosture);
    expect(mergedEntry(table).posture).toBe(doc.batteryPosture);
  });

  it.each([...ADJUDICATED_TABLES])("%s.md cites a migration that exists and actually creates the table", (table) => {
    const doc = parseDecisionDoc(table);
    const citedPath = join(repoRoot, "database", "supabase", "migrations", doc.sourceMigration);
    expect(existsSync(citedPath), `cited migration must exist: ${doc.sourceMigration}`).toBe(true);
    expect(readFileSync(citedPath, "utf8")).toContain(`CREATE TABLE IF NOT EXISTS public.${table} (`);
  });

  it.each([...ADJUDICATED_TABLES])("%s.md cites at least one constitution section and never claims an applied policy", (table) => {
    const doc = parseDecisionDoc(table);
    const text = readFileSync(join(ADJUDICATION_DIR, `${table}.md`), "utf8");
    expect(text).toMatch(/§\d+/);
    expect(text).not.toMatch(/^APPLIED:/m);
    expect(text).toMatch(/^Status: ADJUDICATED/m);
  });

  it("adjudicates exactly the mission's three tables and no others", () => {
    expect([...ADJUDICATED_TABLES].sort()).toEqual(["cg_entity", "cg_event", "cg_relationship"]);
  });
});

/* ============================================================================
 * T-D ratchet extension (post-R-wave, TEAM T-D) — EXTEND-ONLY, appended.
 *
 * The transport posture file (rls-table-postures-transport.json) moved
 * public.transport_buses from the zero-policy substrate era to a policy-backed
 * SELECT-only posture (migration 20261003000041, operator-directed). This
 * suite's OWN adjudicated tables above are untouched; this extension ratchets
 * the merged-registry expectations so the NEW transport posture is asserted
 * (not merely tolerated), per the mission-lease posture-file pattern.
 * ========================================================================== */
describe("h3-031 posture adjudication — T-D transport posture ratchet extension", () => {
  const TRANSPORT_POLICY = "transport_buses_select_driver_assigned";
  const TRANSPORT_POLICY_MIGRATION =
    "database/supabase/migrations/20261003000041_coregrid_transport_bus_reads.sql";

  it("transport_buses is NOT a builtin-canonical entry — the posture file is its single source of truth", () => {
    expect(battery.BUILTIN_TABLE_POSTURES.some((t) => t.name === "transport_buses")).toBe(false);
    expect(mergedRegistry.added).toContain("transport_buses");
  });

  it("transport_buses resolves policy-backed from the transport posture file after the merge", () => {
    const entry = mergedRegistry.tables.find((t) => t.name === "transport_buses");
    expect(entry, "transport_buses must be present in the merged registry").toBeDefined();
    expect(entry?.posture).toBe("policy-backed");
    expect(entry?.postureSource).toBe("rls-table-postures-transport.json");
    expect(entry?.source).toBe(
      "database/supabase/migrations/20260626150625_35a08443-45fd-46ae-807b-3644b44efe26.sql",
    );
  });

  it("transport_buses declares exactly the T-D driver read policy with FORCE RLS and the assignment-scope column", () => {
    const entry = mergedEntry("transport_buses");
    expect(entry.policies).toEqual([TRANSPORT_POLICY]);
    expect(entry.forceRls).toBe(true);
    // The assignment-identity scope column (the legacy users-table FK the
    // predicate binds) — NOT a neutral tenant ref; the posture file records
    // the honest scope deviation and its conversion path.
    expect(entry.tenantColumn).toBe("driver_id");
    expect(entry.policyBackedBy).toBe(TRANSPORT_POLICY_MIGRATION);
  });

  it("the transport posture file moves transport_buses out of the zero-policy battery expectation", () => {
    const file = JSON.parse(
      readFileSync(join(POSTURE_DIR, "rls-table-postures-transport.json"), "utf8"),
    ) as { batteryExpectations?: { zeroPolicyTables?: string[]; policyBackedTables?: string[] } };
    expect(file.batteryExpectations?.zeroPolicyTables ?? []).not.toContain("transport_buses");
    expect(file.batteryExpectations?.policyBackedTables).toEqual(["transport_buses"]);
  });

  it("the T-D ratchet does not touch this mission's adjudicated kernel tables", () => {
    for (const table of ADJUDICATED_TABLES) {
      expect(builtinEntry(table).posture).toBe("zero-policy");
      expect(mergedEntry(table).posture).toBe("zero-policy");
      expect(mergedEntry(table).postureSource).toBe("builtin-canonical");
    }
  });
});