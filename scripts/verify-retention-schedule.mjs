#!/usr/bin/env node
/**
 * V1CAP-066 / ADR-005 — retention policy schedule validation gate.
 *
 * ADR-005_RETENTION_VS_IMMUTABLE_AUDIT.md ("Retention schedule requirement")
 * makes a machine-readable retention policy schedule binding on the V1CAP-066
 * contract and fixes the V1-minimal gate: "Every personal-data-bearing record
 * family must reference a policy ID; records without a policy ID are a
 * validation failure."
 *
 * This script is that gate. It imports the schema and the ADR-005 invariants
 * from the SINGLE-SOURCE plain-ESM contract module
 * `frontend/src/lib/governance/retention-policy-schema.mjs` (MH-08 — the one
 * canonical home of the schedule schema; the typed contract module
 * `frontend/src/lib/governance/retention-policy-schedule.ts` is a thin typed
 * wrapper over the same module, so the runtime rules exist exactly once) and
 * enforces:
 *
 *   GATE  every recordFamilyInventory entry with personalDataBearing: true
 *         must reference a policyId that resolves to a policy entry of the
 *         same recordFamily (and a compatible classification). Any miss is a
 *         validation FAILURE (exit 1).
 *
 *   Plus the structural ADR-005 invariants:
 *     - immutable families may only declare the tombstone mechanism (immutable
 *       records are tombstoned, never deleted or mutated);
 *     - crypto-shred is only valid where the inventory family is a designated
 *       shred-class (cryptoShredCandidate) — none exist in V1 without an
 *       explicit operator ruling;
 *     - policyIds are unique; every policy targets a declared family;
 *       non-personal-data-bearing families carry no policyId.
 *
 * Deterministic and offline: no database, no network, no wall-clock inputs.
 *
 * Exit codes:
 *   0  schedule valid — the ADR-005 gate holds
 *   1  schema validation or gate failure (printed as labeled issues)
 *
 * Usage: node scripts/verify-retention-schedule.mjs [path-to-schedule-json]
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  retentionPolicyScheduleSchema,
  validateRetentionPolicySchedule,
} from "../frontend/src/lib/governance/retention-policy-schema.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const defaultSchedulePath = join(
  root,
  "architecture",
  "coregrid-mvp-architecture",
  "RETENTION_POLICY_SCHEDULE.json",
);
const schedulePath = process.argv[2] ?? defaultSchedulePath;

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
let raw;
try {
  raw = readFileSync(schedulePath, "utf8");
} catch (error) {
  console.error(`FAIL cannot read schedule artifact: ${schedulePath} (${error.message})`);
  process.exit(1);
}

let parsedJson;
try {
  parsedJson = JSON.parse(raw);
} catch (error) {
  console.error(`FAIL schedule artifact is not valid JSON: ${error.message}`);
  process.exit(1);
}

const schemaResult = retentionPolicyScheduleSchema.safeParse(parsedJson);
if (!schemaResult.success) {
  console.error("FAIL schema validation of the retention policy schedule:");
  for (const problem of schemaResult.error.issues) {
    console.error(`  SCHEMA ${problem.path.join(".")}: ${problem.message}`);
  }
  process.exit(1);
}
const schedule = schemaResult.data;

const { ok, issues } = validateRetentionPolicySchedule(schedule);
if (!ok) {
  console.error("FAIL ADR-005 gate/structure violations:");
  for (const { code, detail } of issues) {
    console.error(`  ${code}: ${detail}`);
  }
  console.error(
    `gate: every personal-data-bearing record family must reference a resolvable policyId — ${issues.length} violation(s). Exiting 1.`,
  );
  process.exit(1);
}

const pdbCount = schedule.recordFamilyInventory.filter((f) => f.personalDataBearing).length;
const immutableCount = schedule.recordFamilyInventory.filter((f) => f.immutable).length;
console.log(
  `PASS ${schedulePath} — schemaVersion ${schedule.meta.schemaVersion}; ` +
    `${schedule.policies.length} policies over ${schedule.recordFamilyInventory.length} record families ` +
    `(${pdbCount} personal-data-bearing, ${immutableCount} immutable, all tombstone-erased); ` +
    `ADR-005 V1-minimal gate holds: every personal-data-bearing family references a resolvable policy ID.`,
);
process.exit(0);
