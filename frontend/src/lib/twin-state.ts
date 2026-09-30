/**
 * CoreGrid — Digital Twin State, Observation and Synchronization
 * domain model
 * (Phase 16, Sections T, U, V, W, X, Y, Z, AA, AB, AC, AD, AE, AF, AG, AH,
 * AI, AJ, AK, AL, AM, AN, AO, AP, AQ, AR).
 *
 * Implements `architecture/phase-16-digital-twin.md`:
 * - Temporal model (T): valid time, transaction time, event time,
 *   observation time, ingestion time, effective time, expiration time.
 * - Current state (U) and historical state (V): historical state must
 *   never be overwritten by current state.
 * - Snapshots (W): snapshots optimize reconstruction but maintain lineage
 *   to the underlying event/state history.
 * - Event-sourced state (X): EVENTS -> STATE REDUCER -> CURRENT STATE.
 * - State transitions (Y) and state machines (Z): invalid transitions
 *   rejected; each state identifies source, timestamp, confidence,
 *   validity, freshness, provenance (AA).
 * - Observations (AB-AD): evidence about a real-world entity; observation
 *   != truth; sources include hardware, human input, application,
 *   external API, government dataset, manual inspection, derived
 *   computation; provenance preserves source/sourceId/timestamps/
 *   transformation/confidence/quality/version.
 * - Observation quality (AE): VALID, ESTIMATED, STALE, MISSING,
 *   CONFLICTING, INVALID, UNVERIFIED.
 * - Reconciliation (AF) and conflict resolution (AG): conflicting
 *   observations are preserved, never silently erased; the final state
 *   retains explainable provenance.
 * - Confidence (AH), fidelity (AI), freshness (AJ), staleness (AK).
 * - Synchronization (AL-AR): OBSERVATION -> VALIDATION -> NORMALIZATION ->
 *   MAPPING -> STATE UPDATE -> RELATIONSHIP UPDATE -> EVENT -> TWIN
 *   PROJECTION; failure states SYNC_PENDING / SYNC_FAILED / SYNC_PARTIAL /
 *   SYNC_CONFLICT; reconciliation detects missing entities, stale state,
 *   conflicting sources, invalid relationships, orphaned twins, schema
 *   mismatches.
 *
 * Invariants (FA): historical state never silently overwritten (14);
 * twin state distinguishable from source observations (18); conflicting
 * observations never silently discarded (19); conflict resolution
 * explainable (20); freshness measurable (21); fidelity measurable (22);
 * confidence explainable (23).
 */

import type { TenantId } from "./tenant-core";

/* ─────────────────────────────────────────────────────────────
 * Temporal model (T)
 * ────────────────────────────────────────────────────────────*/

export interface TemporalTimes {
  validTime: string | null;
  transactionTime: string;
  eventTime: string | null;
  observationTime: string | null;
  ingestionTime: string;
  effectiveTime: string | null;
  expirationTime: string | null;
}

export function createTemporalTimes(
  input: Omit<TemporalTimes, "transactionTime">,
  transactionTime: string,
): TemporalTimes {
  return { ...input, transactionTime };
}

/* ─────────────────────────────────────────────────────────────
 * Observation model (AB, AC, AD, AE)
 * ────────────────────────────────────────────────────────────*/

export type ObservationSource =
  | "hardware"
  | "human_input"
  | "application"
  | "external_api"
  | "government_dataset"
  | "manual_inspection"
  | "derived_computation";

export const OBSERVATION_SOURCES: readonly ObservationSource[] = [
  "hardware",
  "human_input",
  "application",
  "external_api",
  "government_dataset",
  "manual_inspection",
  "derived_computation",
] as const;

export type ObservationQuality =
  "VALID" | "ESTIMATED" | "STALE" | "MISSING" | "CONFLICTING" | "INVALID" | "UNVERIFIED";

export const OBSERVATION_QUALITIES: readonly ObservationQuality[] = [
  "VALID",
  "ESTIMATED",
  "STALE",
  "MISSING",
  "CONFLICTING",
  "INVALID",
  "UNVERIFIED",
] as const;

export interface TwinObservation {
  observationId: string;
  twinId: string;
  tenantId: TenantId;
  source: ObservationSource;
  sourceId: string | null;
  observedAt: string | null;
  ingestedAt: string;
  transformation: string | null;
  confidence: number | null;
  quality: ObservationQuality;
  version: number;
  value: unknown;
  raw: unknown;
}

export interface RecordObservationInput {
  twinId: string;
  tenantId: TenantId;
  source: ObservationSource;
  sourceId?: string | null;
  observedAt?: string | null;
  ingestedAt: string;
  transformation?: string | null;
  confidence?: number | null;
  quality?: ObservationQuality;
  version?: number;
  value: unknown;
}

export type RecordObservationResult =
  { ok: true; observation: TwinObservation } | { ok: false; error: string };

/**
 * Record an observation (AB-AD). Observation != truth (AB); provenance is
 * preserved (AD); the raw value is kept verbatim and never mutated by
 * interpretation.
 */
export function recordObservation(input: RecordObservationInput): RecordObservationResult {
  if (
    input.observedAt !== null &&
    input.observedAt !== undefined &&
    Number.isNaN(Date.parse(input.observedAt))
  ) {
    return { ok: false, error: "Observation timestamp is invalid (T)" };
  }
  if (
    input.observedAt !== null &&
    input.observedAt !== undefined &&
    Date.parse(input.observedAt) > Date.parse(input.ingestedAt)
  ) {
    return { ok: false, error: "Observation time cannot be after ingestion time (T)" };
  }
  return {
    ok: true,
    observation: {
      observationId: `obs-${input.twinId}-${input.ingestedAt}-${Math.random().toString(36).slice(2, 8)}`,
      twinId: input.twinId,
      tenantId: input.tenantId,
      source: input.source,
      sourceId: input.sourceId ?? null,
      observedAt: input.observedAt ?? null,
      ingestedAt: input.ingestedAt,
      transformation: input.transformation ?? null,
      confidence: input.confidence ?? null,
      quality: input.quality ?? "UNVERIFIED",
      version: input.version ?? 1,
      value: input.value,
      raw: input.value,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Observation reconciliation and conflict resolution (AF, AG)
 * ────────────────────────────────────────────────────────────*/

export interface ConflictResolutionInput {
  observations: TwinObservation[];
  sourceAuthority: Record<string, number>;
}

export type ConflictResolutionResult =
  | { ok: true; selected: TwinObservation; conflicting: TwinObservation[]; reason: string }
  | { ok: false; error: string };

/**
 * Resolve conflicting observations (AF, AG). The conflict is never
 * silently erased: all conflicting observations are returned alongside
 * the selected one, and the reason is explainable (source authority,
 * freshness, confidence).
 */
export function resolveConflictingObservations(
  input: ConflictResolutionInput,
): ConflictResolutionResult {
  if (input.observations.length === 0) {
    return { ok: false, error: "Cannot resolve an empty observation set (AG)" };
  }
  const conflicting = input.observations.filter((o) => o.quality === "CONFLICTING");
  const pool = conflicting.length > 0 ? conflicting : input.observations;
  const scored = pool
    .map((o) => {
      const authority = input.sourceAuthority[o.source] ?? 0;
      const freshness = o.observedAt === null ? 0 : Date.parse(o.observedAt);
      return {
        observation: o,
        score: authority * 1000 + (o.confidence ?? 0) * 10 + freshness / 1_000_000_000,
      };
    })
    .sort((a, b) => b.score - a.score);
  const selected = scored[0].observation;
  const reason = `Selected source="${selected.source}" authority=${input.sourceAuthority[selected.source] ?? 0} confidence=${selected.confidence ?? 0} (AG)`;
  return {
    ok: true,
    selected,
    conflicting: input.observations.filter((o) => o.observationId !== selected.observationId),
    reason,
  };
}

/* ─────────────────────────────────────────────────────────────
 * State model (U, V, AA) and snapshots (W)
 * ────────────────────────────────────────────────────────────*/

export interface TwinStateEntry {
  twinId: string;
  tenantId: TenantId;
  stateName: string;
  value: unknown;
  source: string;
  timestamp: string;
  confidence: number | null;
  validity: "valid" | "estimated" | "stale" | "invalid";
  freshness: number | null;
  provenanceRef: string | null;
}

export interface StateHistory {
  entries: TwinStateEntry[];
  snapshots: StateSnapshot[];
}

/** Snapshots (W) must maintain lineage to the underlying history. */
export interface StateSnapshot {
  snapshotId: string;
  twinId: string;
  at: string;
  stateName: string;
  value: unknown;
  lineageEventCount: number;
}

/**
 * Reconstruct state at a timestamp (V, BK): the last entry whose
 * timestamp is at or before the requested time is returned; if none,
 * the state did not exist at that time.
 */
export function getStateAt(
  entries: TwinStateEntry[],
  twinId: string,
  stateName: string,
  at: string,
): TwinStateEntry | null {
  const relevant = entries
    .filter((e) => e.twinId === twinId && e.stateName === stateName && e.timestamp <= at)
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  return relevant[0] ?? null;
}

export function getStateTransitionHistory(
  entries: TwinStateEntry[],
  twinId: string,
  stateName: string,
): TwinStateEntry[] {
  return entries
    .filter((e) => e.twinId === twinId && e.stateName === stateName)
    .sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
}

/* ─────────────────────────────────────────────────────────────
 * Event-sourced state (X)
 * ────────────────────────────────────────────────────────────*/

export type StateEvent =
  | { kind: "state_set"; stateName: string; value: unknown; at: string }
  | { kind: "state_cleared"; stateName: string; at: string };

export interface StateReducer {
  apply(state: Record<string, unknown>, event: StateEvent): Record<string, unknown>;
}

export const defaultStateReducer: StateReducer = {
  apply(state: Record<string, unknown>, event: StateEvent): Record<string, unknown> {
    if (event.kind === "state_set") {
      return { ...state, [event.stateName]: event.value };
    }
    const next = { ...state };
    delete next[event.stateName];
    return next;
  },
};

/**
 * Event-sourced state (X): EVENTS -> STATE REDUCER -> CURRENT STATE.
 * Replaying the same event sequence always yields the same current state.
 */
export function reconstructState(
  events: StateEvent[],
  reducer: StateReducer,
): Record<string, unknown> {
  return events.reduce(
    (state, event) => reducer.apply(state, event),
    {} as Record<string, unknown>,
  );
}

/* ─────────────────────────────────────────────────────────────
 * State machine (Z)
 * ────────────────────────────────────────────────────────────*/

export interface TwinStateMachine {
  twinKind: string;
  states: string[];
  transitions: Array<{ from: string; to: string }>;
}

export function isStateTransitionAllowed(
  machine: TwinStateMachine,
  from: string,
  to: string,
): boolean {
  return machine.transitions.some((t) => t.from === from && t.to === to);
}

/* ─────────────────────────────────────────────────────────────
 * Freshness, fidelity and staleness (AI, AJ, AK)
 * ────────────────────────────────────────────────────────────*/

export function isTwinStale(
  lastSyncAt: string | null,
  now: string,
  maxFreshnessMs: number,
): boolean {
  if (lastSyncAt === null) {
    return true;
  }
  return Date.parse(now) - Date.parse(lastSyncAt) > maxFreshnessMs;
}

export interface FidelityFactors {
  dataFreshness: number;
  sourceCoverage: number;
  sensorCoverage: number;
  relationshipCompleteness: number;
  stateCompleteness: number;
  synchronizationQuality: number;
}

/** Twin fidelity (AI): how closely the digital representation reflects
 * reality; a composite bounded in [0, 1] and decomposable. */
export function calculateFidelity(factors: FidelityFactors): number {
  const values = [
    factors.dataFreshness,
    factors.sourceCoverage,
    factors.sensorCoverage,
    factors.relationshipCompleteness,
    factors.stateCompleteness,
    factors.synchronizationQuality,
  ];
  const clamped = values.map((v) => Math.max(0, Math.min(1, v)));
  return Number((clamped.reduce((a, b) => a + b, 0) / clamped.length).toFixed(3));
}

/* ─────────────────────────────────────────────────────────────
 * Synchronization pipeline (AL-AR)
 * ────────────────────────────────────────────────────────────*/

export type SyncFailureState = "SYNC_PENDING" | "SYNC_FAILED" | "SYNC_PARTIAL" | "SYNC_CONFLICT";

export interface SyncResult {
  observationId: string;
  twinId: string;
  tenantId: TenantId;
  state: SyncFailureState | "SYNC_COMPLETE";
  projectedState: Record<string, unknown>;
}

/**
 * Synchronization pipeline (AL): OBSERVATION -> VALIDATION ->
 * NORMALIZATION -> MAPPING -> STATE UPDATE -> RELATIONSHIP UPDATE ->
 * EVENT -> TWIN PROJECTION. A source with an invalid or conflicting
 * observation is never projected as authoritative state (18).
 */
export function synchronizeObservation(
  observation: TwinObservation,
  project: (o: TwinObservation) => Record<string, unknown>,
): SyncResult {
  if (observation.quality === "INVALID" || observation.quality === "CONFLICTING") {
    return {
      observationId: observation.observationId,
      twinId: observation.twinId,
      tenantId: observation.tenantId,
      state: observation.quality === "CONFLICTING" ? "SYNC_CONFLICT" : "SYNC_FAILED",
      projectedState: {},
    };
  }
  return {
    observationId: observation.observationId,
    twinId: observation.twinId,
    tenantId: observation.tenantId,
    state: "SYNC_COMPLETE",
    projectedState: project(observation),
  };
}

export interface ReconciliationReport {
  missingEntities: string[];
  staleState: string[];
  conflictingSources: string[];
  invalidRelationships: string[];
  orphanedTwins: string[];
  schemaMismatches: string[];
}
