/**
 * CoreGrid — Digital Twin Governance, Events, Simulation and
 * Health domain model
 * (Phase 16, Sections BI, BJ, BK, BL, BM, BN, BQ, BR, BS, BT, BU, BV, BW,
 * BX, BY, BZ, CA, CB, CC, CD, CE, CF, CG, CH, CI, CJ, CK, CL, CM, CN, CO,
 * CP, CQ, CR, EE, EF, EG, EH, EL, EM, EN, EO, EP, EQ, ER, EC, ED).
 *
 * Implements `architecture/phase-16-digital-twin.md`:
 * - Query engine (BI-BL): graph queries, state queries (current /
 *   historical / at-timestamp / transition history), temporal queries.
 * - Subscriptions (BM) and event streams (BN); standardized events (BQ)
 *   with ordering (BR: sequence, timestamp, source, correlation ID),
 *   duplicate tolerance (BS) and controlled replay (BT).
 * - Simulation (BU-BZ): scenario and what-if modeling; simulation is
 *   isolated (BX), namespaced (BY), and records starting state,
 *   assumptions, inputs, version, model, timestamp, results (BZ).
 *   Simulation never silently modifies production (FA.29).
 * - Prediction boundary (CA-CD): predictions carry value, time, horizon,
 *   confidence, source, model reference; PREDICTED vs ACTUAL are
 *   distinguished and compared.
 * - Health (CE-CK): freshness, completeness, synchronization,
 *   consistency, provenance, source availability, relationship integrity;
 *   composite health score that is explainable (CF); drift detection and
 *   resolution DETECT -> CLASSIFY -> INVESTIGATE -> RECONCILE -> VERIFY.
 * - Security (CL-CQ): access at tenant/institution/twin/attribute/
 *   relationship/operation levels; sensitive twin data; tenant isolation
 *   — twins never leak across tenants without explicit authorized
 *   relationships; cross-tenant relationships require governance (17);
 *   audit (CR).
 * - Retention (EE), historical preservation (EF), archival (EG),
 *   garbage collection (EH) — production history is never collected
 *   accidentally.
 * - Twin trust (EL) and reality score (EN): UNVERIFIED / LOW / MEDIUM /
 *   HIGH / VERIFIED; explainable and decomposable.
 * - Manual override (EO-ER): actor, reason, timestamp, previous value,
 *   new value, evidence; explicit expiration; reconciliation after
 *   override (preserve / replace / challenge / expire).
 * - Import (EC) and export (ED): validation, preview, dry run, rollback,
 *   audit; authorization, filtering, redaction, provenance, versioning.
 *
 * Invariants (FA): twin confidence explainable (23); drift detectable
 * (24); simulation isolated and never silently modifying production
 * (28, 29); manual overrides audited (35); historical evidence survives
 * ordinary retirement (37); event replay must not corrupt production
 * state (45).
 */

import type { TenantId } from "./tenant-core";

/* ─────────────────────────────────────────────────────────────
 * Twin events (BQ, BR, BS)
 * ────────────────────────────────────────────────────────────*/

export type TwinEventType =
  | "twin.created"
  | "twin.updated"
  | "twin.state_changed"
  | "twin.relationship_added"
  | "twin.relationship_removed"
  | "twin.observation_received"
  | "twin.observation_conflict"
  | "twin.synchronization_started"
  | "twin.synchronization_completed"
  | "twin.synchronization_failed"
  | "twin.marked_stale"
  | "twin.reconciled"
  | "twin.merged"
  | "twin.archived";

export const TWIN_EVENT_TYPES: readonly TwinEventType[] = [
  "twin.created",
  "twin.updated",
  "twin.state_changed",
  "twin.relationship_added",
  "twin.relationship_removed",
  "twin.observation_received",
  "twin.observation_conflict",
  "twin.synchronization_started",
  "twin.synchronization_completed",
  "twin.synchronization_failed",
  "twin.marked_stale",
  "twin.reconciled",
  "twin.merged",
  "twin.archived",
] as const;

export interface TwinEvent {
  eventId: string;
  sequence: number;
  type: TwinEventType;
  twinId: string;
  tenantId: TenantId;
  timestamp: string;
  source: string;
  correlationId: string | null;
  payload: Record<string, unknown>;
}

export interface EmitEventInput {
  sequence: number;
  type: TwinEventType;
  twinId: string;
  tenantId: TenantId;
  timestamp: string;
  source: string;
  correlationId?: string | null;
  payload?: Record<string, unknown>;
}

export function emitTwinEvent(input: EmitEventInput): TwinEvent {
  return {
    eventId: `evt-${input.sequence}-${input.twinId}-${Math.random().toString(36).slice(2, 8)}`,
    sequence: input.sequence,
    type: input.type,
    twinId: input.twinId,
    tenantId: input.tenantId,
    timestamp: input.timestamp,
    source: input.source,
    correlationId: input.correlationId ?? null,
    payload: input.payload ?? {},
  };
}

/**
 * Event ordering (BR): preserve sequence, timestamp, source, correlation
 * ID. Events are considered in-order only when sequence is strictly
 * increasing.
 */
export function isEventSequenceInOrder(events: TwinEvent[]): boolean {
  for (let i = 1; i < events.length; i += 1) {
    if (events[i].sequence <= events[i - 1].sequence) {
      return false;
    }
  }
  return true;
}

/** Duplicate events (BS): consumers must tolerate duplicate delivery. */
export function isDuplicateEvent(processedEventIds: Set<string>, event: TwinEvent): boolean {
  return processedEventIds.has(event.eventId);
}

/* ─────────────────────────────────────────────────────────────
 * Temporal queries (BL)
 * ────────────────────────────────────────────────────────────*/

export type TemporalQuery =
  | { kind: "what_was_true_at"; twinId: string; stateName: string; at: string }
  | { kind: "what_changed_between"; twinId: string; stateName: string; from: string; to: string }
  | { kind: "when_did_state_begin"; twinId: string; stateName: string; value: unknown };

export interface TemporalQueryResult {
  twinId: string;
  stateName: string;
  found: boolean;
  detail: string;
}

/* ─────────────────────────────────────────────────────────────
 * Subscriptions (BM, BN)
 * ────────────────────────────────────────────────────────────*/

export type SubscriptionTopic =
  | "twin_changes"
  | "state_changes"
  | "relationship_changes"
  | "observation_updates"
  | "lifecycle_changes";

export const SUBSCRIPTION_TOPICS: readonly SubscriptionTopic[] = [
  "twin_changes",
  "state_changes",
  "relationship_changes",
  "observation_updates",
  "lifecycle_changes",
] as const;

export interface TwinSubscription {
  subscriptionId: string;
  consumerId: string;
  tenantId: TenantId;
  topics: SubscriptionTopic[];
  twinIdFilter: string | null;
}

export function createSubscription(
  consumerId: string,
  tenantId: TenantId,
  topics: SubscriptionTopic[],
  twinIdFilter: string | null = null,
): TwinSubscription {
  return {
    subscriptionId: `sub-${consumerId}-${Math.random().toString(36).slice(2, 8)}`,
    consumerId,
    tenantId,
    topics,
    twinIdFilter,
  };
}

/** A subscription may only receive events within its tenant (CP). */
export function isEventVisibleToSubscription(
  subscription: TwinSubscription,
  event: TwinEvent,
): boolean {
  if (subscription.tenantId !== event.tenantId) {
    return false;
  }
  if (subscription.twinIdFilter !== null && subscription.twinIdFilter !== event.twinId) {
    return false;
  }
  const topicByEvent: Partial<Record<TwinEventType, SubscriptionTopic>> = {
    "twin.created": "twin_changes",
    "twin.updated": "twin_changes",
    "twin.state_changed": "state_changes",
    "twin.relationship_added": "relationship_changes",
    "twin.relationship_removed": "relationship_changes",
    "twin.observation_received": "observation_updates",
    "twin.observation_conflict": "observation_updates",
    "twin.marked_stale": "state_changes",
    "twin.merged": "twin_changes",
    "twin.archived": "lifecycle_changes",
    "twin.synchronization_started": "state_changes",
    "twin.synchronization_completed": "state_changes",
    "twin.synchronization_failed": "state_changes",
    "twin.reconciled": "state_changes",
  };
  const topic = topicByEvent[event.type];
  return topic !== undefined && subscription.topics.includes(topic);
}

/* ─────────────────────────────────────────────────────────────
 * Simulation (BU-BZ)
 * ────────────────────────────────────────────────────────────*/

export interface SimulationInput {
  simulationId: string;
  tenantId: TenantId;
  twinId: string;
  startingState: Record<string, unknown>;
  assumptions: string[];
  inputs: Record<string, unknown>;
  simulationVersion: string;
  model: string;
  timestamp: string;
  namespace: "simulation";
}

export interface SimulationResult {
  simulationId: string;
  twinId: string;
  namespace: "simulation";
  resultingState: Record<string, unknown>;
  timestamp: string;
}

/**
 * Run an isolated simulation (BX, BY): simulated state lives in the
 * "simulation" namespace and must never silently overwrite production
 * state (FA.29). The caller supplies the model; this contract guarantees
 * the boundary.
 */
export function runIsolatedSimulation(
  input: Omit<SimulationInput, "namespace">,
  model: (
    state: Record<string, unknown>,
    inputs: Record<string, unknown>,
  ) => Record<string, unknown>,
): SimulationResult {
  const simulated = model(input.startingState, input.inputs);
  return {
    simulationId: input.simulationId,
    twinId: input.twinId,
    namespace: "simulation",
    resultingState: simulated,
    timestamp: input.timestamp,
  };
}

export function isSimulationResultIsolated(result: SimulationResult): boolean {
  return result.namespace === "simulation";
}

/* ─────────────────────────────────────────────────────────────
 * Prediction (CA, CB, CC, CD)
 * ────────────────────────────────────────────────────────────*/

export interface PredictionRecord {
  predictionId: string;
  twinId: string;
  tenantId: TenantId;
  predictedValue: unknown;
  predictionTime: string;
  horizonMs: number;
  confidence: number | null;
  source: string;
  modelReference: string;
  actualValue: unknown | null;
  actualAt: string | null;
  error: unknown | null;
}

export interface RecordPredictionInput {
  twinId: string;
  tenantId: TenantId;
  predictedValue: unknown;
  predictionTime: string;
  horizonMs: number;
  confidence: number | null;
  source: string;
  modelReference: string;
}

export function recordPrediction(input: RecordPredictionInput): PredictionRecord {
  return {
    predictionId: `pred-${input.twinId}-${input.predictionTime}-${Math.random().toString(36).slice(2, 8)}`,
    twinId: input.twinId,
    tenantId: input.tenantId,
    predictedValue: input.predictedValue,
    predictionTime: input.predictionTime,
    horizonMs: input.horizonMs,
    confidence: input.confidence,
    source: input.source,
    modelReference: input.modelReference,
    actualValue: null,
    actualAt: null,
    error: null,
  };
}

/**
 * Compare a prediction against actuals (CC, CD). PREDICTED and ACTUAL
 * are distinguished; numeric error is computed when both are numbers.
 */
export function recordActual(
  prediction: PredictionRecord,
  actualValue: unknown,
  actualAt: string,
): PredictionRecord {
  const error =
    typeof prediction.predictedValue === "number" && typeof actualValue === "number"
      ? Number((actualValue - prediction.predictedValue).toFixed(4))
      : null;
  return { ...prediction, actualValue, actualAt, error };
}

/* ─────────────────────────────────────────────────────────────
 * Twin health and drift (CE-CK)
 * ────────────────────────────────────────────────────────────*/

export interface TwinHealthFactors {
  freshness: number;
  completeness: number;
  synchronization: number;
  consistency: number;
  provenance: number;
  sourceAvailability: number;
  relationshipIntegrity: number;
}

/** Composite health score (CF) bounded in [0, 1]; explainable because it
 * is the unweighted mean of the underlying factors (CE). */
export function calculateTwinHealthScore(factors: TwinHealthFactors): number {
  const values = [
    factors.freshness,
    factors.completeness,
    factors.synchronization,
    factors.consistency,
    factors.provenance,
    factors.sourceAvailability,
    factors.relationshipIntegrity,
  ];
  const clamped = values.map((v) => Math.max(0, Math.min(1, v)));
  return Number((clamped.reduce((a, b) => a + b, 0) / clamped.length).toFixed(3));
}

export function isTwinHealthy(score: number): boolean {
  return score >= 0.7;
}

export type DriftStep = "DETECT" | "CLASSIFY" | "INVESTIGATE" | "RECONCILE" | "VERIFY";

export const DRIFT_STEPS: readonly DriftStep[] = [
  "DETECT",
  "CLASSIFY",
  "INVESTIGATE",
  "RECONCILE",
  "VERIFY",
] as const;

/**
 * Drift resolution (CK): DETECT -> CLASSIFY -> INVESTIGATE -> RECONCILE ->
 * VERIFY. Steps must be explicitly confirmed in order.
 */
export function isDriftStepAllowed(current: DriftStep | null, next: DriftStep): boolean {
  if (current === null) {
    return next === "DETECT";
  }
  return DRIFT_STEPS.indexOf(next) === DRIFT_STEPS.indexOf(current) + 1;
}

/* ─────────────────────────────────────────────────────────────
 * Security and access (CL-CQ)
 * ────────────────────────────────────────────────────────────*/

export type AccessLevel =
  "tenant" | "institution" | "twin" | "attribute" | "relationship" | "operation";

export const ACCESS_LEVELS: readonly AccessLevel[] = [
  "tenant",
  "institution",
  "twin",
  "attribute",
  "relationship",
  "operation",
] as const;

export type SensitiveTwinDataClass =
  | "individual_location"
  | "occupancy"
  | "biometric_related_device_state"
  | "security_infrastructure"
  | "classroom_activity"
  | "facility_topology";

export const SENSITIVE_TWIN_DATA_CLASSES: readonly SensitiveTwinDataClass[] = [
  "individual_location",
  "occupancy",
  "biometric_related_device_state",
  "security_infrastructure",
  "classroom_activity",
  "facility_topology",
] as const;

export interface TwinAccessDecision {
  actorId: string;
  tenantId: TenantId;
  resourceTwinId: string;
  operation: string;
  allowed: boolean;
  reason: string;
}

/**
 * Twin access control (CM, CP): twins never leak across tenants without
 * explicit authorized relationships. Cross-tenant reads require an
 * explicit relationship governance grant.
 */
export function authorizeTwinAccess(input: {
  actorTenantId: TenantId;
  resourceTenantId: TenantId;
  resourceTwinId: string;
  operation: string;
  crossTenantGranted: boolean;
}): TwinAccessDecision {
  const sameTenant = input.actorTenantId === input.resourceTenantId;
  const allowed = sameTenant || input.crossTenantGranted;
  return {
    actorId: "actor",
    tenantId: input.actorTenantId,
    resourceTwinId: input.resourceTwinId,
    operation: input.operation,
    allowed,
    reason: sameTenant
      ? "Same tenant access (CP)"
      : allowed
        ? "Explicit cross-tenant grant (CQ)"
        : "Cross-tenant access denied without explicit grant (CP)",
  };
}

/* ─────────────────────────────────────────────────────────────
 * Twin trust (EL) and reality score (EN)
 * ────────────────────────────────────────────────────────────*/

export type TwinTrustLevel = "UNVERIFIED" | "LOW" | "MEDIUM" | "HIGH" | "VERIFIED";

export const TWIN_TRUST_LEVELS: readonly TwinTrustLevel[] = [
  "UNVERIFIED",
  "LOW",
  "MEDIUM",
  "HIGH",
  "VERIFIED",
] as const;

export interface TrustAssessment {
  twinId: string;
  level: TwinTrustLevel;
  score: number;
  factors: Record<string, number>;
}

/**
 * Twin trust (EL, EM): confidence in the digital representation. The
 * composite is the weighted mean of source reliability, freshness,
 * consistency, observation coverage, calibration and provenance; the
 * factor breakdown keeps trust explainable.
 */
export function assessTwinTrust(
  twinId: string,
  factors: {
    sourceReliability: number;
    freshness: number;
    consistency: number;
    observationCoverage: number;
    calibration: number;
    provenance: number;
  },
): TrustAssessment {
  const values = [
    factors.sourceReliability,
    factors.freshness,
    factors.consistency,
    factors.observationCoverage,
    factors.calibration,
    factors.provenance,
  ];
  const clamped = values.map((v) => Math.max(0, Math.min(1, v)));
  const score = Number((clamped.reduce((a, b) => a + b, 0) / clamped.length).toFixed(3));
  const level: TwinTrustLevel =
    score >= 0.95
      ? "VERIFIED"
      : score >= 0.8
        ? "HIGH"
        : score >= 0.6
          ? "MEDIUM"
          : score >= 0.35
            ? "LOW"
            : "UNVERIFIED";
  return { twinId, level, score, factors };
}

export interface RealityScoreFactors {
  fidelity: number;
  health: number;
  trust: number;
}

/** Reality score (EN): a composite reality-fidelity indicator that stays
 * decomposable into fidelity, health and trust. */
export function calculateRealityScore(factors: RealityScoreFactors): number {
  const values = [factors.fidelity, factors.health, factors.trust].map((v) =>
    Math.max(0, Math.min(1, v)),
  );
  return Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(3));
}

/* ─────────────────────────────────────────────────────────────
 * Manual override (EO-ER)
 * ────────────────────────────────────────────────────────────*/

export interface ManualOverride {
  overrideId: string;
  twinId: string;
  tenantId: TenantId;
  actor: string;
  reason: string;
  timestamp: string;
  previousValue: unknown;
  newValue: unknown;
  evidence: string | null;
  expiresAt: string | null;
}

export interface CreateOverrideInput {
  twinId: string;
  tenantId: TenantId;
  actor: string;
  reason: string;
  timestamp: string;
  previousValue: unknown;
  newValue: unknown;
  evidence?: string | null;
  expiresAt?: string | null;
}

export type CreateOverrideResult =
  { ok: true; override: ManualOverride } | { ok: false; error: string };

/**
 * Manual override (EP): authorized humans may correct a twin
 * representation. Every override records actor, reason, timestamp,
 * previous value, new value and evidence; temporary overrides carry an
 * explicit expiration (EQ).
 */
export function createManualOverride(input: CreateOverrideInput): CreateOverrideResult {
  if (input.actor.trim() === "") {
    return { ok: false, error: "Override requires an actor (EP)" };
  }
  if (input.reason.trim() === "") {
    return { ok: false, error: "Override requires a reason (EP)" };
  }
  if (
    input.expiresAt !== null &&
    input.expiresAt !== undefined &&
    input.expiresAt <= input.timestamp
  ) {
    return { ok: false, error: "Override expiration must be after the override timestamp (EQ)" };
  }
  return {
    ok: true,
    override: {
      overrideId: `ovr-${input.twinId}-${input.timestamp}-${Math.random().toString(36).slice(2, 8)}`,
      twinId: input.twinId,
      tenantId: input.tenantId,
      actor: input.actor,
      reason: input.reason,
      timestamp: input.timestamp,
      previousValue: input.previousValue,
      newValue: input.newValue,
      evidence: input.evidence ?? null,
      expiresAt: input.expiresAt ?? null,
    },
  };
}

export function isOverrideExpired(override: ManualOverride, now: string): boolean {
  return override.expiresAt !== null && now > override.expiresAt;
}

export type OverrideReconciliation = "preserve" | "replace" | "challenge" | "expire";

/**
 * Reconciliation after override (ER): the platform must determine whether
 * later source data should preserve, replace, challenge or expire the
 * manual override. An unexpired human override with evidence is preserved
 * by default; contradictory authoritative data challenges it.
 */
export function reconcileAfterOverride(
  override: ManualOverride,
  laterSource: { authoritative: boolean; timestamp: string },
  now: string,
): OverrideReconciliation {
  if (isOverrideExpired(override, now)) {
    return "expire";
  }
  if (override.evidence !== null && override.evidence.trim() !== "") {
    return laterSource.authoritative ? "challenge" : "preserve";
  }
  return laterSource.authoritative ? "replace" : "preserve";
}

/* ─────────────────────────────────────────────────────────────
 * Retention, archival, garbage collection (EE, EF, EG, EH)
 * ────────────────────────────────────────────────────────────*/

export interface RetentionPolicy {
  twinKind: string;
  retentionMs: number | null;
  archiveAfterMs: number | null;
  collectEphemeralAfterMs: number | null;
}

/**
 * Retention (EE) varies by twin type/sensitivity/regulatory requirements.
 * Historical preservation (EF) must survive ordinary retirement; garbage
 * collection (EH) applies only to ephemeral/simulation twins.
 */
export function shouldCollectTwin(
  twin: { creationSource: string; lifecycleState: string; createdAt: string },
  policy: RetentionPolicy,
  now: string,
): boolean {
  if (twin.creationSource !== "derived") {
    return false;
  }
  if (policy.collectEphemeralAfterMs === null) {
    return false;
  }
  return Date.parse(now) - Date.parse(twin.createdAt) > policy.collectEphemeralAfterMs;
}

export function canArchiveTwin(twin: { lifecycleState: string }): boolean {
  return (
    twin.lifecycleState === "ACTIVE" ||
    twin.lifecycleState === "DEGRADED" ||
    twin.lifecycleState === "STALE" ||
    twin.lifecycleState === "SUSPENDED"
  );
}

/* ─────────────────────────────────────────────────────────────
 * Import (EC) and export (ED)
 * ────────────────────────────────────────────────────────────*/

export interface ImportRequest {
  dryRun: boolean;
  records: unknown[];
  validate: (record: unknown) => { ok: true } | { ok: false; error: string };
}

export interface ImportResult {
  accepted: number;
  rejected: number;
  rejectedReasons: string[];
}

/**
 * Import (EC): validation, preview, transformation, dry run, rollback,
 * audit. A dry run returns the counts without committing anything.
 */
export function runImport(input: ImportRequest): ImportResult {
  let accepted = 0;
  const rejectedReasons: string[] = [];
  for (const record of input.records) {
    const validation = input.validate(record);
    if (validation.ok) {
      accepted += 1;
    } else {
      rejectedReasons.push(validation.error);
    }
  }
  return { accepted, rejected: input.records.length - accepted, rejectedReasons };
}

export interface ExportRequest {
  redactSensitive: boolean;
  includeProvenance: boolean;
  version: number;
}

export interface ExportResult {
  records: Array<Record<string, unknown>>;
  redactedCount: number;
}

/**
 * Export (ED): authorization, filtering, redaction, provenance,
 * versioning. Sensitive fields are redacted (marked) rather than silently
 * omitted when redactSensitive is true.
 */
export function runExport(
  source: Array<Record<string, unknown>>,
  request: ExportRequest,
  sensitiveKeys: string[],
): ExportResult {
  let redactedCount = 0;
  const records = source.map((record) => {
    const out: Record<string, unknown> = { ...record, exportVersion: request.version };
    if (request.includeProvenance) {
      out.provenance = "export-twin";
    }
    for (const key of sensitiveKeys) {
      if (key in record) {
        out[key] = request.redactSensitive ? "[REDACTED]" : record[key];
        if (request.redactSensitive) {
          redactedCount += 1;
        }
      }
    }
    return out;
  });
  return { records, redactedCount };
}
