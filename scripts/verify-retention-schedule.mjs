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
 * This script is that gate. It validates
 * architecture/coregrid-mvp-architecture/RETENTION_POLICY_SCHEDULE.json
 * against the Zod contract (mirrored in the typed contract module
 * frontend/src/lib/governance/retention-policy-schedule.ts — the script cannot
 * import TypeScript, so the invariants live in BOTH files and must change in
 * lockstep) and enforces:
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
import { z } from "zod";

const root = fileURLToPath(new URL("..", import.meta.url));
const defaultSchedulePath = join(
  root,
  "architecture",
  "coregrid-mvp-architecture",
  "RETENTION_POLICY_SCHEDULE.json",
);
const schedulePath = process.argv[2] ?? defaultSchedulePath;

// ---------------------------------------------------------------------------
// Contract (mirror of frontend/src/lib/governance/retention-policy-schedule.ts)
// ---------------------------------------------------------------------------
const DATA_CLASSIFICATIONS = ["public", "internal", "restricted", "personal", "special-category"];
const TENANT_CLASSES = ["education-institution", "organization", "platform"];
const RETENTION_KINDS = ["duration", "event-triggered"];
const LAWFUL_BASES = [
  "consent",
  "explicit-consent",
  "contract",
  "legal-obligation",
  "legitimate-interests",
  "public-task",
];
const ERASURE_MECHANISMS = ["tombstone", "crypto-shred"];

const enumValuesSchema = z.string().min(1);

const retentionPolicyEntrySchema = z.strictObject({
  policyId: z.string().regex(/^RP-[A-Z0-9-]+$/),
  recordFamily: z.string().min(1).max(64),
  dataClassification: z.enum(DATA_CLASSIFICATIONS),
  tenantClass: z.enum(TENANT_CLASSES),
  retention: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("duration"),
      retentionDays: z.number().int().positive(),
      clock: z.string().min(1).max(64),
      notes: z.string().max(2000).optional(),
    }),
    z.strictObject({
      kind: z.literal("event-triggered"),
      trigger: z.string().min(1).max(128),
      maxRetentionDays: z.number().int().positive(),
      notes: z.string().max(2000).optional(),
    }),
  ]),
  lawfulBasis: z.enum(LAWFUL_BASES),
  erasure: z.object({
    mechanism: z.enum(ERASURE_MECHANISMS),
    scope: z.string().min(1),
    redactionPlaceholder: z.string().min(1),
  }),
  downstreamAggregation: z.object({
    required: z.boolean(),
    obligation: z.string().min(1),
  }),
});

const recordFamilyInventoryEntrySchema = z.strictObject({
  family: z.string().min(1).max(64),
  description: z.string().min(1),
  personalDataBearing: z.boolean(),
  immutable: z.boolean(),
  defaultDataClassification: z.enum(DATA_CLASSIFICATIONS),
  policyId: z.string().min(1).nullable(),
  cryptoShredCandidate: z.boolean().optional(),
  personalValues: z.array(z.string().min(1)),
  tables: z
    .array(
      z.strictObject({
        table: z.string().min(1).max(128),
        source: z.string().min(1).max(200),
      }),
    )
    .min(1),
  tombstoneInvariant: z.string().min(1),
});

const scheduleSchema = z.strictObject({
  meta: z.strictObject({
    document: z.string().min(1),
    capability: z.string().min(1),
    adr: z.string().min(1),
    scheduleRequirement: z.string().min(1),
    schemaVersion: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/),
    authoredOn: z.string().min(1),
    authoredBy: z.string().min(1),
    validationGate: z.strictObject({
      script: z.string().min(1),
      command: z.string().min(1),
      contractModule: z.string().min(1),
      gate: z.string().min(1),
      exitCodes: z.record(z.string(), enumValuesSchema),
      determinism: z.string().min(1),
    }),
    owners: z.record(z.string(), z.string().min(1)),
    provenance: z.strictObject({
      authority: z.string().min(1),
      method: z.string().min(1),
      durationStatus: z.string().min(1),
      crossTenantErasure: z.string().min(1),
    }),
    reconciliationModel: z.strictObject({
      mechanism: z.string().min(1),
      erasureEvent: z.string().min(1),
      verificationInvariant: z.string().min(1),
      neverForgotten: z.string().min(1),
      forgotten: z.string().min(1),
    }),
  }),
  vocabularies: z.strictObject({
    dataClassification: z.strictObject({ values: z.array(z.enum(DATA_CLASSIFICATIONS)), notes: z.string().min(1) }),
    tenantClass: z.strictObject({ values: z.array(z.enum(TENANT_CLASSES)), notes: z.string().min(1) }),
    retentionKind: z.strictObject({ values: z.array(z.enum(RETENTION_KINDS)), notes: z.string().min(1) }),
    lawfulBasis: z.strictObject({ values: z.array(z.enum(LAWFUL_BASES)), notes: z.string().min(1) }),
    erasureMechanism: z.strictObject({ values: z.array(z.enum(ERASURE_MECHANISMS)), notes: z.string().min(1) }),
  }),
  policies: z.array(retentionPolicyEntrySchema),
  recordFamilyInventory: z.array(recordFamilyInventoryEntrySchema),
  summary: z.strictObject({
    policyCount: z.number().int().nonnegative(),
    recordFamilyCount: z.number().int().nonnegative(),
    personalDataBearingFamilies: z.number().int().nonnegative(),
    nonPersonalDataBearingFamilies: z.number().int().nonnegative(),
    erasureMechanismDistribution: z.record(z.string(), z.number().int().nonnegative()),
    cryptoShredCandidates: z.array(z.string()),
    gate: z.string().min(1),
  }),
});

// ---------------------------------------------------------------------------
// Gate invariants
// ---------------------------------------------------------------------------
function gateIssues(schedule) {
  const issues = [];

  const familyEntries = new Map(schedule.recordFamilyInventory.map((f) => [f.family, f]));
  const policiesByFamily = new Map();
  const policyIds = new Set();

  for (const policy of schedule.policies) {
    if (policyIds.has(policy.policyId)) {
      issues.push(["DUPLICATE_POLICY_ID", `policyId ${policy.policyId} appears more than once`]);
    }
    policyIds.add(policy.policyId);
    const list = policiesByFamily.get(policy.recordFamily) ?? [];
    list.push(policy);
    policiesByFamily.set(policy.recordFamily, list);
  }

  for (const family of schedule.recordFamilyInventory) {
    if (family.personalDataBearing) {
      // THE ADR-005 V1-minimal gate.
      if (!family.policyId) {
        issues.push([
          "FAMILY_WITHOUT_POLICY",
          `personal-data-bearing family "${family.family}" has no policyId reference (ADR-005 V1-minimal gate)`,
        ]);
        continue;
      }
      const candidates = policiesByFamily.get(family.family) ?? [];
      const matched = candidates.find((p) => p.policyId === family.policyId);
      if (!matched) {
        issues.push([
          "UNRESOLVABLE_POLICY_REFERENCE",
          `family "${family.family}" references policyId "${family.policyId}" which does not resolve to a policy of that family`,
        ]);
        continue;
      }
      if (matched.dataClassification !== family.defaultDataClassification) {
        issues.push([
          "CLASSIFICATION_MISMATCH",
          `family "${family.family}" declares defaultDataClassification "${family.defaultDataClassification}" but policy ${matched.policyId} declares "${matched.dataClassification}"`,
        ]);
      }
    } else if (family.policyId !== null) {
      issues.push([
        "NON_PDB_FAMILY_WITH_POLICY",
        `non-personal-data-bearing family "${family.family}" must not carry a policyId`,
      ]);
    }

    const familyPolicies = policiesByFamily.get(family.family) ?? [];
    for (const policy of familyPolicies) {
      if (family.immutable && policy.erasure.mechanism !== "tombstone") {
        issues.push([
          "IMMUTABLE_FAMILY_NON_TOMBSTONE",
          `immutable family "${family.family}" policy ${policy.policyId} declares erasure mechanism "${policy.erasure.mechanism}" — immutable records are tombstoned, never deleted (ADR-005 Option 2)`,
        ]);
      }
      if (policy.erasure.mechanism === "crypto-shred" && family.cryptoShredCandidate !== true) {
        issues.push([
          "CRYPTO_SHRED_NOT_DESIGNATED",
          `policy ${policy.policyId} declares crypto-shred but family "${family.family}" is not a designated shred-class (ADR-005: designation requires an explicit operator ruling)`,
        ]);
      }
    }

    if (family.tables.length === 0) {
      issues.push(["FAMILY_WITHOUT_TABLES", `family "${family.family}" declares no tables (provenance requires sources)`]);
    }
  }

  for (const policy of schedule.policies) {
    if (!familyEntries.has(policy.recordFamily)) {
      issues.push([
        "POLICY_FOR_UNKNOWN_FAMILY",
        `policy ${policy.policyId} targets family "${policy.recordFamily}" which is absent from recordFamilyInventory`,
      ]);
    }
  }

  return issues;
}

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

const schemaResult = scheduleSchema.safeParse(parsedJson);
if (!schemaResult.success) {
  console.error("FAIL schema validation of the retention policy schedule:");
  for (const problem of schemaResult.error.issues) {
    console.error(`  SCHEMA ${problem.path.join(".")}: ${problem.message}`);
  }
  process.exit(1);
}
const schedule = schemaResult.data;

const issues = gateIssues(schedule);
if (issues.length > 0) {
  console.error("FAIL ADR-005 gate/structure violations:");
  for (const [code, detail] of issues) {
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