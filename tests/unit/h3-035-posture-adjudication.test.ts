/**
 * CoreGrid — MISSION H3-035 (Squad D): zero-policy posture adjudication for
 * cg_memory_access_log, cg_reconciliation_verdict, cg_event_security.
 *
 * Asserts the INTERNAL CONSISTENCY of the three decision docs authored under
 * architecture/campaigns/h3/posture-adjudication/:
 *
 *  1. each table EXISTS in its cited creating migration (and that migration
 *     authors the deny-by-default posture: ENABLE ROW LEVEL SECURITY +
 *     REVOKE ALL from anon/authenticated, with no policy statement);
 *  2. the declarative battery scope contains each table as a ZERO-POLICY
 *     entry — resolved exactly the way the battery resolves it (read-only
 *     import of the posture JSONs via fs, validated/merged through the
 *     battery's own exported pure functions, and cross-checked against the
 *     posture files' batteryExpectations zero-policy lists);
 *  3. the battery's zero-policy entry schema law holds (no policies, no
 *     FORCE expectation) and each decision doc adjudicates the same posture
 *     it claims.
 *
 * READ-ONLY: this suite imports the battery module (importing performs no
 * I/O and never exits) and reads migration/roll-up/posture/decision files.
 * It touches no database, runs no network, and asserts nothing applied.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error — plain-JS verification script without type declarations imported into the TS unit suite (read-only module import; same pattern as tests/unit/mh-05-battery-postures.test.ts)
import * as batteryMjs from "../../scripts/verify-rls-isolation-battery.mjs";

/** Shape of a resolved posture entry (battery module is plain JS; declared here). */
interface PostureTableEntry {
  name: string;
  posture: string;
  source: string;
  postureSource?: string;
  policies?: string[];
  forceRls?: boolean;
  tenantColumn?: string;
  probeSeedRows?: unknown[];
  probeInsertPayload?: unknown;
}

interface BatteryModule {
  BUILTIN_TABLE_POSTURES: PostureTableEntry[];
  parsePostureFile: (contents: string, fileName: string) => PostureTableEntry[];
  resolvePostureRegistry: (files: Array<{ name: string; entries: PostureTableEntry[] }>) => { tables: PostureTableEntry[] };
  validatePostureEntry: (entry: PostureTableEntry, label: string) => PostureTableEntry;
}

const battery = batteryMjs as unknown as BatteryModule;

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

/** The three tables this mission adjudicates, with their cited provenance. */
const ADJUDICATED = [
  {
    table: "cg_memory_access_log",
    migration: "database/supabase/migrations/20261002000004_coregrid_v1_memory_tier.sql",
    rollback: "database/supabase/rollbacks/20261002000004_coregrid_v1_memory_tier.sql",
    decisionDoc: "architecture/campaigns/h3/posture-adjudication/cg_memory_access_log.md",
    expectedSource: "builtin-canonical",
  },
  {
    table: "cg_reconciliation_verdict",
    migration: "database/supabase/migrations/20261002000005_coregrid_v1_reconciliation.sql",
    rollback: "database/supabase/rollbacks/20261002000005_coregrid_v1_reconciliation.sql",
    decisionDoc: "architecture/campaigns/h3/posture-adjudication/cg_reconciliation_verdict.md",
    expectedSource: "rls-table-postures-substrate.json",
  },
  {
    table: "cg_event_security",
    migration: "database/supabase/migrations/20261002000006_coregrid_v1_event_security.sql",
    rollback: "database/supabase/rollbacks/20261002000006_coregrid_v1_event_security.sql",
    decisionDoc: "architecture/campaigns/h3/posture-adjudication/cg_event_security.md",
    expectedSource: "rls-table-postures-substrate.json",
  },
] as const;

const MIGRATIONS = new Map(ADJUDICATED.map((a) => [a.table, read(a.migration)]));

const postureDir = join(ROOT, "scripts", "verification");
const postureFiles = ["rls-table-postures-substrate.json", "rls-table-postures-transport.json"]
  .sort()
  .map((name) => ({ name, entries: battery.parsePostureFile(read(`scripts/verification/${name}`), name) }));
const REGISTRY = battery.resolvePostureRegistry(postureFiles);

function registryEntry(table: string): PostureTableEntry {
  const entry = REGISTRY.tables.find((t) => t.name === table);
  if (!entry) throw new Error(`table ${table} absent from resolved battery registry`);
  return entry;
}

describe("H3-035 posture adjudication — tables exist in their cited migrations", () => {
  for (const { table, migration } of ADJUDICATED) {
    it(`${table} is created by ${migration.split("/").pop()}`, () => {
      const sql = MIGRATIONS.get(table);
      expect(sql).toBeDefined();
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS public.${table} (`);
    });

    it(`${table} migration enables RLS and revokes all client roles (deny-by-default authored at creation)`, () => {
      const sql = MIGRATIONS.get(table);
      expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`);
      expect(sql).toContain(`REVOKE ALL ON public.${table} FROM anon, authenticated;`);
    });

    it(`${table} migration authors NO policy statement (zero policies IS the posture)`, () => {
      const sql = MIGRATIONS.get(table);
      expect(sql).not.toMatch(new RegExp(`CREATE POLICY[\\s\\S]{0,400}ON\\s+public\\.${table}\\b`));
    });

    it(`${table} rollback is the genuine inverse (drops the table)`, () => {
      const rollback = read(ADJUDICATED.find((a) => a.table === table)!.rollback);
      expect(rollback).toContain(`DROP TABLE IF EXISTS public.${table};`);
    });
  }
});

describe("H3-035 posture adjudication — battery scope holds each table as zero-policy", () => {
  it("the resolved registry contains exactly one entry per adjudicated table (no duplicate declarations)", () => {
    for (const { table } of ADJUDICATED) {
      const matches = REGISTRY.tables.filter((t) => t.name === table);
      expect(matches).toHaveLength(1);
    }
  });

  for (const { table, expectedSource } of ADJUDICATED) {
    it(`${table} resolves to zero-policy (postureSource=${expectedSource}) with the cited source migration`, () => {
      const entry = registryEntry(table);
      const expected = ADJUDICATED.find((a) => a.table === table)!;
      expect(entry.posture).toBe("zero-policy");
      expect(entry.postureSource).toBe(expectedSource);
      expect(entry.source).toBe(expected.migration.split("/").pop());
    });

    it(`${table} satisfies the battery's zero-policy entry law: zero policies, no FORCE expectation`, () => {
      const entry = registryEntry(table);
      // Built-in canonical entries carry no policies key at all; the battery's
      // validator normalizes both shapes to the empty policy set.
      expect(entry.policies ?? []).toEqual([]);
      expect(entry.forceRls ?? false).toBe(false);
      expect(entry.tenantColumn).toBeUndefined();
      expect(entry.probeSeedRows).toBeUndefined();
      expect(entry.probeInsertPayload).toBeUndefined();
      // validatePostureEntry is the battery's fail-closed gate — a zero-policy
      // entry must re-validate without error and preserve its posture.
      const revalidated = battery.validatePostureEntry(entry, "h3-035-revalidation");
      expect(revalidated.posture).toBe("zero-policy");
      expect(revalidated.policies).toEqual([]);
    });

    it(`${table} carries provenance per AGENTS §12 (source + postureSource recorded)`, () => {
      const entry = registryEntry(table);
      expect(typeof entry.source).toBe("string");
      expect(entry.source.length).toBeGreaterThan(0);
      expect(entry.postureSource).toBeDefined();
    });
  }

  it("the built-in canonical registry declares cg_memory_access_log zero-policy (and the posture files do not re-declare it)", () => {
    const builtin = battery.BUILTIN_TABLE_POSTURES.find((t) => t.name === "cg_memory_access_log");
    expect(builtin?.posture).toBe("zero-policy");
    expect(builtin?.source).toBe("20261002000004_coregrid_v1_memory_tier.sql");
    for (const file of postureFiles) {
      expect(file.entries.find((e) => e.name === "cg_memory_access_log")).toBeUndefined();
    }
  });

  it("the substrate posture file lists the two H2-04 tables in batteryExpectations.zeroPolicyTables", () => {
    const substrate = JSON.parse(read("scripts/verification/rls-table-postures-substrate.json")) as {
      batteryExpectations: { zeroPolicyTables: string[] };
    };
    expect(substrate.batteryExpectations.zeroPolicyTables).toContain("cg_reconciliation_verdict");
    expect(substrate.batteryExpectations.zeroPolicyTables).toContain("cg_event_security");
  });
});

describe("H3-035 posture adjudication — decision docs are internally consistent with the registry", () => {
  for (const { table, decisionDoc } of ADJUDICATED) {
    it(`${decisionDoc} exists and adjudicates zero-policy-by-design`, () => {
      const docPath = join(ROOT, decisionDoc);
      expect(existsSync(docPath)).toBe(true);
      const doc = read(decisionDoc);
      expect(doc).toContain(`# Posture Adjudication — \`${table}\` (H3-035)`);
      expect(doc).toContain("ZERO-POLICY BY DESIGN — CONFIRMED");
      expect(doc).toContain("## OWNERSHIP");
      expect(doc).toContain("## EVIDENCE");
      expect(doc).toContain("## DECISION");
      expect(doc).toContain("## RATIONALE");
      expect(doc).toContain("## CONSTITUTION SECTIONS");
      expect(doc).toContain("## PROPOSED-POLICY-IF-ANY");
    });

    it(`${decisionDoc} cites the same creating migration and posture source as the registry`, () => {
      const doc = read(decisionDoc);
      const entry = registryEntry(table);
      expect(doc).toContain(entry.source);
      expect(doc).toContain(entry.postureSource!);
    });
  }

  it("no decision doc proposes an applied change (adjudication applies nothing)", () => {
    for (const { decisionDoc } of ADJUDICATED) {
      const doc = read(decisionDoc);
      expect(doc).toMatch(/nothing is pre-authored|pre-authors? nothing/i);
      expect(doc).not.toMatch(/CREATE POLICY\s+\w+\s+ON\s+public\./);
    }
  });
});