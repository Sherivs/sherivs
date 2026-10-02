/**
 * CoreGrid — DB-backed substrate adapter for the evidence capture lifecycle
 * (J-034 / V1CAP-059 / MISSION-R-90 + J-033 / V1CAP-058 / MISSION-R-91),
 * persisting evidence/capture.ts records and lifecycle acts into the tables
 * authored by
 * database/supabase/migrations/20261002000008_coregrid_v1_evidence_lifecycle.sql.
 *
 * Composition, not rewrite: the pure contract stays untouched — this adapter
 * maps CapturedEvidence records (already envelope-stamped by the contract)
 * and lifecycle act records onto their substrate rows and is the ONLY place
 * vendor/DB calls appear (Constitution §24/§25). Service-role access only:
 * the tables are zero-policy deny-by-default (RLS enabled, all
 * anon/authenticated privileges revoked).
 *
 * Append-only law: capture, promotion, supersession and revocation produce
 * NEW records; no UPDATE/DELETE path is authored for epistemic fields —
 * saving the same record twice is a no-op (ON CONFLICT DO NOTHING) and the
 * lifecycle act ledger is append-only with a deterministic id per act.
 *
 * Failure semantics (J-045): all I/O runs through AdapterFailurePolicy.run
 * (bounded timeout, retry caps, breaker, degraded mode events, trust ledger);
 * mapping/validation are local operations and run through containSync —
 * malformed contract data or malformed DB rows become structured errors,
 * never thrown. Writes are never transport-retried (maxAttempts: 1); reads
 * may retry (idempotent). Purity: no wall-clock sampling — every audit
 * instant is a supplied parameter. No credentials, no secret values, no
 * sensitive payload logging (Constitution §29).
 */
import { createHash } from "node:crypto";
import { createAdapterFailurePolicy, type AdapterCallResult, type AdapterFailurePolicy, type AdapterMode } from "./failure-policy";
import { canonicalJson } from "../kernel/event-semantics";
import type {
  CapturedEvidence,
  EvidenceClass,
  SufficiencyAssessment,
  EvidencePromotionAct,
  EvidenceRevocationAct,
} from "../evidence/capture";
import type { KernelObjectStatus, KernelProvenance } from "../kernel/reality";

/* ─────────────────────────────────────────────────────────────
 * Injected service-role client (minimal surface; no credentials here)
 * ────────────────────────────────────────────────────────────*/

export interface EvidenceDbClient {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: readonly Record<string, unknown>[] }>;
}

export const EVIDENCE_RECORD_TABLE = "cg_evidence_record";
export const EVIDENCE_LIFECYCLE_ACT_TABLE = "cg_evidence_lifecycle_act";

/**
 * Declared failure-semantics policy for the evidence substrate (J-045).
 * Callers may inject their own instance via EvidenceCaptureStoreConfig.
 */
export const EVIDENCE_FAILURE_POLICY: AdapterFailurePolicy = createAdapterFailurePolicy({
  provider: "cg-substrate-evidence",
  timeoutMs: 5_000,
  maxAttempts: 2,
  backoffBaseMs: 100,
  backoffCapMs: 1_000,
  degradedAfterFailures: 3,
  degradedWindowMs: 30_000,
  breakerFailureThreshold: 5,
  breakerResetMs: 15_000,
});

/* ─────────────────────────────────────────────────────────────
 * Mapping helpers (strict, fail-closed, no `any`)
 * ────────────────────────────────────────────────────────────*/

export type EvidenceStoreErrorCode =
  | "invalid_input"
  | "timeout"
  | "provider_error"
  | "breaker_open";

export type EvidenceStoreResult<T> =
  | { ok: true; value: T; attempts: number; durationMs: number; mode: AdapterMode }
  | {
      ok: false;
      code: EvidenceStoreErrorCode;
      reason: string;
      attempts: number;
      durationMs: number;
      mode: AdapterMode;
    };

/** Structured failure with full call observability (AdapterCallError parity). */
function fail<T>(
  code: EvidenceStoreErrorCode,
  reason: string,
  attempts: number,
  durationMs: number,
  mode: AdapterMode,
): EvidenceStoreResult<T> {
  return { ok: false, code, reason, attempts, durationMs, mode };
}

class MappingError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(row: Record<string, unknown>, key: string, max: number): string {
  const raw = row[key];
  if (typeof raw !== "string") throw new MappingError(`${key} must be a string`);
  const trimmed = raw.trim();
  if (trimmed.length < 1 || trimmed.length > max) {
    throw new MappingError(`${key} must be 1-${max} characters`);
  }
  return trimmed;
}

function optionalString(row: Record<string, unknown>, key: string, max: number): string | null {
  const raw = row[key];
  if (raw == null) return null;
  if (typeof raw !== "string") throw new MappingError(`${key} must be a string or null`);
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > max) throw new MappingError(`${key} must be at most ${max} characters`);
  return trimmed;
}

function timestampString(value: unknown, key: string): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new MappingError(`${key} is an invalid instant`);
    return value.toISOString();
  }
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new MappingError(`${key} must be a parsable instant`);
  }
  return value;
}

function requireTimestamp(row: Record<string, unknown>, key: string): string {
  const value = timestampString(row[key], key);
  if (value == null) throw new MappingError(`${key} is required`);
  return value;
}

function stringArray(value: unknown, key: string): readonly string[] {
  const parsed = typeof value === "string" ? safeParse(value, key) : value;
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
    throw new MappingError(`${key} must be an array of strings`);
  }
  return Object.freeze([...(parsed as string[])]);
}

function jsonObject(value: unknown, key: string): Record<string, unknown> {
  const parsed = typeof value === "string" ? safeParse(value, key) : value;
  if (!isRecord(parsed)) throw new MappingError(`${key} must be a JSON object`);
  return parsed;
}

function optionalJsonObject(value: unknown, key: string): Record<string, unknown> | null {
  if (value == null) return null;
  return jsonObject(value, key);
}

function safeParse(value: string, key: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new MappingError(`${key} is not valid JSON`);
  }
}

function requireVocab(row: Record<string, unknown>, key: string, vocab: readonly string[]): string {
  const value = requireString(row, key, 64);
  if (!vocab.includes(value)) throw new MappingError(`${key} "${value}" is not in the declared vocabulary`);
  return value;
}

/* ─────────────────────────────────────────────────────────────
 * Contract <-> DB row mapping
 * ────────────────────────────────────────────────────────────*/

export interface EvidenceRecordRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly evidence_type: string;
  readonly evidence_class: string;
  readonly prior_class: string | null;
  readonly claim: string;
  readonly confidence: number | null;
  readonly confidence_basis: string | null;
  readonly observed_at: string | null;
  readonly recorded_at: string;
  readonly captured_by: string;
  readonly captured_at: string;
  readonly source_ref: string | null;
  readonly canonical_truth_eligible: boolean;
  readonly lineage: string;
  readonly supersedes: string | null;
  readonly promotion: string | null;
  readonly retention_policy_id: string;
  readonly sufficiency: string | null;
  readonly valid_from: string | null;
  readonly valid_until: string | null;
  readonly revocation: string | null;
  readonly revokes: string | null;
  readonly object_type: string;
  readonly schema_version: string;
  readonly status: string;
  readonly created_by: string;
  readonly updated_by: string;
  readonly provenance: string;
  readonly policy_context: string;
  readonly trace_id: string;
  readonly correlation_id: string;
  readonly causation_id: string | null;
  readonly parent_event_id: string | null;
  readonly declared_origin: string | null;
}

/** Contract record -> substrate row (the record is already envelope-stamped). */
export function evidenceToRow(record: CapturedEvidence): EvidenceRecordRow {
  return {
    id: record.evidence_id,
    tenant_id: record.tenant_id,
    evidence_type: record.evidence_type,
    evidence_class: record.evidence_class,
    prior_class: record.prior_class,
    claim: JSON.stringify(record.claim),
    confidence: record.confidence,
    confidence_basis: record.confidence_basis,
    observed_at: record.observed_at,
    recorded_at: record.recorded_at,
    captured_by: record.captured_by,
    captured_at: record.captured_at,
    source_ref: record.source_ref,
    canonical_truth_eligible: record.canonical_truth_eligible === true,
    lineage: JSON.stringify(record.lineage),
    supersedes: record.supersedes,
    promotion: record.promotion == null ? null : JSON.stringify(record.promotion),
    retention_policy_id: record.retention_policy_id,
    sufficiency: record.sufficiency == null ? null : JSON.stringify(record.sufficiency),
    valid_from: record.valid_from,
    valid_until: record.valid_until,
    revocation: record.revocation == null ? null : JSON.stringify(record.revocation),
    revokes: record.revokes,
    object_type: record.object_type,
    schema_version: record.schema_version,
    status: record.status,
    created_by: record.created_by,
    updated_by: record.updated_by,
    provenance: JSON.stringify(record.provenance),
    policy_context: JSON.stringify(record.policy_context),
    trace_id: record.trace_id,
    correlation_id: record.correlation_id,
    causation_id: record.causation_id,
    parent_event_id: record.parent_event_id,
    declared_origin: record.declared_origin,
  };
}

/** DB row -> contract record (fail-closed over every vocabulary and bound). */
export function rowToEvidence(row: Record<string, unknown>): CapturedEvidence {
  if (!isRecord(row)) throw new MappingError("evidence row must be a JSON object");
  const confidenceRaw = row["confidence"];
  if (confidenceRaw != null && (typeof confidenceRaw !== "number" || !Number.isFinite(confidenceRaw) || confidenceRaw < 0 || confidenceRaw > 1)) {
    throw new MappingError("confidence must be a finite number between 0 and 1");
  }
  const canonicalTruthRaw = row["canonical_truth_eligible"];
  if (typeof canonicalTruthRaw !== "boolean") throw new MappingError("canonical_truth_eligible must be a boolean");
  const revocation = optionalJsonObject(row["revocation"], "revocation");
  return {
    object_type: requireVocab(row, "object_type", ["core.evidence"]),
    schema_version: requireString(row, "schema_version", 32),
    status: requireVocab(row, "status", ["draft", "active", "suspended", "archived", "deleted"]) as KernelObjectStatus,
    evidence_id: requireString(row, "id", 160),
    evidence_type: requireString(row, "evidence_type", 128),
    evidence_class: requireVocab(row, "evidence_class", [
      "direct_observation",
      "generated",
      "simulated",
      "predicted",
      "derived",
      "attested",
    ]) as EvidenceClass,
    prior_class: optionalVocab(row, "prior_class", [
      "direct_observation",
      "generated",
      "simulated",
      "predicted",
      "derived",
      "attested",
    ]) as EvidenceClass | null,
    tenant_id: requireString(row, "tenant_id", 128),
    claim: jsonObject(row["claim"], "claim"),
    confidence: confidenceRaw == null ? null : confidenceRaw,
    observed_at: timestampString(row["observed_at"], "observed_at"),
    recorded_at: requireTimestamp(row, "recorded_at"),
    captured_by: requireString(row, "captured_by", 160),
    captured_at: requireTimestamp(row, "captured_at"),
    source_ref: optionalString(row, "source_ref", 200),
    canonical_truth_eligible: canonicalTruthRaw,
    lineage: stringArray(row["lineage"], "lineage"),
    supersedes: optionalString(row, "supersedes", 160),
    promotion: revocation == null ? (optionalJsonObject(row["promotion"], "promotion") as unknown as EvidencePromotionAct | null) : null,
    retention_policy_id: requireString(row, "retention_policy_id", 160),
    confidence_basis: optionalString(row, "confidence_basis", 500),
    sufficiency: optionalJsonObject(row["sufficiency"], "sufficiency") as unknown as SufficiencyAssessment | null,
    valid_from: timestampString(row["valid_from"], "valid_from"),
    valid_until: timestampString(row["valid_until"], "valid_until"),
    revocation: revocation as unknown as EvidenceRevocationAct | null,
    revokes: optionalString(row, "revokes", 160),
    provenance: jsonObject(row["provenance"], "provenance") as unknown as KernelProvenance,
    policy_context: jsonObject(row["policy_context"], "policy_context"),
    trace_id: requireString(row, "trace_id", 200),
    correlation_id: requireString(row, "correlation_id", 200),
    causation_id: optionalString(row, "causation_id", 200),
    parent_event_id: optionalString(row, "parent_event_id", 200),
    declared_origin: optionalString(row, "declared_origin", 200),
    created_by: requireString(row, "created_by", 160),
    updated_by: requireString(row, "updated_by", 160),
  };
}

function optionalVocab(row: Record<string, unknown>, key: string, vocab: readonly string[]): string | null {
  const raw = row[key];
  if (raw == null) return null;
  const value = requireString(row, key, 64);
  if (!vocab.includes(value)) throw new MappingError(`${key} "${value}" is not in the declared vocabulary`);
  return value;
}

/* ─────────────────────────────────────────────────────────────
 * Lifecycle act mapping
 * ────────────────────────────────────────────────────────────*/

export type EvidenceLifecycleActKind = "promotion" | "revocation" | "sufficiency_assessment";

export interface LifecycleActInput {
  readonly targetEvidenceId: string;
  readonly tenantId: string;
  readonly actKind: EvidenceLifecycleActKind;
  /** The non-AI actor behind the act (Constitution §21 gate is contract-side). */
  readonly actorId: string;
  /** The recorded act payload (validation act / revocation act / assessment). */
  readonly act: Record<string, unknown>;
  /** The evidence-bearing act record id, when the act is itself evidence. */
  readonly actEvidenceId?: string | null;
  /** Audit instant supplied by the caller — never wall-clock sampled. */
  readonly recordedAt: string;
}

export interface LifecycleActRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly target_evidence_id: string;
  readonly act_kind: string;
  readonly actor_id: string;
  readonly act: string;
  readonly act_evidence_id: string | null;
  readonly recorded_at: string;
}

/** Deterministic act id: the same act maps to the same audit row. */
export function lifecycleActId(act: LifecycleActInput): string {
  return `elact:${createHash("sha256")
    .update(
      canonicalJson({
        target: act.targetEvidenceId,
        tenant: act.tenantId,
        kind: act.actKind,
        actor: act.actorId,
        act: act.act,
        actEvidenceId: act.actEvidenceId ?? null,
        recordedAt: act.recordedAt,
      }),
    )
    .digest("hex")
    .slice(0, 32)}`;
}

export function lifecycleActToRow(act: LifecycleActInput): LifecycleActRow {
  if (Number.isNaN(Date.parse(act.recordedAt))) {
    throw new MappingError("act recordedAt must be a valid ISO-8601 audit instant");
  }
  return {
    id: lifecycleActId(act),
    tenant_id: act.tenantId,
    target_evidence_id: act.targetEvidenceId,
    act_kind: act.actKind,
    actor_id: act.actorId,
    act: JSON.stringify(act.act),
    act_evidence_id: act.actEvidenceId?.trim() || null,
    recorded_at: act.recordedAt,
  };
}

/** DB act row -> the persisted act input view (round-trip shape). */
export function rowToLifecycleAct(row: Record<string, unknown>): LifecycleActRow {
  if (!isRecord(row)) throw new MappingError("lifecycle act row must be a JSON object");
  return {
    id: requireString(row, "id", 160),
    tenant_id: requireString(row, "tenant_id", 128),
    target_evidence_id: requireString(row, "target_evidence_id", 160),
    act_kind: requireVocab(row, "act_kind", ["promotion", "revocation", "sufficiency_assessment"]),
    actor_id: requireString(row, "actor_id", 160),
    act: JSON.stringify(jsonObject(row["act"], "act")),
    act_evidence_id: optionalString(row, "act_evidence_id", 160),
    recorded_at: requireTimestamp(row, "recorded_at"),
  };
}

/* ─────────────────────────────────────────────────────────────
 * The adapter
 * ────────────────────────────────────────────────────────────*/

export interface EvidenceCaptureStoreConfig {
  client: EvidenceDbClient;
  /** J-045: declared adapter failure policy; defaulted when omitted. */
  failurePolicy?: AdapterFailurePolicy;
}

export interface EvidenceCaptureStore {
  /** Append one captured evidence record. Idempotent, never retried. */
  saveCapturedEvidence(record: CapturedEvidence): Promise<EvidenceStoreResult<{ evidenceId: string }>>;
  /** Load one evidence record, or null when absent. */
  loadCapturedEvidence(tenantId: string, evidenceId: string): Promise<EvidenceStoreResult<CapturedEvidence | null>>;
  /** Load all evidence records for a tenant (most recent first). */
  loadTenantEvidence(tenantId: string): Promise<EvidenceStoreResult<readonly CapturedEvidence[]>>;
  /** Append one lifecycle act to the act ledger. Idempotent, never retried. */
  saveLifecycleAct(act: LifecycleActInput): Promise<EvidenceStoreResult<{ id: string }>>;
  /** Load the lifecycle act ledger of one evidence record. */
  loadLifecycleActs(tenantId: string, targetEvidenceId: string): Promise<EvidenceStoreResult<readonly LifecycleActRow[]>>;
  /** The declared failure policy (observability: snapshot, trust ledger). */
  readonly policy: AdapterFailurePolicy;
}

const EVIDENCE_ROW_COLUMNS =
  "(id, tenant_id, evidence_type, evidence_class, prior_class, claim, confidence, confidence_basis, " +
  "observed_at, recorded_at, captured_by, captured_at, source_ref, canonical_truth_eligible, lineage, " +
  "supersedes, promotion, retention_policy_id, sufficiency, valid_from, valid_until, revocation, revokes, " +
  "object_type, schema_version, status, created_by, updated_by, provenance, policy_context, trace_id, " +
  "correlation_id, causation_id, parent_event_id, declared_origin)";

const EVIDENCE_ROW_PARAMS =
  "($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23," +
  "$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35)";

export function createEvidenceCaptureStore(config: EvidenceCaptureStoreConfig): EvidenceCaptureStore {
  const policy = config.failurePolicy ?? EVIDENCE_FAILURE_POLICY;
  const client = config.client;

  function containMapping<T>(operation: string, fn: () => T): EvidenceStoreResult<T> {
    const contained = policy.containSync(operation, fn);
    if (contained.outcome === "ok") {
      return { ok: true, value: contained.value, attempts: contained.attempts, durationMs: contained.durationMs, mode: contained.mode };
    }
    return fail("invalid_input", contained.reason, contained.attempts, contained.durationMs, contained.mode);
  }

  function fromCall<T>(outcome: AdapterCallResult<T>): EvidenceStoreResult<T> {
    if (outcome.outcome === "ok") {
      return { ok: true, value: outcome.value, attempts: outcome.attempts, durationMs: outcome.durationMs, mode: outcome.mode };
    }
    return fail(outcome.code, outcome.reason, outcome.attempts, outcome.durationMs, outcome.mode);
  }

  function evidenceRowValues(row: EvidenceRecordRow): unknown[] {
    return [
      row.id, row.tenant_id, row.evidence_type, row.evidence_class, row.prior_class, row.claim,
      row.confidence, row.confidence_basis, row.observed_at, row.recorded_at, row.captured_by,
      row.captured_at, row.source_ref, row.canonical_truth_eligible, row.lineage, row.supersedes,
      row.promotion, row.retention_policy_id, row.sufficiency, row.valid_from, row.valid_until,
      row.revocation, row.revokes, row.object_type, row.schema_version, row.status, row.created_by,
      row.updated_by, row.provenance, row.policy_context, row.trace_id, row.correlation_id,
      row.causation_id, row.parent_event_id, row.declared_origin,
    ];
  }

  return {
    policy,

    async saveCapturedEvidence(record) {
      const mapped = containMapping("evidence.map_record", () => evidenceToRow(record));
      if (!mapped.ok) return mapped;
      const row = mapped.value;
      const outcome = await policy.run({
        operation: "evidence.save_record",
        maxAttempts: 1,
        call: async () => {
          await client.query(
            `INSERT INTO public.${EVIDENCE_RECORD_TABLE} ${EVIDENCE_ROW_COLUMNS}
             VALUES ${EVIDENCE_ROW_PARAMS}
             ON CONFLICT (id, tenant_id) DO NOTHING`,
            evidenceRowValues(row),
          );
          return { evidenceId: row.id };
        },
      });
      return fromCall(outcome);
    },

    async loadCapturedEvidence(tenantId, evidenceId) {
      if (tenantId.trim() === "" || evidenceId.trim() === "") {
        return fail("invalid_input", "tenantId and evidenceId are required", 0, 0, policy.snapshot().mode);
      }
      const outcome = await policy.run({
        operation: "evidence.load_record",
        call: async () =>
          client.query(
            `SELECT * FROM public.${EVIDENCE_RECORD_TABLE} WHERE id = $1 AND tenant_id = $2`,
            [evidenceId, tenantId],
          ),
      });
      if (outcome.outcome === "error") return fromCall(outcome);
      const mapped = containMapping("evidence.map_record_row", () => {
        const first = outcome.value.rows[0];
        return first == null ? null : rowToEvidence(first);
      });
      if (!mapped.ok) return mapped;
      return { ok: true, value: mapped.value, attempts: outcome.attempts, durationMs: outcome.durationMs, mode: outcome.mode };
    },

    async loadTenantEvidence(tenantId) {
      if (tenantId.trim() === "") {
        return fail("invalid_input", "tenantId is required", 0, 0, policy.snapshot().mode);
      }
      const outcome = await policy.run({
        operation: "evidence.load_tenant_records",
        call: async () =>
          client.query(
            `SELECT * FROM public.${EVIDENCE_RECORD_TABLE} WHERE tenant_id = $1 ORDER BY recorded_at DESC, id ASC`,
            [tenantId],
          ),
      });
      if (outcome.outcome === "error") return fromCall(outcome);
      const mapped = containMapping("evidence.map_tenant_rows", () => outcome.value.rows.map(rowToEvidence));
      if (!mapped.ok) return mapped;
      return { ok: true, value: mapped.value, attempts: outcome.attempts, durationMs: outcome.durationMs, mode: outcome.mode };
    },

    async saveLifecycleAct(act) {
      const mapped = containMapping("evidence.map_act", () => lifecycleActToRow(act));
      if (!mapped.ok) return mapped;
      const row = mapped.value;
      const outcome = await policy.run({
        operation: "evidence.save_act",
        maxAttempts: 1,
        call: async () => {
          await client.query(
            `INSERT INTO public.${EVIDENCE_LIFECYCLE_ACT_TABLE}
              (id, tenant_id, target_evidence_id, act_kind, actor_id, act, act_evidence_id, recorded_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             ON CONFLICT (id) DO NOTHING`,
            [
              row.id, row.tenant_id, row.target_evidence_id, row.act_kind, row.actor_id,
              row.act, row.act_evidence_id, row.recorded_at,
            ],
          );
          return { id: row.id };
        },
      });
      return fromCall(outcome);
    },

    async loadLifecycleActs(tenantId, targetEvidenceId) {
      if (tenantId.trim() === "" || targetEvidenceId.trim() === "") {
        return fail("invalid_input", "tenantId and targetEvidenceId are required", 0, 0, policy.snapshot().mode);
      }
      const outcome = await policy.run({
        operation: "evidence.load_acts",
        call: async () =>
          client.query(
            `SELECT * FROM public.${EVIDENCE_LIFECYCLE_ACT_TABLE}
             WHERE tenant_id = $1 AND target_evidence_id = $2 ORDER BY recorded_at ASC`,
            [tenantId, targetEvidenceId],
          ),
      });
      if (outcome.outcome === "error") return fromCall(outcome);
      const mapped = containMapping("evidence.map_act_rows", () => outcome.value.rows.map(rowToLifecycleAct));
      if (!mapped.ok) return mapped;
      return { ok: true, value: mapped.value, attempts: outcome.attempts, durationMs: outcome.durationMs, mode: outcome.mode };
    },
  };
}