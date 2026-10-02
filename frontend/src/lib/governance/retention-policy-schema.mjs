/**
 * CoreGrid — V1CAP-066 retention policy schedule: SINGLE-SOURCE contract schema
 * (MH-08; ADR-005_RETENTION_VS_IMMUTABLE_AUDIT.md, "Retention schedule requirement").
 *
 * This module is the ONE canonical home of the schedule's schema and the ADR-005
 * gate invariants, in plain JavaScript so that every consumer — including
 * `scripts/verify-retention-schedule.mjs` (which cannot import TypeScript) —
 * executes the identical rules. There is NO mirrored copy:
 *
 *   - `scripts/verify-retention-schedule.mjs` imports this module directly.
 *   - `frontend/src/lib/governance/retention-policy-schedule.ts` is a thin typed
 *     wrapper that re-exports this module's runtime surface and re-anchors the
 *     strict TypeScript types for TS consumers.
 *
 * Before MH-08 the schema and invariants lived in BOTH the gate script and the
 * typed contract module and had to be changed in lockstep — a standing drift
 * risk. Any change to an invariant now lands HERE and is picked up everywhere.
 *
 * ADR-005 laws encoded (see the typed contract module's docblock for the full
 * statement):
 * - Erasure mechanism is tombstone (Option 2: redaction-with-tombstone) by
 *   default; `crypto-shred` is valid ONLY on inventory families explicitly
 *   flagged `cryptoShredCandidate` AND designated by the operator — no family
 *   is designated in V1.
 * - Immutable record families may NEVER declare a mechanism other than
 *   tombstone: immutable records are tombstoned, never deleted or mutated.
 * - Every personal-data-bearing record family MUST reference a policy ID that
 *   resolves to a policy entry for the same family and classification — the
 *   ADR-005 V1-minimal gate.
 * - Non-personal-data-bearing families carry no policyId; policyIds are unique;
 *   every policy targets a declared family.
 *
 * Boundary: pure data + pure functions. No I/O, no vendor, no wall-clock.
 * Dependencies: `zod` only (the shared contract vocabulary of both the gate
 * script and the typed contract); no build step, runs directly under `node`.
 */

import { z } from "zod";

/* ─────────────────────────────────────────────────────────────
 * Controlled vocabularies (must stay aligned with the JSON
 * artifact's `vocabularies` block)
 * ────────────────────────────────────────────────────────────*/

/** @typedef {"public"|"internal"|"restricted"|"personal"|"special-category"} DataClassification */
/** @typedef {"education-institution"|"organization"|"platform"} TenantClass */
/** @typedef {"duration"|"event-triggered"} RetentionKind */
/** @typedef {"consent"|"explicit-consent"|"contract"|"legal-obligation"|"legitimate-interests"|"public-task"} LawfulBasis */
/** @typedef {"tombstone"|"crypto-shred"} ErasureMechanism */

export const DATA_CLASSIFICATIONS = [
  "public",
  "internal",
  "restricted",
  "personal",
  "special-category",
];

export const TENANT_CLASSES = [
  "education-institution",
  "organization",
  "platform",
];

export const RETENTION_KINDS = ["duration", "event-triggered"];

export const LAWFUL_BASES = [
  "consent",
  "explicit-consent",
  "contract",
  "legal-obligation",
  "legitimate-interests",
  "public-task",
];

export const ERASURE_MECHANISMS = ["tombstone", "crypto-shred"];

/* ─────────────────────────────────────────────────────────────
 * Schemas
 * ────────────────────────────────────────────────────────────*/

const erasureSpecSchema = z.object({
  mechanism: z.enum(ERASURE_MECHANISMS),
  scope: z.string().min(1),
  redactionPlaceholder: z.string().min(1),
});

const downstreamAggregationSchema = z.object({
  required: z.boolean(),
  obligation: z.string().min(1),
});

export const retentionPolicyEntrySchema = z.strictObject({
  policyId: z
    .string()
    .regex(/^RP-[A-Z0-9-]+$/, "policyId must match RP-<FAMILY/SCOPE>-<TENANT>"),
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
  erasure: erasureSpecSchema,
  downstreamAggregation: downstreamAggregationSchema,
});

export const recordFamilyInventoryEntrySchema = z.strictObject({
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

export const retentionPolicyScheduleSchema = z.strictObject({
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
      exitCodes: z.record(z.string(), z.string()),
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
    dataClassification: z.strictObject({
      values: z.array(z.enum(DATA_CLASSIFICATIONS)),
      notes: z.string().min(1),
    }),
    tenantClass: z.strictObject({
      values: z.array(z.enum(TENANT_CLASSES)),
      notes: z.string().min(1),
    }),
    retentionKind: z.strictObject({
      values: z.array(z.enum(RETENTION_KINDS)),
      notes: z.string().min(1),
    }),
    lawfulBasis: z.strictObject({
      values: z.array(z.enum(LAWFUL_BASES)),
      notes: z.string().min(1),
    }),
    erasureMechanism: z.strictObject({
      values: z.array(z.enum(ERASURE_MECHANISMS)),
      notes: z.string().min(1),
    }),
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

/* ─────────────────────────────────────────────────────────────
 * ADR-005 invariants (pure)
 * ────────────────────────────────────────────────────────────*/

/**
 * @typedef {{ readonly code: string, readonly detail: string }} ScheduleValidationIssue
 * @typedef {{ readonly ok: boolean, readonly issues: readonly ScheduleValidationIssue[] }} ScheduleValidationResult
 */

/**
 * The ADR-005 V1-minimal gate plus the schedule's structural invariants.
 * Deterministic and offline: operates purely on the parsed schedule value.
 *
 * @param {import("zod").infer<typeof retentionPolicyScheduleSchema>} schedule
 * @returns {ScheduleValidationResult}
 */
export function validateRetentionPolicySchedule(schedule) {
  /** @type {ScheduleValidationIssue[]} */
  const issues = [];

  const familyEntries = new Map(schedule.recordFamilyInventory.map((f) => [f.family, f]));
  const policiesByFamily = new Map();
  const policyIds = new Set();

  for (const policy of schedule.policies) {
    if (policyIds.has(policy.policyId)) {
      issues.push({
        code: "DUPLICATE_POLICY_ID",
        detail: `policyId ${policy.policyId} appears more than once`,
      });
    }
    policyIds.add(policy.policyId);
    const list = policiesByFamily.get(policy.recordFamily) ?? [];
    list.push(policy);
    policiesByFamily.set(policy.recordFamily, list);
  }

  for (const family of schedule.recordFamilyInventory) {
    if (family.personalDataBearing) {
      // THE gate: every personal-data-bearing family must reference a policy.
      if (!family.policyId) {
        issues.push({
          code: "FAMILY_WITHOUT_POLICY",
          detail: `personal-data-bearing family "${family.family}" has no policyId reference (ADR-005 V1-minimal gate)`,
        });
        continue;
      }
      const candidates = policiesByFamily.get(family.family) ?? [];
      const matched = candidates.find((p) => p.policyId === family.policyId);
      if (!matched) {
        issues.push({
          code: "UNRESOLVABLE_POLICY_REFERENCE",
          detail: `family "${family.family}" references policyId "${family.policyId}" which does not resolve to a policy of that family`,
        });
        continue;
      }
      if (matched.dataClassification !== family.defaultDataClassification) {
        issues.push({
          code: "CLASSIFICATION_MISMATCH",
          detail: `family "${family.family}" declares defaultDataClassification "${family.defaultDataClassification}" but policy ${matched.policyId} declares "${matched.dataClassification}"`,
        });
      }
    } else if (family.policyId !== null) {
      issues.push({
        code: "NON_PDB_FAMILY_WITH_POLICY",
        detail: `non-personal-data-bearing family "${family.family}" must not carry a policyId`,
      });
    }

    const familyPolicies = policiesByFamily.get(family.family) ?? [];
    for (const policy of familyPolicies) {
      if (family.immutable && policy.erasure.mechanism !== "tombstone") {
        issues.push({
          code: "IMMUTABLE_FAMILY_NON_TOMBSTONE",
          detail: `immutable family "${family.family}" policy ${policy.policyId} declares erasure mechanism "${policy.erasure.mechanism}" — immutable records are tombstoned, never deleted (ADR-005 Option 2)`,
        });
      }
      if (policy.erasure.mechanism === "crypto-shred" && family.cryptoShredCandidate !== true) {
        issues.push({
          code: "CRYPTO_SHRED_NOT_DESIGNATED",
          detail: `policy ${policy.policyId} declares crypto-shred but family "${family.family}" is not a designated shred-class (ADR-005: designation requires an explicit operator ruling)`,
        });
      }
    }

    if (family.tables.length === 0) {
      issues.push({
        code: "FAMILY_WITHOUT_TABLES",
        detail: `family "${family.family}" declares no tables (provenance requires sources)`,
      });
    }
  }

  for (const policy of schedule.policies) {
    if (!familyEntries.has(policy.recordFamily)) {
      issues.push({
        code: "POLICY_FOR_UNKNOWN_FAMILY",
        detail: `policy ${policy.policyId} targets family "${policy.recordFamily}" which is absent from recordFamilyInventory`,
      });
    }
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Parse-and-validate helper for consumers loading the JSON artifact.
 *
 * @param {unknown} input
 * @returns {import("zod").infer<typeof retentionPolicyScheduleSchema>}
 */
export function parseRetentionPolicySchedule(input) {
  const schedule = retentionPolicyScheduleSchema.parse(input);
  const result = validateRetentionPolicySchedule(schedule);
  if (!result.ok) {
    const detail = result.issues.map((i) => `${i.code}: ${i.detail}`).join("; ");
    throw new Error(`retention policy schedule failed ADR-005 gate: ${detail}`);
  }
  return schedule;
}
