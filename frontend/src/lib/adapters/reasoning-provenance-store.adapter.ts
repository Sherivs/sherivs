/**
 * CoreGrid — DB-backed substrate adapter for the reasoning-provenance contract
 * (J-015 / V1CAP-029 / MISSION-R-33), persisting ai-gateway/reasoning-provenance.ts
 * intelligence snapshots into the table authored by
 * database/supabase/migrations/20261002000009_coregrid_v1_reasoning_provenance.sql.
 *
 * Composition, not rewrite: the pure contract stays untouched — this adapter
 * validates snapshots through the contract's own fail-closed gate
 * (`validateIntelligenceSnapshot`), maps contract snapshots <-> DB rows, and
 * is the ONLY place vendor/DB calls appear (Constitution §24/§25).
 * Service-role access only: the table is zero-policy deny-by-default (RLS
 * enabled, all anon/authenticated privileges revoked), so no policy-bearing
 * client is accepted — the injected client is a minimal service-role surface.
 *
 * Failure semantics (J-045): the one pattern every external adapter inherits.
 * All I/O runs through AdapterFailurePolicy.run (bounded timeout, retry caps,
 * breaker, degraded mode events, trust ledger); mapping/validation are local
 * operations and run through containSync — malformed contract data or
 * malformed DB rows become structured errors, never thrown. Writes are
 * append-only and idempotent (ON CONFLICT DO NOTHING) but non-transport-
 * retried (maxAttempts: 1); reads may retry (idempotent).
 *
 * Append-only law: snapshots are immutable by construction (deep-frozen,
 * superseded by producing a new one) — saving the same snapshot twice is a
 * no-op, and no UPDATE/DELETE path is authored here. Minimization: the
 * adapter persists the snapshot's metadata and digests only — the AI output
 * payload is never stored (Constitution §19). Purity: no wall-clock sampling
 * — every audit instant is a supplied parameter. No credentials, no secret
 * values, no sensitive payload logging (Constitution §29).
 */
import { createAdapterFailurePolicy, type AdapterCallResult, type AdapterFailurePolicy, type AdapterMode } from "./failure-policy";
import { validateIntelligenceSnapshot, type IntelligenceSnapshot } from "../ai-gateway/reasoning-provenance";
import type { KernelObjectEnvelopeInput } from "../kernel/reality";

/* ─────────────────────────────────────────────────────────────
 * Injected service-role client (minimal surface; no credentials here)
 * ────────────────────────────────────────────────────────────*/

export interface ReasoningProvenanceDbClient {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: readonly Record<string, unknown>[] }>;
}

export const REASONING_PROVENANCE_SNAPSHOT_TABLE = "cg_reasoning_provenance_snapshot";

/**
 * Declared failure-semantics policy for the reasoning-provenance substrate
 * (J-045). Callers may inject their own instance via
 * ReasoningProvenanceStoreConfig.
 */
export const REASONING_PROVENANCE_FAILURE_POLICY: AdapterFailurePolicy = createAdapterFailurePolicy({
  provider: "cg-substrate-reasoning-provenance",
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

export const REASONING_PROVENANCE_SNAPSHOT_COLUMNS = [
  "id",
  "tenant_id",
  "snapshot_id",
  "schema_version",
  "evidence_class",
  "generated_by_ai",
  "model_id",
  "model_provider_class",
  "context_trace_id",
  "context_content_digest",
  "routed_via_registry",
  "routing_rationale",
  "actor_ref",
  "agent_ref",
  "mission_ref",
  "purpose",
  "tokens_in",
  "tokens_out",
  "estimated_cost_usd",
  "output_digest",
  "provenance_source",
  "provenance_source_ref",
  "recorded_by",
  "origin_tenant_id",
  "verified",
  "recorded_at",
  "object_type",
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

/* ─────────────────────────────────────────────────────────────
 * Mapping helpers (strict, fail-closed, no `any`)
 * ────────────────────────────────────────────────────────────*/

export type ReasoningProvenanceStoreErrorCode =
  | "invalid_input"
  | "timeout"
  | "provider_error"
  | "breaker_open";

export type ReasoningProvenanceStoreResult<T> =
  | { ok: true; value: T; attempts: number; durationMs: number; mode: AdapterMode }
  | {
      ok: false;
      code: ReasoningProvenanceStoreErrorCode;
      reason: string;
      attempts: number;
      durationMs: number;
      mode: AdapterMode;
    };

/** Structured failure with full call observability (AdapterCallError parity). */
function fail<T>(
  code: ReasoningProvenanceStoreErrorCode,
  reason: string,
  attempts: number,
  durationMs: number,
  mode: AdapterMode,
): ReasoningProvenanceStoreResult<T> {
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

function requireTimestamp(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new MappingError(`${key} is an invalid instant`);
    return value.toISOString();
  }
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new MappingError(`${key} is required and must be a parsable instant`);
  }
  return value;
}

function requireDigest(row: Record<string, unknown>, key: string): string {
  const value = requireString(row, key, 160);
  if (!/^sha256:[0-9a-f]{64}$/.test(value)) {
    throw new MappingError(`${key} must be a sha256 content digest`);
  }
  return value;
}

function requireBoolean(row: Record<string, unknown>, key: string): boolean {
  const raw = row[key];
  if (typeof raw !== "boolean") throw new MappingError(`${key} must be a boolean`);
  return raw;
}

function requireNonNegativeNumber(row: Record<string, unknown>, key: string): number {
  const raw = row[key];
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
    throw new MappingError(`${key} must be a finite non-negative number`);
  }
  return raw;
}

function optionalNonNegativeNumber(row: Record<string, unknown>, key: string): number | null {
  const raw = row[key];
  if (raw == null) return null;
  return requireNonNegativeNumber(row, key);
}

function jsonObject(value: unknown, key: string): Record<string, unknown> {
  if (!isRecord(value)) throw new MappingError(`${key} must be a JSON object`);
  return value;
}

function jsonValue(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/* ─────────────────────────────────────────────────────────────
 * Contract snapshot -> DB row
 * ────────────────────────────────────────────────────────────*/

export interface ReasoningProvenanceSnapshotRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly snapshot_id: string;
  readonly schema_version: string;
  readonly evidence_class: string;
  readonly generated_by_ai: boolean;
  readonly model_id: string;
  readonly model_provider_class: string | null;
  readonly context_trace_id: string | null;
  readonly context_content_digest: string | null;
  readonly routed_via_registry: boolean;
  readonly routing_rationale: string;
  readonly actor_ref: string;
  readonly agent_ref: string | null;
  readonly mission_ref: string | null;
  readonly purpose: string;
  readonly tokens_in: number;
  readonly tokens_out: number;
  readonly estimated_cost_usd: number | null;
  readonly output_digest: string;
  readonly provenance_source: string;
  readonly provenance_source_ref: string | null;
  readonly recorded_by: string | null;
  readonly origin_tenant_id: string;
  readonly verified: boolean;
  readonly recorded_at: string;
  readonly object_type: string;
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

/**
 * Map a contract intelligence snapshot (plus the canonical envelope it is
 * stamped onto persistent kernel objects with) onto the substrate row. The
 * snapshot is validated through the contract's own fail-closed gate first —
 * an incomplete snapshot is never persistable.
 */
export function snapshotToRow(
  snapshot: IntelligenceSnapshot,
  envelope: KernelObjectEnvelopeInput,
): ReasoningProvenanceSnapshotRow {
  const validated = validateIntelligenceSnapshot(snapshot);
  const tenantId = validated.attribution.tenantRef.trim();
  const envelopeStrings = {
    objectType: requireEnvelopeString(envelope, "objectType"),
    schemaVersion: requireEnvelopeString(envelope, "schemaVersion"),
    status: requireEnvelopeString(envelope, "status"),
    createdBy: requireEnvelopeString(envelope, "createdBy"),
    updatedBy: requireEnvelopeString(envelope, "updatedBy"),
    traceId: requireEnvelopeString(envelope, "traceId"),
    correlationId: requireEnvelopeString(envelope, "correlationId"),
  };
  if (envelopeStrings.schemaVersion !== validated.schemaVersion) {
    throw new MappingError(
      `envelope schemaVersion "${envelopeStrings.schemaVersion}" must equal the snapshot contract version "${validated.schemaVersion}"`,
    );
  }
  const id = validated.snapshotId;
  if (id.length < 1 || id.length > 160) {
    throw new MappingError(`snapshot row id must be 1-160 characters (received ${id.length})`);
  }
  const originTenantId = validated.provenance.originTenantId;
  if (originTenantId == null || originTenantId.trim() === "") {
    throw new MappingError("provenance.originTenantId must be a non-empty string");
  }
  return {
    id,
    tenant_id: tenantId,
    snapshot_id: validated.snapshotId,
    schema_version: validated.schemaVersion,
    evidence_class: validated.evidenceClass,
    generated_by_ai: validated.generatedByAi,
    model_id: validated.model.id,
    model_provider_class: validated.model.providerClass,
    context_trace_id: validated.contextVersion.traceId,
    context_content_digest: validated.contextVersion.contentDigest,
    routed_via_registry: validated.routing.routedViaRegistry,
    routing_rationale: jsonValue(validated.routing.rationale),
    actor_ref: validated.attribution.actorRef,
    agent_ref: validated.attribution.agentRef,
    mission_ref: validated.attribution.missionRef,
    purpose: validated.attribution.purpose,
    tokens_in: validated.usage.tokensIn,
    tokens_out: validated.usage.tokensOut,
    estimated_cost_usd: validated.usage.estimatedCostUsd,
    output_digest: validated.outputDigest,
    provenance_source: validated.provenance.source,
    provenance_source_ref: validated.provenance.sourceRef,
    recorded_by: validated.provenance.recordedBy,
    origin_tenant_id: originTenantId.trim(),
    verified: validated.provenance.verified,
    recorded_at: validated.recordedAt,
    object_type: envelopeStrings.objectType,
    status: envelopeStrings.status,
    created_by: envelopeStrings.createdBy,
    updated_by: envelopeStrings.updatedBy,
    provenance: jsonValue(envelope.provenance),
    policy_context: jsonValue(envelope.policyContext),
    trace_id: envelopeStrings.traceId,
    correlation_id: envelopeStrings.correlationId,
    causation_id: optionalEnvelopeString(envelope, "causationId"),
    parent_event_id: optionalEnvelopeString(envelope, "parentEventId"),
    declared_origin: optionalEnvelopeString(envelope, "declaredOrigin"),
  };
}

function requireEnvelopeString(envelope: KernelObjectEnvelopeInput, key: string): string {
  const value = (envelope as unknown as Record<string, unknown>)[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new MappingError(`envelope is missing ${key}`);
  }
  return value.trim();
}

function optionalEnvelopeString(envelope: KernelObjectEnvelopeInput, key: string): string | null {
  const value = (envelope as unknown as Record<string, unknown>)[key];
  if (value == null) return null;
  if (typeof value !== "string") throw new MappingError(`${key} must be a string or null`);
  return value.trim() || null;
}

/** DB row -> contract snapshot (the metadata the substrate persists). */
export function rowToSnapshot(row: Record<string, unknown>): IntelligenceSnapshot {
  if (!isRecord(row)) throw new MappingError("snapshot row must be a JSON object");
  const rationale = parseJson(row["routing_rationale"], "routing_rationale");
  if (!Array.isArray(rationale) || rationale.length === 0) {
    throw new MappingError("routing_rationale must be a non-empty array");
  }
  return {
    schemaVersion: requireString(row, "schema_version", 32),
    snapshotId: requireDigest(row, "snapshot_id"),
    evidenceClass: "generated",
    generatedByAi: true,
    model: {
      id: requireString(row, "model_id", 200),
      providerClass: optionalString(row, "model_provider_class", 200),
    },
    contextVersion: {
      traceId: optionalString(row, "context_trace_id", 200),
      contentDigest: optionalString(row, "context_content_digest", 200),
    },
    routing: {
      routedViaRegistry: requireBoolean(row, "routed_via_registry"),
      rationale,
    },
    attribution: {
      tenantRef: requireString(row, "tenant_id", 128),
      actorRef: requireString(row, "actor_ref", 200),
      agentRef: optionalString(row, "agent_ref", 200),
      missionRef: optionalString(row, "mission_ref", 200),
      purpose: requireString(row, "purpose", 200),
    },
    usage: {
      tokensIn: requireNonNegativeNumber(row, "tokens_in"),
      tokensOut: requireNonNegativeNumber(row, "tokens_out"),
      estimatedCostUsd: optionalNonNegativeNumber(row, "estimated_cost_usd"),
    },
    outputDigest: requireDigest(row, "output_digest"),
    provenance: {
      source: requireString(row, "provenance_source", 200),
      sourceRef: optionalString(row, "provenance_source_ref", 200),
      recordedBy: optionalString(row, "recorded_by", 200),
      originTenantId: requireString(row, "origin_tenant_id", 128),
      generatedByAi: true,
      verified: false,
    },
    recordedAt: requireTimestamp(row, "recorded_at"),
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

/* ─────────────────────────────────────────────────────────────
 * The adapter
 * ────────────────────────────────────────────────────────────*/

export interface ReasoningProvenanceStoreConfig {
  client: ReasoningProvenanceDbClient;
  /** J-045: declared adapter failure policy; defaulted when omitted. */
  failurePolicy?: AdapterFailurePolicy;
}

export interface SaveSnapshotInput {
  readonly snapshot: IntelligenceSnapshot;
  readonly envelope: KernelObjectEnvelopeInput;
}

export interface ReasoningProvenanceStore {
  /** Append one intelligence snapshot. Idempotent, never retried. */
  saveSnapshot(input: SaveSnapshotInput): Promise<ReasoningProvenanceStoreResult<{ id: string }>>;
  /** Load all persisted snapshots for a tenant (most recent first). */
  loadSnapshots(tenantId: string): Promise<ReasoningProvenanceStoreResult<readonly IntelligenceSnapshot[]>>;
  /** The declared failure policy (observability: snapshot, trust ledger). */
  readonly policy: AdapterFailurePolicy;
}

export function createReasoningProvenanceStore(
  config: ReasoningProvenanceStoreConfig,
): ReasoningProvenanceStore {
  const policy = config.failurePolicy ?? REASONING_PROVENANCE_FAILURE_POLICY;
  const client = config.client;

  function containMapping<T>(operation: string, fn: () => T): ReasoningProvenanceStoreResult<T> {
    const contained = policy.containSync(operation, fn);
    if (contained.outcome === "ok") {
      return { ok: true, value: contained.value, attempts: contained.attempts, durationMs: contained.durationMs, mode: contained.mode };
    }
    return fail("invalid_input", contained.reason, contained.attempts, contained.durationMs, contained.mode);
  }

  function fromCall<T>(outcome: AdapterCallResult<T>): ReasoningProvenanceStoreResult<T> {
    if (outcome.outcome === "ok") {
      return { ok: true, value: outcome.value, attempts: outcome.attempts, durationMs: outcome.durationMs, mode: outcome.mode };
    }
    return fail(outcome.code, outcome.reason, outcome.attempts, outcome.durationMs, outcome.mode);
  }

  return {
    policy,

    async saveSnapshot(input: SaveSnapshotInput): Promise<ReasoningProvenanceStoreResult<{ id: string }>> {
      const mapped = containMapping("reasoning-provenance.map_snapshot", () =>
        snapshotToRow(input.snapshot, input.envelope),
      );
      if (!mapped.ok) return mapped;
      const row = mapped.value;
      const outcome = await policy.run({
        operation: "reasoning-provenance.save_snapshot",
        // Append-only writes are idempotent in the substrate but never
        // transport-retried (J-045 write posture).
        maxAttempts: 1,
        call: async () => {
          await client.query(
            `INSERT INTO public.${REASONING_PROVENANCE_SNAPSHOT_TABLE}
              (id, tenant_id, snapshot_id, schema_version, evidence_class, generated_by_ai,
               model_id, model_provider_class, context_trace_id, context_content_digest,
               routed_via_registry, routing_rationale, actor_ref, agent_ref, mission_ref,
               purpose, tokens_in, tokens_out, estimated_cost_usd, output_digest,
               provenance_source, provenance_source_ref, recorded_by, origin_tenant_id,
               verified, recorded_at, object_type, status, created_by, updated_by,
               provenance, policy_context, trace_id, correlation_id, causation_id,
               parent_event_id, declared_origin)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
                     $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37)
             ON CONFLICT (id, tenant_id) DO NOTHING`,
            [
              row.id, row.tenant_id, row.snapshot_id, row.schema_version, row.evidence_class,
              row.generated_by_ai, row.model_id, row.model_provider_class, row.context_trace_id,
              row.context_content_digest, row.routed_via_registry, row.routing_rationale,
              row.actor_ref, row.agent_ref, row.mission_ref, row.purpose, row.tokens_in,
              row.tokens_out, row.estimated_cost_usd, row.output_digest, row.provenance_source,
              row.provenance_source_ref, row.recorded_by, row.origin_tenant_id, row.verified,
              row.recorded_at, row.object_type, row.status, row.created_by, row.updated_by,
              row.provenance, row.policy_context, row.trace_id, row.correlation_id,
              row.causation_id, row.parent_event_id, row.declared_origin,
            ],
          );
          return { id: row.id };
        },
      });
      return fromCall(outcome);
    },

    async loadSnapshots(tenantId: string): Promise<ReasoningProvenanceStoreResult<readonly IntelligenceSnapshot[]>> {
      if (tenantId.trim() === "") {
        return fail("invalid_input", "tenantId is required — snapshots never cross tenants", 0, 0, policy.snapshot().mode);
      }
      const outcome = await policy.run({
        operation: "reasoning-provenance.load_snapshots",
        call: async () =>
          client.query(
            `SELECT * FROM public.${REASONING_PROVENANCE_SNAPSHOT_TABLE} WHERE tenant_id = $1
             ORDER BY recorded_at DESC, id ASC`,
            [tenantId],
          ),
      });
      if (outcome.outcome === "error") return fromCall(outcome);
      const mapped = containMapping("reasoning-provenance.map_snapshots", () =>
        outcome.value.rows.map(rowToSnapshot),
      );
      if (!mapped.ok) return mapped;
      return { ok: true, value: mapped.value, attempts: outcome.attempts, durationMs: outcome.durationMs, mode: outcome.mode };
    },
  };
}
