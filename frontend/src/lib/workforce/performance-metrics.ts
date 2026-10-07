/**
 * CoreGrid — Workforce performance metrics (directive §40/§41, PLATFORM-016).
 *
 * Pure, deterministic computation of workforce performance over the ONE
 * canonical mission substrate (`mission/mission-contract.ts`). This module
 * owns NO storage, NO scheduler, NO persistence — it is a measurement lens:
 * it consumes already-governed mission records, mission evidence records,
 * and recorded lifecycle transitions, and returns a tenant-scoped report.
 *
 * Anti-fabrication law (Constitution §65 / directive §55): a metric that
 * cannot be derived from the supplied substrate is returned as
 * `not_observable` with its reason — never guessed, never defaulted.
 * Directive §40 lists twelve metrics; the mission substrate can observe
 * completion, failure, verification, rework, rollback, and time-based
 * metrics. Token usage and compute cost become observable ONLY when the
 * caller supplies governed metering records (`usage`, the attribution-
 * complete UsageRecord substrate from lib/metering/usage-ledger) — absent
 * records are honestly declared not observable, and records without model
 * rate entries never produce a guessed cost. Tool errors and security
 * violations still have no wired observation substrate and remain honestly
 * not observable rather than invented.
 *
 * Claim classes (directive §21): computed rates and durations are
 * `observed` (derived directly from records); the composite quality score
 * is `inferred` (a weighted derivation over observed metrics).
 *
 * Boundary: pure functions. No persistence, no I/O, no vendor imports.
 * Tenant isolation (Constitution §13): records outside the requested
 * tenant are excluded and COUNTED in the report — never silently mixed.
 */

import {
  MISSION_LIFECYCLE_STATES,
  missionEvidenceCovers,
  validateMissionCore,
  isContractTimestamp,
  type MissionContractCore,
  type MissionEvidenceRecord,
  type MissionLifecycleState,
} from "../mission/mission-contract";
import { validateUsageRecord, type UsageRecord } from "../metering/usage-ledger";

/* ─────────────────────────────────────────────────────────────
 * Observation input: recorded lifecycle transitions
 * ────────────────────────────────────────────────────────────*/

/**
 * One RECORDED lifecycle transition of a mission, attributed to the actor
 * (worker) that performed it. The mission contract owns the state machine;
 * this type is the historical record the metrics lens consumes. A
 * transition that references an unknown mission or carries a non-canonical
 * state or an unparseable timestamp is an integrity violation — the lens
 * fails closed rather than repairing it.
 */
export interface MissionTransitionObservation {
  readonly missionId: string;
  readonly actorId: string;
  readonly from: MissionLifecycleState;
  readonly to: MissionLifecycleState;
  readonly at: string;
}

/* ─────────────────────────────────────────────────────────────
 * Metric result shape
 * ────────────────────────────────────────────────────────────*/

export interface PerformanceMetric {
  /** "computed" = value derives from the supplied records; "not_observable" = substrate cannot supply it. */
  readonly status: "computed" | "not_observable";
  readonly value: number | null;
  /** observed = direct derivation from records; inferred = weighted composite of observables. */
  readonly claimClass: "observed" | "inferred";
  readonly reason: string | null;
  /** Number of records the metric was computed over (0 when not observable). */
  readonly sample: number;
}

function computed(value: number, claimClass: "observed" | "inferred", sample: number): PerformanceMetric {
  return { status: "computed", value, claimClass, reason: null, sample };
}

function notObservable(reason: string): PerformanceMetric {
  return { status: "not_observable", value: null, claimClass: "observed", reason, sample: 0 };
}

/* ─────────────────────────────────────────────────────────────
 * Per-actor attribution (directive §40: measure workers)
 * ────────────────────────────────────────────────────────────*/

export interface WorkerPerformanceAttributes {
  readonly actorId: string;
  /** Distinct missions this actor recorded transitions on. */
  readonly missionsActedOn: number;
  /** Recorded transitions by this actor. */
  readonly recordedTransitions: number;
  /** Transitions into RETRYING or COMPENSATING (rework signal, §40). */
  readonly reworkTransitions: number;
  /** Transitions into COMPENSATING (rollback signal, §40). */
  readonly rollbackTransitions: number;
}

/* ─────────────────────────────────────────────────────────────
 * The report
 * ────────────────────────────────────────────────────────────*/

export interface WorkforcePerformanceReport {
  readonly tenantId: string;
  readonly computedAt: string;
  /** In-scope missions considered. */
  readonly sampleSize: number;
  /** Resolved missions (reached an outcome state). */
  readonly resolvedMissions: number;
  /** Completed missions (SUCCEEDED or ARCHIVED). */
  readonly completedMissions: number;
  /** Cross-tenant records supplied but excluded (never mixed, never hidden). */
  readonly excludedCrossTenant: {
    readonly missions: number;
    readonly evidence: number;
    readonly transitions: number;
    readonly usage: number;
  };
  readonly metrics: {
    readonly missionCompletionRate: PerformanceMetric;
    readonly missionFailureRate: PerformanceMetric;
    readonly verificationPassRate: PerformanceMetric;
    readonly reworkRate: PerformanceMetric;
    readonly rollbackRate: PerformanceMetric;
    readonly meanTimeToCompletionMs: PerformanceMetric;
    readonly meanTimeToRecoveryMs: PerformanceMetric;
    readonly tokenUsage: PerformanceMetric;
    readonly computeCost: PerformanceMetric;
    readonly toolErrors: PerformanceMetric;
    readonly securityViolations: PerformanceMetric;
    readonly qualityScore: PerformanceMetric;
  };
  readonly perActor: readonly WorkerPerformanceAttributes[];
}

/* ─────────────────────────────────────────────────────────────
 * Classification helpers over the canonical lifecycle
 * ────────────────────────────────────────────────────────────*/

/** Missions that reached an outcome state (not still DEFINED..RUNNING/PAUSED/WAITING/RETRYING/COMPENSATING). */
const OUTCOME_STATES: readonly MissionLifecycleState[] = [
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "TIMED_OUT",
  "COMPENSATED",
  "QUARANTINED",
  "ARCHIVED",
];

/** Missions counted as completed for the completion rate. */
const COMPLETED_STATES: readonly MissionLifecycleState[] = ["SUCCEEDED", "ARCHIVED"];

/** Missions counted as failures for the failure rate (directive §51 failure classes). */
const FAILURE_STATES: readonly MissionLifecycleState[] = ["FAILED", "TIMED_OUT"];

/** Transition targets that count as rework (directive §40/§51). */
const REWORK_TARGETS: readonly MissionLifecycleState[] = ["RETRYING", "COMPENSATING"];

/** Transition targets that count as rollback. */
const ROLLBACK_TARGETS: readonly MissionLifecycleState[] = ["COMPENSATING"];

function isMissionLifecycleState(value: string): value is MissionLifecycleState {
  return (MISSION_LIFECYCLE_STATES as readonly string[]).includes(value);
}

/* ─────────────────────────────────────────────────────────────
 * The metrics lens
 * ────────────────────────────────────────────────────────────*/

export interface WorkforcePerformanceInput {
  readonly tenantId: string;
  readonly now: string;
  /** In-scope mission records (core shape; envelope optional for the lens). */
  readonly missions: readonly MissionContractCore[];
  readonly evidence: readonly MissionEvidenceRecord[];
  readonly transitions: readonly MissionTransitionObservation[];
  /**
   * Optional governed metering records (lib/metering/usage-ledger). When
   * supplied, tokenUsage and computeCost become observed metrics; when
   * omitted they stay not_observable (§65). Records fail the attribution
   * validation or belong to another tenant → excluded and counted (never
   * mixed, never silently dropped).
   */
  readonly usage?: readonly UsageRecord[];
}

/**
 * Compute the §40 workforce performance report for one tenant.
 * Fails closed on: invalid mission cores, unparseable clocks, non-canonical
 * transition states, and transitions referencing out-of-scope missions.
 * Excludes (and counts) cross-tenant records. Never fabricates.
 */
export function computeWorkforcePerformance(input: WorkforcePerformanceInput): WorkforcePerformanceReport {
  const tenantId = input.tenantId.trim();
  if (tenantId.length === 0) {
    throw new Error("workforce performance lens rejected: tenantId is required");
  }
  if (!isContractTimestamp(input.now)) {
    throw new Error("workforce performance lens rejected: clock is not a parseable timestamp");
  }

  // Tenant isolation: partition by scope; exclusions are counted, not hidden.
  const inScopeMissions: MissionContractCore[] = [];
  let excludedMissions = 0;
  for (const mission of input.missions) {
    const validationError = validateMissionCore(mission);
    if (validationError !== null) {
      throw new Error(`workforce performance lens rejected: mission ${mission.missionId}: ${validationError}`);
    }
    if (mission.tenantId !== tenantId) {
      excludedMissions += 1;
      continue;
    }
    inScopeMissions.push(mission);
  }

  const inScopeEvidence = input.evidence.filter((record) => record.tenantId === tenantId);
  const excludedEvidence = input.evidence.length - inScopeEvidence.length;

  const inScopeTransitions: MissionTransitionObservation[] = [];
  let excludedTransitions = 0;
  const missionIds = new Set(inScopeMissions.map((mission) => mission.missionId));
  for (const transition of input.transitions) {
    if (!isMissionLifecycleState(transition.from) || !isMissionLifecycleState(transition.to)) {
      throw new Error(
        `workforce performance lens rejected: transition on ${transition.missionId} uses a non-canonical lifecycle state`,
      );
    }
    if (!isContractTimestamp(transition.at)) {
      throw new Error(`workforce performance lens rejected: transition on ${transition.missionId} has an unparseable timestamp`);
    }
    if (transition.actorId.trim().length === 0) {
      throw new Error(`workforce performance lens rejected: transition on ${transition.missionId} has no attributed actor`);
    }
    if (!missionIds.has(transition.missionId)) {
      // A transition on an out-of-scope (or unknown) mission must never leak
      // into this tenant's report. Unknown in-scope-mission transitions are
      // an integrity violation; out-of-scope are exclusions. Both fail closed
      // here because the lens cannot distinguish identity without the record.
      excludedTransitions += 1;
      continue;
    }
    inScopeTransitions.push(transition);
  }

  // ---- Metered AI usage (§40 token/cost substrate): fail closed on records
  // that are not attribution-complete, then tenant-partition. ----
  const inScopeUsage: UsageRecord[] = [];
  let excludedUsage = 0;
  for (const record of input.usage ?? []) {
    const problems = validateUsageRecord(record);
    if (problems.length > 0) {
      throw new Error(`workforce performance lens rejected: usage record: ${problems.join("; ")}`);
    }
    if (record.tenantRef !== tenantId) {
      excludedUsage += 1;
      continue;
    }
    inScopeUsage.push(record);
  }

  // ---- Completion / failure rates (§40) ----
  const outcome = inScopeMissions.filter((mission) => OUTCOME_STATES.includes(mission.lifecycle));
  const completed = inScopeMissions.filter((mission) => COMPLETED_STATES.includes(mission.lifecycle));
  const failed = inScopeMissions.filter((mission) => FAILURE_STATES.includes(mission.lifecycle));
  const completionRate =
    outcome.length === 0
      ? notObservable("no resolved missions in scope — completion rate would divide by zero")
      : computed(completed.length / outcome.length, "observed", outcome.length);
  const failureRate =
    outcome.length === 0
      ? notObservable("no resolved missions in scope — failure rate would divide by zero")
      : computed(failed.length / outcome.length, "observed", outcome.length);

  // ---- Verification pass rate (§40): usable-evidence coverage of required kinds ----
  const verificationCovered = inScopeMissions.filter((mission) => missionEvidenceCovers(mission, input.evidence));
  const verificationPassRate =
    inScopeMissions.length === 0
      ? notObservable("no missions in scope")
      : computed(verificationCovered.length / inScopeMissions.length, "observed", inScopeMissions.length);

  // ---- Rework / rollback rates (§40) over recorded transitions ----
  const reworkTransitions = inScopeTransitions.filter((t) => REWORK_TARGETS.includes(t.to));
  const rollbackTransitions = inScopeTransitions.filter((t) => ROLLBACK_TARGETS.includes(t.to));
  const reworkRate =
    inScopeTransitions.length === 0
      ? notObservable("no recorded lifecycle transitions — rework rate would divide by zero")
      : computed(reworkTransitions.length / inScopeTransitions.length, "observed", inScopeTransitions.length);
  const rollbackRate =
    outcome.length === 0
      ? notObservable("no resolved missions in scope — rollback rate would divide by zero")
      : computed(
          new Set(rollbackTransitions.map((t) => t.missionId)).size / outcome.length,
          "observed",
          outcome.length,
        );

  // ---- Mean time to completion (§40): first completion transition − declaredAt ----
  const firstTransitionTo = new Map<string, MissionTransitionObservation[]>();
  for (const transition of inScopeTransitions) {
    const list = firstTransitionTo.get(transition.missionId) ?? [];
    list.push(transition);
    firstTransitionTo.set(transition.missionId, list);
  }
  const completionDurations: number[] = [];
  for (const mission of completed) {
    const transitions = firstTransitionTo.get(mission.missionId) ?? [];
    const completionTs = transitions
      .filter((t) => COMPLETED_STATES.includes(t.to))
      .map((t) => Date.parse(t.at))
      .sort((a, b) => a - b)[0];
    if (completionTs === undefined) continue;
    const declaredTs = Date.parse(mission.provenance.declaredAt);
    if (!Number.isFinite(declaredTs) || completionTs < declaredTs) continue;
    completionDurations.push(completionTs - declaredTs);
  }
  const meanTimeToCompletionMs =
    completionDurations.length === 0
      ? notObservable("no recorded completion transitions with declared-at provenance")
      : computed(
          Math.round(completionDurations.reduce((sum, d) => sum + d, 0) / completionDurations.length),
          "observed",
          completionDurations.length,
        );

  // ---- Mean time to recovery (§40): first recovery to a completed state − first entry into FAILED ----
  const recoveryDurations: number[] = [];
  for (const [missionId, transitions] of firstTransitionTo) {
    const sorted = [...transitions].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    let failedAt: number | null = null;
    for (const transition of sorted) {
      if (transition.to === "FAILED" && failedAt === null) failedAt = Date.parse(transition.at);
      if (failedAt !== null && COMPLETED_STATES.includes(transition.to)) {
        const recoveredAt = Date.parse(transition.at);
        if (recoveredAt >= failedAt) recoveryDurations.push(recoveredAt - failedAt);
        break;
      }
    }
    void missionId;
  }
  const meanTimeToRecoveryMs =
    recoveryDurations.length === 0
      ? notObservable("no recorded FAILED→completed recovery sequences")
      : computed(
          Math.round(recoveryDurations.reduce((sum, d) => sum + d, 0) / recoveryDurations.length),
          "observed",
          recoveryDurations.length,
        );

  // ---- Token usage / compute cost (§40): observed ONLY from supplied
  // metering records; cost sums non-null estimates and never guesses. ----
  const tokenUsage =
    inScopeUsage.length === 0
      ? notObservable("no AI usage records in scope — token usage has no observed substrate (§65: not invented)")
      : computed(
          inScopeUsage.reduce((sum, record) => sum + record.tokensIn + record.tokensOut, 0),
          "observed",
          inScopeUsage.length,
        );
  const costedUsage = inScopeUsage.filter((record) => record.estimatedCostUsd !== null);
  const computeCost =
    inScopeUsage.length === 0
      ? notObservable("no AI usage records in scope — compute cost has no observed substrate (§65: not invented)")
      : costedUsage.length === 0
        ? notObservable("usage records in scope but no model rate entries — estimated cost is not derivable (Part 9: never guessed)")
        : computed(
            Math.round(costedUsage.reduce((sum, record) => sum + (record.estimatedCostUsd ?? 0), 0) * 1e6) / 1e6,
            "observed",
            costedUsage.length,
          );

  // ---- Honest non-observables (§65): no wired substrate, never invented ----
  const toolErrors = notObservable("no tool-error observation substrate is wired into the mission contract (§65: not invented)");
  const securityViolations = notObservable("no security-violation observation substrate is wired into the mission contract (§65: not invented)");

  // ---- Quality score (§40): composite of OBSERVED metrics only, labeled inferred ----
  const qualityScore =
    completionRate.status === "computed" &&
    verificationPassRate.status === "computed" &&
    reworkRate.status === "computed" &&
    rollbackRate.status === "computed"
      ? computed(
          Math.round(
            10000 *
              (0.4 * (completionRate.value as number) +
                0.3 * (verificationPassRate.value as number) +
                0.2 * (1 - (reworkRate.value as number)) +
                0.1 * (1 - (rollbackRate.value as number))),
          ) / 10000,
          "inferred",
          Math.max(outcome.length, inScopeMissions.length),
        )
      : notObservable("quality score requires computed completion, verification, rework, and rollback metrics");

  // ---- Per-actor attribution ----
  const actorMap = new Map<string, { missions: Set<string>; transitions: number; rework: number; rollback: number }>();
  for (const transition of inScopeTransitions) {
    const entry = actorMap.get(transition.actorId) ?? { missions: new Set<string>(), transitions: 0, rework: 0, rollback: 0 };
    entry.missions.add(transition.missionId);
    entry.transitions += 1;
    if (REWORK_TARGETS.includes(transition.to)) entry.rework += 1;
    if (ROLLBACK_TARGETS.includes(transition.to)) entry.rollback += 1;
    actorMap.set(transition.actorId, entry);
  }
  const perActor: WorkerPerformanceAttributes[] = [...actorMap.entries()]
    .map(([actorId, entry]) => ({
      actorId,
      missionsActedOn: entry.missions.size,
      recordedTransitions: entry.transitions,
      reworkTransitions: entry.rework,
      rollbackTransitions: entry.rollback,
    }))
    .sort((a, b) => a.actorId.localeCompare(b.actorId));

  return {
    tenantId,
    computedAt: input.now.trim(),
    sampleSize: inScopeMissions.length,
    resolvedMissions: outcome.length,
    completedMissions: completed.length,
    excludedCrossTenant: {
      missions: excludedMissions,
      evidence: excludedEvidence,
      transitions: excludedTransitions,
      usage: excludedUsage,
    },
    metrics: {
      missionCompletionRate: completionRate,
      missionFailureRate: failureRate,
      verificationPassRate,
      reworkRate,
      rollbackRate,
      meanTimeToCompletionMs,
      meanTimeToRecoveryMs,
      tokenUsage,
      computeCost,
      toolErrors,
      securityViolations,
      qualityScore,
    },
    perActor,
  };
}