/**
 * CoreGrid — Hermes FINDINGS list (pure, over already-recorded state)
 * (MISSION V1-002 follow-up, team HERMES / OBSERVABILITY).
 *
 * Derives Hermes findings from REAL tenant-scoped state of record by calling
 * the existing PURE assess functions (`assessExecutions`, `assessWorkers`).
 * This module never invents findings, never runs the Hermes cycle (no repair
 * ACT), never starts a resident process, and never un-freezes Phase 52.
 *
 * Honesty law — lease-substrate gap (MISSION V1-004):
 *   `cg_execution_record.status` admits only admitted | denied | rolled_back.
 *   The DB projection maps admitted → assigned with lease === null (there is
 *   no worker-lease substrate). `assessExecutions` would treat an assigned
 *   row unupdated past 60s as `mission_stuck`, which the observation
 *   translator stamps as DETECTABLE `mission_timeout`. That timeout would be
 *   INVENTED from a schema gap, not from an orphaned lease. This module
 *   DROPS `mission_stuck` findings whose matching execution has
 *   `lease === null` AND `stage === "assigned"`. Denied / failed-verification
 *   / quarantined / suspended findings stay.
 *
 * Boundary: pure functions over caller-supplied state. No I/O, no vendor,
 * no `.server` imports, no wall-clock sampling (time is always supplied).
 *
 * Version-target classification: ACTIVE-V1 (AGENTS.md §45).
 */

import type { MissionExecutionState } from "../missions/mission-execution";
import { assessExecutions, assessWorkers } from "./hermes-cycle";
import type { HermesFinding, HermesWorkerPosture } from "./hermes-contract";
import type { HermesFindingObservationSource } from "./hermes-finding-observation";

/** Same default the Hermes cycle uses for assigned-stage staleness. */
const ASSIGNED_STALE_AFTER_MS = 60_000;

function isBlankTenant(tenantId: string): boolean {
  return typeof tenantId !== "string" || tenantId.trim().length === 0;
}

function isParseableNow(now: string): boolean {
  return typeof now === "string" && Number.isFinite(Date.parse(now));
}

function isLeaseGapAssignedStuck(
  finding: HermesFinding,
  executionsById: ReadonlyMap<string, MissionExecutionState>,
): boolean {
  if (finding.kind !== "mission_stuck") return false;
  const execution = executionsById.get(finding.subjectRef);
  if (execution === undefined) return false;
  return execution.lease === null && execution.stage === "assigned";
}

function toObservationSource(finding: HermesFinding): HermesFindingObservationSource {
  return {
    findingId: finding.findingId,
    kind: finding.kind,
    tenantId: finding.tenantId,
    subjectRef: finding.subjectRef,
    severity: finding.severity,
    summary: finding.summary,
    evidenceRefs: finding.evidenceRefs,
    observedAt: finding.observedAt,
    claim: {
      source: finding.claim.source,
      sourceRef: finding.claim.sourceRef,
      observedAt: finding.claim.observedAt,
      verified: finding.claim.verified,
      confidence: finding.claim.confidence,
      claim: finding.claim.claim,
    },
  };
}

/**
 * Derive honest Hermes findings from already-recorded tenant-scoped state.
 * Blank tenantId or an unparseable `now` yields []. Cross-tenant executions
 * are dropped before assess (`assessWorkers` already skips other tenants).
 */
export function listHermesFindingsFromState(input: {
  readonly tenantId: string;
  readonly now: string;
  readonly executions: readonly MissionExecutionState[];
  readonly workerPostures: readonly HermesWorkerPosture[];
  readonly verificationRecords: readonly { executionId: string; decision: string; reason: string }[];
}): readonly HermesFindingObservationSource[] {
  if (input === null || typeof input !== "object") return [];
  if (isBlankTenant(input.tenantId) || !isParseableNow(input.now)) return [];

  const tenantId = input.tenantId.trim();
  const now = input.now;
  const executions = (Array.isArray(input.executions) ? input.executions : []).filter(
    (execution) => execution !== null && typeof execution === "object" && execution.tenantId === tenantId,
  );
  const workerPostures = Array.isArray(input.workerPostures) ? input.workerPostures : [];
  const verificationRecords = Array.isArray(input.verificationRecords)
    ? input.verificationRecords
    : [];

  const executionFindings = assessExecutions(executions, verificationRecords, tenantId, now, {
    assignedStaleAfterMs: ASSIGNED_STALE_AFTER_MS,
  });
  const workerFindings = assessWorkers(workerPostures, tenantId, now);

  const executionsById = new Map(executions.map((execution) => [execution.executionId, execution]));
  const droppedStuckIds = new Set(
    executionFindings
      .filter((finding) => isLeaseGapAssignedStuck(finding, executionsById))
      .map((finding) => finding.subjectRef),
  );
  const honestExecutionFindings = executionFindings.filter(
    (finding) => !isLeaseGapAssignedStuck(finding, executionsById),
  );

  // assessExecutions `continue`s after mission_stuck, so a stale assigned
  // row with a failed verification would otherwise lose mission_failed when
  // the invented timeout is dropped. Re-assess those rows with the stale
  // window disabled so canonical verification failure still surfaces.
  const recovered =
    droppedStuckIds.size === 0
      ? []
      : assessExecutions(
          executions.filter((execution) => droppedStuckIds.has(execution.executionId)),
          verificationRecords,
          tenantId,
          now,
          { assignedStaleAfterMs: Number.MAX_SAFE_INTEGER },
        ).filter((finding) => finding.kind !== "mission_stuck");

  return [...honestExecutionFindings, ...recovered, ...workerFindings].map(toObservationSource);
}
