/**
 * MH-08 — retention-schema lockstep proof.
 *
 * Before MH-08 the retention policy schedule schema and the ADR-005 gate
 * invariants lived in TWO places (scripts/verify-retention-schedule.mjs and
 * frontend/src/lib/governance/retention-policy-schedule.ts) that had to be
 * changed in lockstep — a standing drift risk. The single canonical home is
 * now frontend/src/lib/governance/retention-policy-schema.mjs (plain ESM so
 * the offline gate script can import it); the TS contract module is a thin
 * typed wrapper over it.
 *
 * This suite proves the lockstep structurally, on fixture schedules:
 *   1. the TS wrapper re-exports the .mjs module's runtime values BY IDENTITY
 *      (a re-implementation anywhere would fail these assertions);
 *   2. both import paths agree on schema acceptance and invariant verdicts
 *      (code-for-code, order-for-order) across a matrix of fixture mutations;
 *   3. `node scripts/verify-retention-schedule.mjs` still exits 0 on the
 *      shipped schedule and 1 on an unpoliced personal-data-bearing family.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { RetentionPolicySchedule, ScheduleValidationResult } from "../../frontend/src/lib/governance/retention-policy-schedule";

// @ts-expect-error — MH-08: the canonical schema module is deliberately plain ESM with no .d.mts (the offline gate script shares this exact module); its members are exercised below as the runtime single source.
import * as schemaMjs from "../../frontend/src/lib/governance/retention-policy-schema.mjs";
import * as contract from "../../frontend/src/lib/governance/retention-policy-schedule";

const ROOT = join(import.meta.dirname, "..", "..");
const GATE_SCRIPT = join(ROOT, "scripts", "verify-retention-schedule.mjs");
const SCHEDULE_PATH = join(
  ROOT,
  "architecture",
  "coregrid-mvp-architecture",
  "RETENTION_POLICY_SCHEDULE.json",
);

const shippedJson: unknown = JSON.parse(readFileSync(SCHEDULE_PATH, "utf8"));

function fixture(mutate: (schedule: RetentionPolicySchedule) => void): RetentionPolicySchedule {
  const schedule = structuredClone(shippedJson) as RetentionPolicySchedule;
  mutate(schedule);
  return schedule;
}

/**
 * Runs BOTH import paths (plain .mjs and TS wrapper) over one fixture and
 * asserts identical schema verdicts and identical gate results.
 */
function assertLockstep(name: string, fixtureSchedule: unknown): ScheduleValidationResult | null {
  const viaMjs = schemaMjs.retentionPolicyScheduleSchema.safeParse(fixtureSchedule);
  const viaTs = contract.retentionPolicyScheduleSchema.safeParse(fixtureSchedule);

  expect(viaTs.success, `${name}: schema verdict parity`).toBe(viaMjs.success);
  if (!viaMjs.success) return null;

  const mjsResult = schemaMjs.validateRetentionPolicySchedule(viaMjs.data);
  const tsResult = contract.validateRetentionPolicySchedule((viaTs as { data: RetentionPolicySchedule }).data);

  expect(JSON.stringify(tsResult.issues), `${name}: issue parity (JSON)`).toBe(
    JSON.stringify(mjsResult.issues),
  );
  expect(tsResult, `${name}: full result parity`).toEqual(mjsResult);
  return tsResult;
}

describe("MH-08: single-source retention schema lockstep", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "mh08-retention-lockstep-"));
  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("the TS wrapper re-exports the plain-ESM module's runtime surface by identity", () => {
    expect(contract.retentionPolicyScheduleSchema).toBe(schemaMjs.retentionPolicyScheduleSchema);
    expect(contract.retentionPolicyEntrySchema).toBe(schemaMjs.retentionPolicyEntrySchema);
    expect(contract.recordFamilyInventoryEntrySchema).toBe(
      schemaMjs.recordFamilyInventoryEntrySchema,
    );
    expect(contract.validateRetentionPolicySchedule).toBe(
      schemaMjs.validateRetentionPolicySchedule,
    );
    expect(contract.parseRetentionPolicySchedule).toBe(schemaMjs.parseRetentionPolicySchedule);
    expect(contract.DATA_CLASSIFICATIONS).toBe(schemaMjs.DATA_CLASSIFICATIONS);
    expect(contract.TENANT_CLASSES).toBe(schemaMjs.TENANT_CLASSES);
    expect(contract.RETENTION_KINDS).toBe(schemaMjs.RETENTION_KINDS);
    expect(contract.LAWFUL_BASES).toBe(schemaMjs.LAWFUL_BASES);
    expect(contract.ERASURE_MECHANISMS).toBe(schemaMjs.ERASURE_MECHANISMS);
  });

  it("accepts the shipped schedule identically via both import paths", () => {
    const result = assertLockstep("shipped schedule", shippedJson);
    expect(result).not.toBeNull();
    expect(result?.ok).toBe(true);
    expect(result?.issues).toEqual([]);
  });

  it("flags an unpoliced personal-data-bearing family identically (ADR-005 V1-minimal gate)", () => {
    const unpoliced = fixture((s) => {
      const family = s.recordFamilyInventory.find((f) => f.family === "ai-snapshot");
      expect(family).toBeDefined();
      family!.policyId = null;
    });
    const result = assertLockstep("unpoliced family", unpoliced);
    expect(result?.ok).toBe(false);
    expect(result?.issues.map((i) => i.code)).toContain("FAMILY_WITHOUT_POLICY");
  });

  it("flags classification mismatch identically", () => {
    const mismatched = fixture((s) => {
      const family = s.recordFamilyInventory.find((f) => f.family === "ai-snapshot");
      expect(family?.defaultDataClassification).toBe("personal");
      family!.defaultDataClassification = "restricted";
    });
    const result = assertLockstep("classification mismatch", mismatched);
    expect(result?.issues.map((i) => i.code)).toContain("CLASSIFICATION_MISMATCH");
  });

  it("flags duplicate policyIds identically", () => {
    const duplicated = fixture((s) => {
      s.policies.push(structuredClone(s.policies[0]!));
    });
    const result = assertLockstep("duplicate policy id", duplicated);
    expect(result?.issues.map((i) => i.code)).toContain("DUPLICATE_POLICY_ID");
  });

  it("flags non-tombstone erasure on immutable families identically", () => {
    const mutated = fixture((s) => {
      const policy = s.policies.find((p) => p.policyId === "RP-AUDIT-EDU");
      expect(policy).toBeDefined();
      policy!.erasure.mechanism = "crypto-shred";
    });
    const result = assertLockstep("immutable non-tombstone", mutated);
    expect(result?.issues.map((i) => i.code)).toContain("IMMUTABLE_FAMILY_NON_TOMBSTONE");
    expect(result?.issues.map((i) => i.code)).toContain("CRYPTO_SHRED_NOT_DESIGNATED");
  });

  it("accepts crypto-shred on a designated shred-class family identically", () => {
    const designated = fixture((s) => {
      const family = s.recordFamilyInventory.find((f) => f.family === "biometric-reference");
      expect(family?.cryptoShredCandidate).toBe(true);
      const policy = s.policies.find((p) => p.policyId === family?.policyId);
      expect(policy).toBeDefined();
      policy!.erasure.mechanism = "crypto-shred";
    });
    const result = assertLockstep("designated crypto-shred", designated);
    expect(result?.ok).toBe(true);
  });

  it("flags policies targeting unknown families identically", () => {
    const ghost = fixture((s) => {
      s.policies.push({ ...structuredClone(s.policies[0]!), policyId: "RP-GHOST-EDU", recordFamily: "ghost-family" });
    });
    const result = assertLockstep("policy for unknown family", ghost);
    expect(result?.issues.map((i) => i.code)).toContain("POLICY_FOR_UNKNOWN_FAMILY");
  });

  it("flags non-personal-data-bearing families carrying a policyId identically", () => {
    const policed = fixture((s) => {
      const family = s.recordFamilyInventory.find((f) => f.family === "governance-config");
      expect(family?.personalDataBearing).toBe(false);
      family!.policyId = "RP-GOVCFG-EDU";
    });
    const result = assertLockstep("non-pdb family with policy", policed);
    expect(result?.issues.map((i) => i.code)).toContain("NON_PDB_FAMILY_WITH_POLICY");
  });

  it("rejects families without table provenance identically (schema-enforced floor)", () => {
    // The Zod schema itself requires tables.min(1) — the gate's
    // FAMILY_WITHOUT_TABLES check is a defensive backstop below the schema
    // floor, so a table-less family must fail SCHEMA validation on both paths.
    const noTables = fixture((s) => {
      const family = s.recordFamilyInventory.find((f) => f.family === "communication");
      family!.tables = [];
    });
    const result = assertLockstep("family without tables", noTables);
    expect(result).toBeNull();
  });

  it("rejects schema-invalid schedules identically", () => {
    assertLockstep("bad schemaVersion", fixture((s) => { s.meta.schemaVersion = "1.0"; }));
    assertLockstep(
      "unknown data classification",
      fixture((s) => {
        (s.policies[0] as unknown as { dataClassification: string }).dataClassification = "secret";
      }),
    );
  });

  it("the offline gate script exits 0 on the shipped schedule", () => {
    const run = spawnSync(process.execPath, [GATE_SCRIPT, SCHEDULE_PATH], { encoding: "utf8" });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("PASS");
  });

  it("the offline gate script exits 1 on an unpoliced family, via the shared schema", () => {
    const unpoliced = fixture((s) => {
      const family = s.recordFamilyInventory.find((f) => f.family === "identity-profile");
      expect(family).toBeDefined();
      family!.policyId = null;
    });
    const path = join(tmpDir, "unpoliced-schedule.json");
    writeFileSync(path, JSON.stringify(unpoliced));

    const run = spawnSync(process.execPath, [GATE_SCRIPT, path], { encoding: "utf8" });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("FAIL");
    expect(run.stderr).toContain("FAMILY_WITHOUT_POLICY");
  });
});
