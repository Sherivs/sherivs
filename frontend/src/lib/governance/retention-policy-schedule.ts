/**
 * CoreGrid — V1CAP-066 retention policy schedule typed contract
 * (ADR-005_RETENTION_VS_IMMUTABLE_AUDIT.md, "Retention schedule requirement").
 *
 * MH-08: the canonical schema and the ADR-005 invariants live EXACTLY ONCE, in
 * the plain-ESM module `frontend/src/lib/governance/retention-policy-schema.mjs`
 * (pure JavaScript so the offline gate script `scripts/verify-retention-`
 * `schedule.mjs` — which cannot import TypeScript — executes the identical
 * rules). This module is a thin typed wrapper over that single source: it
 * re-exports the runtime schema surface unchanged and re-anchors the strict
 * TypeScript types that TS consumers rely on. The mirrored types below are the
 * ONLY TS-side knowledge; the runtime rules themselves are never duplicated,
 * and tests/unit/mh-08-retention-lockstep.test.ts proves both surfaces agree
 * on fixture schedules.
 *
 * ADR-005 makes a machine-readable retention policy schedule binding on the
 * V1CAP-066 contract, keyed by data classification, tenant class, and record
 * family. The canonical data artifact is
 * `architecture/coregrid-mvp-architecture/RETENTION_POLICY_SCHEDULE.json`.
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

// @ts-expect-error — MH-08: the canonical schema module is deliberately plain ESM with no `.d.mts` (the offline gate script shares this exact module); the runtime surface is re-exported below and the strict types are re-anchored in this file.
import * as schemaSource from "./retention-policy-schema.mjs";

/* ─────────────────────────────────────────────────────────────
 * Strict TS types (mirroring the single-source Zod schemas)
 * ────────────────────────────────────────────────────────────*/

export type DataClassification =
  | "public"
  | "internal"
  | "restricted"
  | "personal"
  | "special-category";

export type TenantClass = "education-institution" | "organization" | "platform";

export type RetentionKind = "duration" | "event-triggered";

export type LawfulBasis =
  | "consent"
  | "explicit-consent"
  | "contract"
  | "legal-obligation"
  | "legitimate-interests"
  | "public-task";

export type ErasureMechanism = "tombstone" | "crypto-shred";

export interface RetentionPolicyEntry {
  policyId: string;
  recordFamily: string;
  dataClassification: DataClassification;
  tenantClass: TenantClass;
  retention:
    | { kind: "duration"; retentionDays: number; clock: string; notes?: string }
    | { kind: "event-triggered"; trigger: string; maxRetentionDays: number; notes?: string };
  lawfulBasis: LawfulBasis;
  erasure: { mechanism: ErasureMechanism; scope: string; redactionPlaceholder: string };
  downstreamAggregation: { required: boolean; obligation: string };
}

export type RetentionSpec = RetentionPolicyEntry["retention"];

export interface RecordFamilyInventoryEntry {
  family: string;
  description: string;
  personalDataBearing: boolean;
  immutable: boolean;
  defaultDataClassification: DataClassification;
  policyId: string | null;
  cryptoShredCandidate?: boolean;
  personalValues: string[];
  tables: { table: string; source: string }[];
  tombstoneInvariant: string;
}

export interface RetentionPolicySchedule {
  meta: {
    document: string;
    capability: string;
    adr: string;
    scheduleRequirement: string;
    schemaVersion: string;
    authoredOn: string;
    authoredBy: string;
    validationGate: {
      script: string;
      command: string;
      contractModule: string;
      gate: string;
      exitCodes: Record<string, string>;
      determinism: string;
    };
    owners: Record<string, string>;
    provenance: {
      authority: string;
      method: string;
      durationStatus: string;
      crossTenantErasure: string;
    };
    reconciliationModel: {
      mechanism: string;
      erasureEvent: string;
      verificationInvariant: string;
      neverForgotten: string;
      forgotten: string;
    };
  };
  vocabularies: {
    dataClassification: { values: DataClassification[]; notes: string };
    tenantClass: { values: TenantClass[]; notes: string };
    retentionKind: { values: RetentionKind[]; notes: string };
    lawfulBasis: { values: LawfulBasis[]; notes: string };
    erasureMechanism: { values: ErasureMechanism[]; notes: string };
  };
  policies: RetentionPolicyEntry[];
  recordFamilyInventory: RecordFamilyInventoryEntry[];
  summary: {
    policyCount: number;
    recordFamilyCount: number;
    personalDataBearingFamilies: number;
    nonPersonalDataBearingFamilies: number;
    erasureMechanismDistribution: Record<string, number>;
    cryptoShredCandidates: string[];
    gate: string;
  };
}

export interface ScheduleValidationIssue {
  readonly code: string;
  readonly detail: string;
}

export interface ScheduleValidationResult {
  readonly ok: boolean;
  readonly issues: readonly ScheduleValidationIssue[];
}

/* ─────────────────────────────────────────────────────────────
 * Runtime re-exports — the single-source schema module's surface,
 * re-anchored to the strict types above for TS consumers.
 * ────────────────────────────────────────────────────────────*/

export const DATA_CLASSIFICATIONS: readonly DataClassification[] =
  schemaSource.DATA_CLASSIFICATIONS;
export const TENANT_CLASSES: readonly TenantClass[] = schemaSource.TENANT_CLASSES;
export const RETENTION_KINDS: readonly RetentionKind[] = schemaSource.RETENTION_KINDS;
export const LAWFUL_BASES: readonly LawfulBasis[] = schemaSource.LAWFUL_BASES;
export const ERASURE_MECHANISMS: readonly ErasureMechanism[] = schemaSource.ERASURE_MECHANISMS;

export const retentionPolicyEntrySchema = schemaSource.retentionPolicyEntrySchema as z.ZodType<RetentionPolicyEntry>;

export const recordFamilyInventoryEntrySchema =
  schemaSource.recordFamilyInventoryEntrySchema as z.ZodType<RecordFamilyInventoryEntry>;

export const retentionPolicyScheduleSchema =
  schemaSource.retentionPolicyScheduleSchema as z.ZodType<RetentionPolicySchedule>;

export const validateRetentionPolicySchedule: (
  schedule: RetentionPolicySchedule,
) => ScheduleValidationResult = schemaSource.validateRetentionPolicySchedule;

export const parseRetentionPolicySchedule: (input: unknown) => RetentionPolicySchedule =
  schemaSource.parseRetentionPolicySchedule;
