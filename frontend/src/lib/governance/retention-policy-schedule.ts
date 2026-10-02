/**
 * CoreGrid — V1CAP-066 retention policy schedule typed contract
 * (ADR-005_RETENTION_VS_IMMUTABLE_AUDIT.md, "Retention schedule requirement").
 *
 * ADR-005 makes a machine-readable retention policy schedule binding on the
 * V1CAP-066 contract, keyed by data classification, tenant class, and record
 * family. This module is that schedule's typed contract: the Zod schemas, the
 * derived types, and the ADR-005 invariants as pure functions. The canonical
 * data artifact is
 * `architecture/coregrid-mvp-architecture/RETENTION_POLICY_SCHEDULE.json`;
 * its standalone offline validation gate is
 * `scripts/verify-retention-schedule.mjs` (which mirrors the invariants here —
 * the script cannot import TypeScript, so the two must be kept in lockstep;
 * any change to an invariant lands in BOTH files in the same commit).
 *
 * Laws encoded structurally (ADR-005):
 * - Erasure mechanism is tombstone (Option 2: redaction-with-tombstone) by
 *   default; `crypto-shred` is valid ONLY on inventory families explicitly
 *   flagged `cryptoShredCandidate` AND designated by the operator — no family
 *   is designated in V1.
 * - Immutable record families (audit/event/memory/evidence/kernel-object
 *   append-only substrates) may NEVER declare a mechanism other than
 *   tombstone: immutable records are tombstoned, never deleted or mutated.
 * - Every personal-data-bearing record family MUST reference a policy ID that
 *   resolves to a policy entry for the same family and classification.
 *   A family without a resolvable policy reference is a validation failure —
 *   this is the ADR-005 V1-minimal gate.
 * - Downstream aggregation obligations are declared per policy; aggregates
 *   are Intelligence, never Reality (Constitution §9) — they may supplement,
 *   never replace, individual decision granularity where audit function
 *   requires it.
 *
 * Boundary: pure data + pure functions. No I/O, no vendor, no wall-clock.
 * Provenance for the schedule itself lives in the JSON artifact's `meta`
 * block (AGENTS §12).
 */

import { z } from "zod";

/* ─────────────────────────────────────────────────────────────
 * Controlled vocabularies (must stay aligned with the JSON
 * artifact's `vocabularies` block)
 * ────────────────────────────────────────────────────────────*/

export const DATA_CLASSIFICATIONS = [
  "public",
  "internal",
  "restricted",
  "personal",
  "special-category",
] as const;
export type DataClassification = (typeof DATA_CLASSIFICATIONS)[number];

export const TENANT_CLASSES = [
  "education-institution",
  "organization",
  "platform",
] as const;
export type TenantClass = (typeof TENANT_CLASSES)[number];

export const RETENTION_KINDS = ["duration", "event-triggered"] as const;
export type RetentionKind = (typeof RETENTION_KINDS)[number];

export const LAWFUL_BASES = [
  "consent",
  "explicit-consent",
  "contract",
  "legal-obligation",
  "legitimate-interests",
  "public-task",
] as const;
export type LawfulBasis = (typeof LAWFUL_BASES)[number];

export const ERASURE_MECHANISMS = ["tombstone", "crypto-shred"] as const;
export type ErasureMechanism = (typeof ERASURE_MECHANISMS)[number];

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

export type RetentionPolicyEntry = z.infer<typeof retentionPolicyEntrySchema>;
export type RetentionSpec = RetentionPolicyEntry["retention"];
export type RecordFamilyInventoryEntry = z.infer<typeof recordFamilyInventoryEntrySchema>;
export type RetentionPolicySchedule = z.infer<typeof retentionPolicyScheduleSchema>;

/* ─────────────────────────────────────────────────────────────
 * ADR-005 invariants (pure) — mirrored by the offline gate
 * ────────────────────────────────────────────────────────────*/

export interface ScheduleValidationIssue {
  readonly code: string;
  readonly detail: string;
}

export interface ScheduleValidationResult {
  readonly ok: boolean;
  readonly issues: readonly ScheduleValidationIssue[];
}

function issue(code: string, detail: string): ScheduleValidationIssue {
  return { code, detail };
}

/**
 * The ADR-005 V1-minimal gate plus the schedule's structural invariants.
 * Deterministic and offline: operates purely on the parsed schedule value.
 */
export function validateRetentionPolicySchedule(
  schedule: RetentionPolicySchedule,
): ScheduleValidationResult {
  const issues: ScheduleValidationIssue[] = [];

  const familyEntries = new Map(schedule.recordFamilyInventory.map((f) => [f.family, f]));
  const policiesByFamily = new Map<string, RetentionPolicyEntry[]>();
  const policyIds = new Set<string>();

  for (const policy of schedule.policies) {
    if (policyIds.has(policy.policyId)) {
      issues.push(issue("DUPLICATE_POLICY_ID", `policyId ${policy.policyId} appears more than once`));
    }
    policyIds.add(policy.policyId);
    const list = policiesByFamily.get(policy.recordFamily) ?? [];
    list.push(policy);
    policiesByFamily.set(policy.recordFamily, list);
  }

  for (const family of schedule.recordFamilyInventory) {
    if (family.personalDataBearing) {
      // THE gate: every personal-data-bearing family must reference a policy.
      if (family.policyId === null || family.policyId === "") {
        issues.push(
          issue(
            "FAMILY_WITHOUT_POLICY",
            `personal-data-bearing family "${family.family}" has no policyId reference (ADR-005 V1-minimal gate)`,
          ),
        );
        continue;
      }
      const candidates = policiesByFamily.get(family.family) ?? [];
      const matched = candidates.find((p) => p.policyId === family.policyId);
      if (!matched) {
        issues.push(
          issue(
            "UNRESOLVABLE_POLICY_REFERENCE",
            `family "${family.family}" references policyId "${family.policyId}" which does not resolve to a policy of that family`,
          ),
        );
        continue;
      }
      if (matched.dataClassification !== family.defaultDataClassification) {
        issues.push(
          issue(
            "CLASSIFICATION_MISMATCH",
            `family "${family.family}" declares defaultDataClassification "${family.defaultDataClassification}" but policy ${matched.policyId} declares "${matched.dataClassification}"`,
          ),
        );
      }
    } else if (family.policyId !== null) {
      issues.push(
        issue(
          "NON_PDB_FAMILY_WITH_POLICY",
          `non-personal-data-bearing family "${family.family}" must not carry a policyId`,
        ),
      );
    }

    const familyPolicies = policiesByFamily.get(family.family) ?? [];
    for (const policy of familyPolicies) {
      if (family.immutable && policy.erasure.mechanism !== "tombstone") {
        issues.push(
          issue(
            "IMMUTABLE_FAMILY_NON_TOMBSTONE",
            `immutable family "${family.family}" policy ${policy.policyId} declares erasure mechanism "${policy.erasure.mechanism}" — immutable records are tombstoned, never deleted (ADR-005 Option 2)`,
          ),
        );
      }
      if (policy.erasure.mechanism === "crypto-shred" && family.cryptoShredCandidate !== true) {
        issues.push(
          issue(
            "CRYPTO_SHRED_NOT_DESIGNATED",
            `policy ${policy.policyId} declares crypto-shred but family "${family.family}" is not a designated shred-class (ADR-005: designation requires an explicit operator ruling)`,
          ),
        );
      }
    }

    if (family.tables.length === 0) {
      issues.push(
        issue("FAMILY_WITHOUT_TABLES", `family "${family.family}" declares no tables (provenance requires sources)`),
      );
    }
  }

  for (const policy of schedule.policies) {
    if (!familyEntries.has(policy.recordFamily)) {
      issues.push(
        issue(
          "POLICY_FOR_UNKNOWN_FAMILY",
          `policy ${policy.policyId} targets family "${policy.recordFamily}" which is absent from recordFamilyInventory`,
        ),
      );
    }
  }

  return { ok: issues.length === 0, issues };
}

/** Parse-and-validate helper for consumers loading the JSON artifact. */
export function parseRetentionPolicySchedule(input: unknown): RetentionPolicySchedule {
  const schedule = retentionPolicyScheduleSchema.parse(input);
  const result = validateRetentionPolicySchedule(schedule);
  if (!result.ok) {
    const detail = result.issues.map((i) => `${i.code}: ${i.detail}`).join("; ");
    throw new Error(`retention policy schedule failed ADR-005 gate: ${detail}`);
  }
  return schedule;
}