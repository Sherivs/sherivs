/**
 * CoreGrid — Data Platform quality framework, quarantine, replay,
 * and deduplication (Phase 14, Sections AC, AD, AE, AF, AG, AH, AI).
 *
 * Implements `architecture/phase-14-data-platform.md`:
 * - Data quality dimensions (AC): completeness, correctness, consistency,
 *   uniqueness, validity, timeliness, freshness, integrity, referential
 *   integrity.
 * - Quality rules (AD): student_id must exist, tenant_id must exist,
 *   currency must be valid, timestamp must be valid, invoice amount must be
 *   non-negative, event_id must be unique. Domain-specific rules remain
 *   owned by the relevant domain.
 * - Data quality score (AE): completeness_score, validity_score,
 *   freshness_score, uniqueness_score, consistency_score.
 * - Bad data handling (AF): invalid data must be rejected, quarantined,
 *   corrected, or replayed — never silently discarded.
 * - Quarantine zone (AG): invalid records enter a controlled quarantine area
 *   containing record, reason, source, timestamp, pipeline, validation
 *   failure, retry status.
 * - Replay (AH): pipelines support controlled replay; replay must be
 *   idempotent.
 * - Deduplication (AI): source ID, event ID, natural key, hash, deterministic
 *   idempotency key.
 *
 * Boundaries: domain-specific quality rules remain owned by the relevant
 * domain (AD); this module provides the framework.
 */

import type { TenantId } from "./tenant-core";

/* ─────────────────────────────────────────────────────────────
 * Quality dimensions (AC)
 * ────────────────────────────────────────────────────────────*/

export type QualityDimension =
  | "completeness"
  | "correctness"
  | "consistency"
  | "uniqueness"
  | "validity"
  | "timeliness"
  | "freshness"
  | "integrity"
  | "referential_integrity";

export const QUALITY_DIMENSIONS: readonly QualityDimension[] = [
  "completeness",
  "correctness",
  "consistency",
  "uniqueness",
  "validity",
  "timeliness",
  "freshness",
  "integrity",
  "referential_integrity",
] as const;

export type QualityRuleVerdict = { satisfied: boolean; reason: string };

export type QualityRuleKind =
  | "required_field"
  | "non_negative"
  | "valid_enum"
  | "unique"
  | "valid_timestamp"
  | "tenant_id_present";

export interface QualityRule {
  id: string;
  tenantId: TenantId;
  datasetName: string;
  kind: QualityRuleKind;
  field: string;
  params: Record<string, string | number | boolean | null>;
}

export interface CreateQualityRuleInput {
  tenantId: TenantId;
  datasetName: string;
  kind: QualityRuleKind;
  field: string;
  params?: Record<string, string | number | boolean | null>;
}

export type CreateQualityRuleResult =
  { ok: true; rule: QualityRule } | { ok: false; error: string };

export function createQualityRule(input: CreateQualityRuleInput): CreateQualityRuleResult {
  if (input.field.trim() === "") {
    return { ok: false, error: "Quality rule requires a field (AD)" };
  }
  return {
    ok: true,
    rule: {
      id: `rule-${input.tenantId}-${input.datasetName}-${input.kind}-${input.field}`,
      tenantId: input.tenantId,
      datasetName: input.datasetName,
      kind: input.kind,
      field: input.field,
      params: input.params ?? {},
    },
  };
}

/**
 * Evaluate a quality rule against a record (AD). Rule evaluation is
 * deterministic; domain-specific semantics remain owned by the domain.
 */
export function evaluateQualityRule(
  rule: QualityRule,
  record: Record<string, unknown>,
): QualityRuleVerdict {
  const value = record[rule.field];
  switch (rule.kind) {
    case "required_field":
      return value !== undefined && value !== null && value !== ""
        ? { satisfied: true, reason: "required field present" }
        : { satisfied: false, reason: `${rule.field} is required (AD)` };
    case "tenant_id_present":
      return value !== undefined && value !== null && value !== ""
        ? { satisfied: true, reason: "tenant context present" }
        : { satisfied: false, reason: "tenant_id must exist (AD)" };
    case "non_negative": {
      const n = typeof value === "number" ? value : Number(value);
      return Number.isFinite(n) && n >= 0
        ? { satisfied: true, reason: "value is non-negative" }
        : { satisfied: false, reason: `${rule.field} must be non-negative (AD)` };
    }
    case "valid_enum": {
      const allowedRaw = rule.params.allowed;
      const allowed =
        typeof allowedRaw === "string" && allowedRaw !== "" ? allowedRaw.split(",") : [];
      return typeof value === "string" && allowed.includes(value)
        ? { satisfied: true, reason: "value is valid" }
        : { satisfied: false, reason: `${rule.field} must be one of ${allowed.join(", ")} (AD)` };
    }
    case "valid_timestamp":
      return typeof value === "string" && !Number.isNaN(Date.parse(value))
        ? { satisfied: true, reason: "timestamp is valid" }
        : { satisfied: false, reason: `${rule.field} must be a valid timestamp (AD)` };
    case "unique":
      return value !== undefined && value !== null && value !== ""
        ? { satisfied: true, reason: "value present for uniqueness check" }
        : { satisfied: false, reason: `${rule.field} must be unique (AD)` };
    default:
      return { satisfied: false, reason: "Unsupported quality rule kind" };
  }
}

/* ─────────────────────────────────────────────────────────────
 * Quality score (AE)
 * ────────────────────────────────────────────────────────────*/

export interface DatasetQualityScore {
  datasetName: string;
  tenantId: TenantId;
  completenessScore: number;
  validityScore: number;
  freshnessScore: number;
  uniquenessScore: number;
  consistencyScore: number;
  overallScore: number;
  evaluatedAt: string;
}

export interface ComputeQualityScoreInput {
  datasetName: string;
  tenantId: TenantId;
  /** 0-100 per dimension. */
  completeness: number;
  validity: number;
  freshness: number;
  uniqueness: number;
  consistency: number;
  now: string;
}

export function computeQualityScore(input: ComputeQualityScoreInput): DatasetQualityScore {
  const overallScore = Math.round(
    (input.completeness + input.validity + input.freshness + input.uniqueness + input.consistency) /
      5,
  );
  return {
    datasetName: input.datasetName,
    tenantId: input.tenantId,
    completenessScore: input.completeness,
    validityScore: input.validity,
    freshnessScore: input.freshness,
    uniquenessScore: input.uniqueness,
    consistencyScore: input.consistency,
    overallScore,
    evaluatedAt: input.now,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Quarantine zone (AG)
 * ────────────────────────────────────────────────────────────*/

export interface QuarantinedRecord {
  id: string;
  tenantId: TenantId;
  record: Record<string, unknown>;
  reason: string;
  source: string;
  timestamp: string;
  pipeline: string;
  validationFailure: string;
  retryStatus: "none" | "queued" | "replayed" | "discarded";
}

export interface QuarantineRecordInput {
  tenantId: TenantId;
  record: Record<string, unknown>;
  reason: string;
  source: string;
  pipeline: string;
  validationFailure: string;
  now: string;
}

export type QuarantineRecordResult =
  { ok: true; quarantined: QuarantinedRecord } | { ok: false; error: string };

/** Invalid records enter a controlled quarantine area (AF, AG) — they are
 * never silently discarded. */
export function quarantineRecord(input: QuarantineRecordInput): QuarantineRecordResult {
  if (input.reason.trim() === "") {
    return { ok: false, error: "Quarantine requires a reason (AG)" };
  }
  return {
    ok: true,
    quarantined: {
      id: `quarantined-${input.tenantId}-${input.pipeline}-${input.now}-${Math.random().toString(36).slice(2, 8)}`,
      tenantId: input.tenantId,
      record: input.record,
      reason: input.reason,
      source: input.source,
      timestamp: input.now,
      pipeline: input.pipeline,
      validationFailure: input.validationFailure,
      retryStatus: "none",
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Replay (AH) and deduplication (AI)
 * ────────────────────────────────────────────────────────────*/

export interface ReplayState {
  processedKeys: Set<string>;
}

/**
 * Replay must be idempotent (AH): the same record processed twice must not
 * produce duplicate effects. Deduplication uses deterministic idempotency
 * keys (AI).
 */
export function replayDeduplicationCheck(
  idempotencyKey: string,
  state: ReplayState,
): { outcome: "proceed" | "duplicate" } {
  if (state.processedKeys.has(idempotencyKey)) {
    return { outcome: "duplicate" };
  }
  state.processedKeys.add(idempotencyKey);
  return { outcome: "proceed" };
}

export function isDeduplicated(key: string, state: ReplayState): boolean {
  return state.processedKeys.has(key);
}
