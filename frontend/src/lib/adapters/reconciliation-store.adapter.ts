/**
 * CoreGrid — DB-backed substrate adapter for the reconciliation contract
 * (V1CAP-005 / J-004 / MISSION-R-14), persisting kernel/reconciliation.ts
 * verdicts into the tables authored by
 * database/supabase/migrations/20261002000005_coregrid_v1_reconciliation.sql.
 *
 * Composition, not rewrite: the pure contract stays untouched — this adapter
 * stamps verdicts through the contract's own `verdictDraft` (canonical
 * envelope, V1CAP-002), maps contract rows <-> DB rows, and is the ONLY place
 * vendor/DB calls appear (Constitution §24/§25). Service-role access only:
 * the tables are zero-policy deny-by-default (RLS enabled, all
 * anon/authenticated privileges revoked), so no policy-bearing client is
 * accepted — the injected client is a minimal service-role surface.
 *
 * Failure semantics (J-045): the one pattern every external adapter inherits.
 * All I/O runs through AdapterFailurePolicy.run (bounded timeout, retry caps,
 * breaker, degraded mode events, trust ledger); mapping/validation are local
 * operations and run through containSync — malformed contract data or
 * malformed DB rows become structured errors, never thrown. Writes are
 * append-only and idempotent (ON CONFLICT DO NOTHING) but non-transport-
 * retried (maxAttempts: 1); reads may retry (idempotent).
 *
 * Append-only law: reconciliation never mutates or deletes — saving the same
 * verdict twice is a no-op, and no UPDATE/DELETE path is authored here.
 * Purity: no wall-clock sampling — every audit instant is a supplied
 * parameter. No credentials, no secret values, no sensitive payload logging
 * (Constitution §29).
 */
import { createHash } from "node:crypto";
import { createAdapterFailurePolicy, type AdapterCallResult, type AdapterFailurePolicy, type AdapterMode } from "./failure-policy";
import {
  RECONCILIATION_VERDICT_OBJECT_TYPE,
  verdictDraft,
  type ReconciliationObservation,
  type ReconciliationOutcome,
  type ReconciliationRuleId,
  type ReconciliationVerdict,
} from "../kernel/reconciliation";
import type { KernelObjectEnvelopeInput } from "../kernel/reality";

/* ─────────────────────────────────────────────────────────────
 * Injected service-role client (minimal surface; no credentials here)
 * ────────────────────────────────────────────────────────────*/

export interface ReconciliationDbClient {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: readonly Record<string, unknown>[] }>;
}

export const RECONCILIATION_VERDICT_TABLE = "cg_reconciliation_verdict";
export const RECONCILIATION_INPUT_TABLE = "cg_reconciliation_input";

/**
 * Declared failure-semantics policy for the reconciliation substrate (J-045).
 * Callers may inject their own instance via ReconciliationStoreConfig.
 */
export const RECONCILIATION_FAILURE_POLICY: AdapterFailurePolicy = createAdapterFailurePolicy({
  provider: "cg-substrate-reconciliation",
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
 * Row shapes (column names pinned to the migration)
 * ────────────────────────────────────────────────────────────*/

export const RECONCILIATION_VERDICT_COLUMNS = [
  "id",
  "tenant_id",
  "verdict_id",
  "subject_entity_id",
  "attribute",
  "outcome",
  "rule_applied",
  "applied_rules",
  "resolution_trace",
  "value",
  "winner_id",
  "inputs",
  "superseded",
  "duplicates",
  "residual_uncertainty",
  "valid_from",
  "valid_until",
  "valid_time_known",
  "recorded_at",
  "verdict_provenance",
  "object_type",
  "schema_version",
  "status",
  "created_by",
  "updated_by",
  "provenance",
  "policy_context",
  "trace_id",
  "correlation_id",
  "causation_id",
  "parent_event_id",
  "declared_origin",
] as const;

export const RECONCILIATION_INPUT_COLUMNS = [
  "verdict_row_id",
  "tenant_id",
  "observation_id",
  "subject_entity_id",
  "attribute",
  "kind",
  "evidence_class",
  "reliability",
  "confidence",
  "observed_at",
  "recorded_at",
  "valid_from",
  "valid_until",
  "valid_time_known",
  "supersedes",
] as const;

/** The deterministic primary key of a verdict row: id + record time. */
export function verdictRowId(verdict: ReconciliationVerdict): string {
  return `${verdict.verdict_id.trim()}@${verdict.recorded_at.trim()}`;
}

/* ─────────────────────────────────────────────────────────────
 * Mapping helpers (strict, fail-closed, no `any`)
 * ────────────────────────────────────────────────────────────*/

export type ReconciliationStoreErrorCode =
  | "invalid_input"
  | "timeout"
  | "provider_error"
  | "breaker_open";

export type ReconciliationStoreResult<T> =
  | { ok: true; value: T; attempts: number; durationMs: number; mode: AdapterMode }
  | {
      ok: false;
      code: ReconciliationStoreErrorCode;
      reason: string;
      attempts: number;
      durationMs: number;
      mode: AdapterMode;
    };

/** Structured failure with full call observability (AdapterCallError parity). */
function fail<T>(
  code: ReconciliationStoreErrorCode,
  reason: string,
  attempts: number,
  durationMs: number,
  mode: AdapterMode,
): ReconciliationStoreResult<T> {
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
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new MappingError(`${key} must be an array of strings`);
  }
  return Object.freeze([...(value as string[])]);
}

function jsonObject(value: unknown, key: string): Record<string, unknown> {
  if (!isRecord(value)) throw new MappingError(`${key} must be a JSON object`);
  return value;
}

function jsonValue(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/* ─────────────────────────────────────────────────────────────
 * Contract row -> DB row (composed through the contract's verdictDraft)
 * ────────────────────────────────────────────────────────────*/

export interface ReconciliationVerdictRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly verdict_id: string;
  readonly subject_entity_id: string;
  readonly attribute: string;
  readonly outcome: string;
  readonly rule_applied: string | null;
  readonly applied_rules: string;
  readonly resolution_trace: string;
  readonly value: string | null;
  readonly winner_id: string | null;
  readonly inputs: string;
  readonly superseded: string;
  readonly duplicates: string;
  readonly residual_uncertainty: string;
  readonly valid_from: string | null;
  readonly valid_until: string | null;
  readonly valid_time_known: boolean;
  readonly recorded_at: string;
  readonly verdict_provenance: string;
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

export interface ReconciliationInputRow {
  readonly verdict_row_id: string;
  readonly tenant_id: string;
  readonly observation_id: string;
  readonly subject_entity_id: string;
  readonly attribute: string;
  readonly kind: string;
  readonly evidence_class: string;
  readonly reliability: string;
  readonly confidence: number | null;
  readonly observed_at: string | null;
  readonly recorded_at: string;
  readonly valid_from: string | null;
  readonly valid_until: string | null;
  readonly valid_time_known: boolean;
  readonly supersedes: string | null;
}

/**
 * Map a contract verdict (plus its input observations and the canonical
 * envelope) onto the substrate row. The envelope is stamped through the
 * contract's own `verdictDraft` — the adapter never re-implements the
 * envelope law.
 */
export function verdictToRows(
  verdict: ReconciliationVerdict,
  observations: readonly ReconciliationObservation[],
  envelope: KernelObjectEnvelopeInput,
  knownObjectTypes?: readonly string[],
): { verdict: ReconciliationVerdictRow; inputs: readonly ReconciliationInputRow[] } {
  const stamped = verdictDraft(verdict, envelope, knownObjectTypes);
  const id = verdictRowId(verdict);
  if (id.length < 1 || id.length > 160) {
    throw new MappingError(`verdict row id must be 1-160 characters (received ${id.length})`);
  }
  const row: ReconciliationVerdictRow = {
    id,
    tenant_id: verdict.tenant_id,
    verdict_id: verdict.verdict_id,
    subject_entity_id: verdict.subject_entity_id,
    attribute: verdict.attribute,
    outcome: verdict.outcome,
    rule_applied: verdict.rule_applied,
    applied_rules: jsonValue(verdict.applied_rules),
    resolution_trace: jsonValue(verdict.resolution_trace),
    value: verdict.value == null ? null : jsonValue(verdict.value),
    winner_id: verdict.winner_id,
    inputs: jsonValue(verdict.inputs),
    superseded: jsonValue(verdict.superseded),
    duplicates: jsonValue(verdict.duplicates),
    residual_uncertainty: jsonValue(verdict.residual_uncertainty),
    valid_from: verdict.valid_from,
    valid_until: null,
    valid_time_known: verdict.valid_time_known === true,
    recorded_at: verdict.recorded_at,
    verdict_provenance: jsonValue(verdict.provenance),
    object_type: requireEnvelopeString(stamped, "object_type"),
    schema_version: requireEnvelopeString(stamped, "schema_version"),
    status: requireEnvelopeString(stamped, "status"),
    created_by: requireEnvelopeString(stamped, "created_by"),
    updated_by: requireEnvelopeString(stamped, "updated_by"),
    provenance: jsonValue(stamped.provenance),
    policy_context: jsonValue(stamped.policy_context),
    trace_id: requireEnvelopeString(stamped, "trace_id"),
    correlation_id: requireEnvelopeString(stamped, "correlation_id"),
    causation_id: optionalEnvelopeString(stamped, "causation_id"),
    parent_event_id: optionalEnvelopeString(stamped, "parent_event_id"),
    declared_origin: optionalEnvelopeString(stamped, "declared_origin"),
  };
  const inputs: ReconciliationInputRow[] = [];
  for (const inputId of verdict.inputs) {
    const observation = observations.find((entry) => entry.id === inputId);
    if (observation == null) {
      throw new MappingError(
        `verdict input "${inputId}" has no matching observation — inputs persist their decision-bearing fields verbatim`,
      );
    }
    inputs.push({
      verdict_row_id: id,
      tenant_id: verdict.tenant_id,
      observation_id: observation.id,
      subject_entity_id: observation.subject_entity_id,
      attribute: observation.attribute,
      kind: observation.kind,
      evidence_class: observation.evidence_class,
      reliability: observation.reliability,
      confidence: observation.confidence,
      observed_at: observation.observed_at,
      recorded_at: observation.recorded_at,
      valid_from: observation.valid_from,
      valid_until: observation.valid_until,
      valid_time_known: observation.valid_time_known === true,
      supersedes: observation.supersedes,
    });
  }
  return { verdict: row, inputs };
}

function requireEnvelopeString(stamped: Record<string, unknown>, key: string): string {
  const value = stamped[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new MappingError(`stamped verdict is missing ${key}`);
  }
  return value.trim();
}

function optionalEnvelopeString(stamped: Record<string, unknown>, key: string): string | null {
  const value = stamped[key];
  if (value == null) return null;
  if (typeof value !== "string") throw new MappingError(`${key} must be a string or null`);
  return value.trim() || null;
}

/** DB row -> contract verdict (minus the envelope, which stays on the row). */
export function rowToVerdict(row: Record<string, unknown>): ReconciliationVerdict {
  if (!isRecord(row)) throw new MappingError("verdict row must be a JSON object");
  const valueRaw = row["value"];
  const value =
    valueRaw == null
      ? null
      : (jsonObject(parseJson(valueRaw, "value"), "value") as unknown as ReconciliationVerdict["value"]);
  const appliedRules = stringArray(
    parseJson(row["applied_rules"], "applied_rules"),
    "applied_rules",
  ) as readonly ReconciliationRuleId[];
  if (appliedRules.length === 0) throw new MappingError("applied_rules must be non-empty");
  return {
    object_type: RECONCILIATION_VERDICT_OBJECT_TYPE,
    verdict_id: requireString(row, "verdict_id", 160),
    tenant_id: requireString(row, "tenant_id", 128),
    subject_entity_id: requireString(row, "subject_entity_id", 160),
    attribute: requireString(row, "attribute", 128),
    outcome: requireVocab(row, "outcome", ["CONVERGED", "RESOLVED", "UNKNOWN", "UNRESOLVED_CONTRADICTION"]) as ReconciliationOutcome,
    rule_applied: optionalVocab(row, "rule_applied", [
      "evidence_class_rank",
      "source_reliability",
      "recency_within_validity",
      "record_time_knowledge",
    ]) as ReconciliationRuleId | null,
    applied_rules: appliedRules,
    resolution_trace: parseJson(row["resolution_trace"], "resolution_trace") as ReconciliationVerdict["resolution_trace"],
    value,
    winner_id: optionalString(row, "winner_id", 160),
    inputs: stringArray(parseJson(row["inputs"], "inputs"), "inputs"),
    superseded: stringArray(parseJson(row["superseded"], "superseded"), "superseded"),
    duplicates: stringArray(parseJson(row["duplicates"], "duplicates"), "duplicates"),
    residual_uncertainty: parseJson(row["residual_uncertainty"], "residual_uncertainty") as ReconciliationVerdict["residual_uncertainty"],
    valid_from: timestampString(row["valid_from"], "valid_from"),
    valid_time_known: row["valid_time_known"] === true,
    recorded_at: requireTimestamp(row, "recorded_at"),
    provenance: parseJson(row["verdict_provenance"], "verdict_provenance") as ReconciliationVerdict["provenance"],
  };
}

function parseJson(value: unknown, key: string): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      throw new MappingError(`${key} is not valid JSON`);
    }
  }
  return value;
}

function requireVocab(row: Record<string, unknown>, key: string, vocab: readonly string[]): string {
  const value = requireString(row, key, 64);
  if (!vocab.includes(value)) throw new MappingError(`${key} "${value}" is not in the declared vocabulary`);
  return value;
}

function optionalVocab(row: Record<string, unknown>, key: string, vocab: readonly string[]): string | null {
  const raw = row[key];
  if (raw == null) return null;
  const value = requireString(row, key, 64);
  if (!vocab.includes(value)) throw new MappingError(`${key} "${value}" is not in the declared vocabulary`);
  return value;
}

/** DB row -> contract-side input snapshot. */
export function rowToInput(row: Record<string, unknown>): ReconciliationInputRow {
  if (!isRecord(row)) throw new MappingError("input row must be a JSON object");
  const confidenceRaw = row["confidence"];
  if (confidenceRaw != null && (typeof confidenceRaw !== "number" || !Number.isFinite(confidenceRaw) || confidenceRaw < 0 || confidenceRaw > 1)) {
    throw new MappingError("confidence must be a finite number between 0 and 1");
  }
  return {
    verdict_row_id: requireString(row, "verdict_row_id", 160),
    tenant_id: requireString(row, "tenant_id", 128),
    observation_id: requireString(row, "observation_id", 160),
    subject_entity_id: requireString(row, "subject_entity_id", 160),
    attribute: requireString(row, "attribute", 128),
    kind: requireVocab(row, "kind", ["observed", "reported", "inferred", "predicted", "simulated"]),
    evidence_class: requireVocab(row, "evidence_class", [
      "direct_observation",
      "generated",
      "simulated",
      "predicted",
      "derived",
      "attested",
    ]),
    reliability: requireVocab(row, "reliability", ["authoritative", "reliable", "provisional", "unverified"]),
    confidence: confidenceRaw == null ? null : confidenceRaw,
    observed_at: timestampString(row["observed_at"], "observed_at"),
    recorded_at: requireTimestamp(row, "recorded_at"),
    valid_from: timestampString(row["valid_from"], "valid_from"),
    valid_until: timestampString(row["valid_until"], "valid_until"),
    valid_time_known: row["valid_time_known"] === true,
    supersedes: optionalString(row, "supersedes", 160),
  };
}

/* ─────────────────────────────────────────────────────────────
 * The adapter
 * ────────────────────────────────────────────────────────────*/

export interface ReconciliationStoreConfig {
  client: ReconciliationDbClient;
  /** J-045: declared adapter failure policy; defaulted when omitted. */
  failurePolicy?: AdapterFailurePolicy;
}

export interface SaveVerdictInput {
  readonly verdict: ReconciliationVerdict;
  readonly observations: readonly ReconciliationObservation[];
  readonly envelope: KernelObjectEnvelopeInput;
  readonly knownObjectTypes?: readonly string[];
}

export interface ReconciliationStore {
  /** Append one verdict + its retained inputs. Idempotent, never retried. */
  saveVerdict(input: SaveVerdictInput): Promise<ReconciliationStoreResult<{ id: string; inputs: number }>>;
  /** Load all persisted verdicts for a tenant (most recent first). */
  loadVerdicts(tenantId: string): Promise<ReconciliationStoreResult<readonly ReconciliationVerdict[]>>;
  /** Load the retained input snapshots of one verdict row. */
  loadInputs(verdictRowId: string, tenantId: string): Promise<ReconciliationStoreResult<readonly ReconciliationInputRow[]>>;
  /** The declared failure policy (observability: snapshot, trust ledger). */
  readonly policy: AdapterFailurePolicy;
}

export function createReconciliationStore(config: ReconciliationStoreConfig): ReconciliationStore {
  const policy = config.failurePolicy ?? RECONCILIATION_FAILURE_POLICY;
  const client = config.client;

  function containMapping<T>(operation: string, fn: () => T): ReconciliationStoreResult<T> {
    const contained = policy.containSync(operation, fn);
    if (contained.outcome === "ok") {
      return { ok: true, value: contained.value, attempts: contained.attempts, durationMs: contained.durationMs, mode: contained.mode };
    }
    return fail("invalid_input", contained.reason, contained.attempts, contained.durationMs, contained.mode);
  }

  function fromCall<T>(outcome: AdapterCallResult<T>): ReconciliationStoreResult<T> {
    if (outcome.outcome === "ok") {
      return { ok: true, value: outcome.value, attempts: outcome.attempts, durationMs: outcome.durationMs, mode: outcome.mode };
    }
    return fail(outcome.code, outcome.reason, outcome.attempts, outcome.durationMs, outcome.mode);
  }

  return {
    policy,

    async saveVerdict(input: SaveVerdictInput): Promise<ReconciliationStoreResult<{ id: string; inputs: number }>> {
      const mapped = containMapping("reconciliation.map_verdict", () =>
        verdictToRows(input.verdict, input.observations, input.envelope, input.knownObjectTypes),
      );
      if (!mapped.ok) return mapped;
      const { verdict: row, inputs: inputRows } = mapped.value;
      const outcome = await policy.run({
        operation: "reconciliation.save_verdict",
        // Append-only writes are idempotent in the substrate but never
        // transport-retried (J-045 write posture).
        maxAttempts: 1,
        call: async () => {
          await client.query(
            `INSERT INTO public.${RECONCILIATION_VERDICT_TABLE}
              (id, tenant_id, verdict_id, subject_entity_id, attribute, outcome, rule_applied,
               applied_rules, resolution_trace, value, winner_id, inputs, superseded, duplicates,
               residual_uncertainty, valid_from, valid_until, valid_time_known, recorded_at,
               verdict_provenance, object_type, schema_version, status, created_by, updated_by,
               provenance, policy_context, trace_id, correlation_id, causation_id, parent_event_id,
               declared_origin)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
                     $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32)
             ON CONFLICT (id, tenant_id) DO NOTHING`,
            [
              row.id, row.tenant_id, row.verdict_id, row.subject_entity_id, row.attribute, row.outcome,
              row.rule_applied, row.applied_rules, row.resolution_trace, row.value, row.winner_id,
              row.inputs, row.superseded, row.duplicates, row.residual_uncertainty, row.valid_from,
              row.valid_until, row.valid_time_known, row.recorded_at, row.verdict_provenance,
              row.object_type, row.schema_version, row.status, row.created_by, row.updated_by,
              row.provenance, row.policy_context, row.trace_id, row.correlation_id, row.causation_id,
              row.parent_event_id, row.declared_origin,
            ],
          );
          for (const inputRow of inputRows) {
            await client.query(
              `INSERT INTO public.${RECONCILIATION_INPUT_TABLE}
                (verdict_row_id, tenant_id, observation_id, subject_entity_id, attribute, kind,
                 evidence_class, reliability, confidence, observed_at, recorded_at, valid_from,
                 valid_until, valid_time_known, supersedes)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
               ON CONFLICT (verdict_row_id, observation_id) DO NOTHING`,
              [
                inputRow.verdict_row_id, inputRow.tenant_id, inputRow.observation_id,
                inputRow.subject_entity_id, inputRow.attribute, inputRow.kind, inputRow.evidence_class,
                inputRow.reliability, inputRow.confidence, inputRow.observed_at, inputRow.recorded_at,
                inputRow.valid_from, inputRow.valid_until, inputRow.valid_time_known, inputRow.supersedes,
              ],
            );
          }
          return { id: row.id, inputs: inputRows.length };
        },
      });
      return fromCall(outcome);
    },

    async loadVerdicts(tenantId: string): Promise<ReconciliationStoreResult<readonly ReconciliationVerdict[]>> {
      if (tenantId.trim() === "") {
        return fail("invalid_input", "tenantId is required — reconciliation never crosses tenants", 0, 0, policy.snapshot().mode);
      }
      const outcome = await policy.run({
        operation: "reconciliation.load_verdicts",
        call: async () =>
          client.query(
            `SELECT * FROM public.${RECONCILIATION_VERDICT_TABLE} WHERE tenant_id = $1
             ORDER BY recorded_at DESC, id ASC`,
            [tenantId],
          ),
      });
      if (outcome.outcome === "error") return fromCall(outcome);
      const mapped = containMapping("reconciliation.map_verdicts", () =>
        outcome.value.rows.map(rowToVerdict),
      );
      if (!mapped.ok) return mapped;
      return { ok: true, value: mapped.value, attempts: outcome.attempts, durationMs: outcome.durationMs, mode: outcome.mode };
    },

    async loadInputs(verdictRowIdValue: string, tenantId: string): Promise<ReconciliationStoreResult<readonly ReconciliationInputRow[]>> {
      if (tenantId.trim() === "" || verdictRowIdValue.trim() === "") {
        return fail("invalid_input", "verdictRowId and tenantId are required", 0, 0, policy.snapshot().mode);
      }
      const outcome = await policy.run({
        operation: "reconciliation.load_inputs",
        call: async () =>
          client.query(
            `SELECT * FROM public.${RECONCILIATION_INPUT_TABLE}
             WHERE verdict_row_id = $1 AND tenant_id = $2 ORDER BY observation_id ASC`,
            [verdictRowIdValue, tenantId],
          ),
      });
      if (outcome.outcome === "error") return fromCall(outcome);
      const mapped = containMapping("reconciliation.map_inputs", () =>
        outcome.value.rows.map(rowToInput),
      );
      if (!mapped.ok) return mapped;
      return { ok: true, value: mapped.value, attempts: outcome.attempts, durationMs: outcome.durationMs, mode: outcome.mode };
    },
  };
}