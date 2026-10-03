/**
 * CoreGrid — Hermes cycle driver: `runHermesCycle`
 * (MISSION V1-002, team HERMES).
 *
 * ONE governed orchestrator cycle over REAL state, in library form:
 * an event/queue trigger or server function invokes `runHermesCycle`; the
 * cycle then ENDS (WAKE→WORK→SLEEP cost discipline, §32 — there is NO
 * always-on Hermes process).
 *
 *   WAKE        resolve Hermes' governed worker identity. Hermes receives
 *               its OWN pre-recorded definition + delegation grants — it
 *               never mints or widens them (AGENTS §6/§8).
 *   OBSERVE     read system state through the read-only observation ports
 *               (DB-backed at the wiring boundary): missions, workers,
 *               verification records. Every claim is provenance-stamped
 *               (§12); DB-backed claims are canonical, Hermes memory is not
 *               truth (§9).
 *   ASSESS      derive findings deterministically: stuck / failed / denied
 *               missions, unverified evidence, quarantined or suspended
 *               workers. Missions Hermes itself created are EXCLUDED —
 *               Hermes never orchestrates its own repairs (no recursion).
 *   PRIORITIZE  deterministic, explainable ordering: severity rank
 *               (critical, warning, info), then subject ref as a stable
 *               tie-break — every entry carries its ordering rationale.
 *   ACT         per finding, through `classifyHermesAction`:
 *                 ALLOW             → delegate through the LAWFUL path —
 *                                     a repair intent + assignment via the
 *                                     V1-004 `MissionRecordPort`, under
 *                                     Hermes' OWN governed identity resolved
 *                                     through `buildWorkerMissionActor`
 *                                     (neutral RBAC engine; no grants ⇒ no
 *                                     act, Invariant 12);
 *                 REQUIRE_APPROVAL  → typed approval request routed to a
 *                                     human + escalation record; NEVER
 *                                     executed by Hermes (§21);
 *                 DENY              → recorded with the deny code; nothing
 *                                     is touched.
 *               Escalations run through the consumed jarvis escalation
 *               ladder; the human-facing summary is composed with the
 *               consumed jarvis briefing composer.
 *   REPORT      the structured cycle summary: what Hermes observed,
 *               decided, did, and left for humans — with provenance for
 *               every claim.
 *   LEARN/SLEEP decision provenance is recorded through the CANONICAL
 *               memory tier (bounded scope, AI-generated + unverified
 *               stamps) and the cycle ends. Hermes' memory informs the
 *               NEXT cycle's LEARN step; it is never consulted as state
 *               of record (§9).
 *
 * Self-healing bound (§45): Hermes may only retry safe missions and open
 * repair intents. Deploy, delete, production-state mutation, governance
 * mutation and authority grants are encoded deny rules in
 * `hermes-classifier.ts` and can never be executed from this cycle.
 *
 * Boundary: depends ONLY on the V1-004 record port (intents + assignments),
 * the read-only observation port, the canonical memory adapter, the
 * workforce authority resolution (pure) and the consumed jarvis
 * escalation/briefing contracts. No vendor, no direct DB access, no process.
 */

import type { MissionRecordPort } from "../missions/mission-execution-store";
import type { MissionExecutionState } from "../missions/mission-execution";
import type { MissionActorContext } from "../missions/mission-authorization";
import type { WorkerDefinition } from "../workforce/worker-definition";
import {
  buildWorkerMissionActor,
  type WorkerDelegationGrantState,
} from "../workforce/worker-registry";
import { escalateIncident } from "../jarvis/escalation";
import { composeBriefing, type BriefingEvent } from "../jarvis/briefing";
import type { MemoryTierAdapter } from "../memory/memory-adapter";
import {
  HERMES_ACTOR_REF,
  HERMES_CYCLE_PHASES,
  HERMES_REPAIR_MISSION_PREFIX,
  STUCK_CANDIDATE_STAGES,
  hermesClaim,
  hermesCycleConfigSchema,
  hermesCycleInputSchema,
  isCriticalMissionAction,
  type HermesActionClass,
  type HermesApprovalRequest,
  type HermesAssessment,
  type HermesCycleConfig,
  type HermesCycleInput,
  type HermesCycleReport,
  type HermesDecision,
  type HermesDelegationOutcome,
  type HermesFinding,
  type HermesObservationPort,
} from "./hermes-contract";
import { classifyHermesAction } from "./hermes-classifier";
import { declareHermesMemoryScope, writeHermesDecisionMemory } from "./hermes-memory";

/** Hermes' governed identity + its PRE-RECORDED human delegation grants. */
export interface HermesGovernedIdentity {
  /** Hermes' persistent worker definition (the governed identity, §28). */
  readonly definition: WorkerDefinition;
  /** Live delegation grants, pre-recorded by an authorized human granter. */
  readonly grants: readonly WorkerDelegationGrantState[];
}

export interface HermesCycleDeps {
  /** The lawful delegation path: V1-004 record port (intents + assignments). */
  readonly missions: Pick<MissionRecordPort, "recordIntent" | "assignExecution">;
  /** Read-only, DB-backed observation surface. */
  readonly observations: HermesObservationPort;
  /** The CANONICAL memory substrate (lib/memory/) — no second memory. */
  readonly memory: MemoryTierAdapter;
  readonly config?: HermesCycleConfig;
}

export interface HermesCyclePhaseTrace {
  readonly phase: (typeof HERMES_CYCLE_PHASES)[number];
  readonly ok: boolean;
  readonly detail: string;
}

export interface HermesCycleResult {
  readonly report: HermesCycleReport;
  readonly phases: readonly HermesCyclePhaseTrace[];
}

const SEVERITY_RANK: Readonly<Record<HermesFinding["severity"], number>> = {
  critical: 0,
  warning: 1,
  info: 2,
};

function severityFor(kind: HermesFinding["kind"]): HermesFinding["severity"] {
  switch (kind) {
    case "mission_stuck":
      return "warning";
    case "mission_failed":
      return "critical";
    case "mission_denied":
      return "warning";
    case "evidence_unverified":
      return "info";
    case "worker_quarantined":
      return "warning";
    case "worker_suspended":
      return "info";
  }
}

/** Deterministic assessment: finding kind → proposed action class + rationale. */
function assessFinding(finding: HermesFinding, underlyingAction: string | null): HermesAssessment {
  switch (finding.kind) {
    case "mission_stuck":
      return underlyingAction !== null && isCriticalUnderlying(underlyingAction)
        ? {
            finding,
            proposedAction: "execute_critical_action",
            rationale: `mission ${finding.subjectRef} is stuck on critical action "${underlyingAction}" — approval-gated, never self-healed`,
          }
        : {
            finding,
            proposedAction: "retry_safe_mission",
            rationale: `mission ${finding.subjectRef} is stuck in a recoverable stage — safe bounded retry via a repair intent`,
          };
    case "mission_failed":
      return {
        finding,
        proposedAction: "escalate_to_human",
        rationale: `mission ${finding.subjectRef} failed (exhausted or failed verification) — human owners decide remediation`,
      };
    case "mission_denied":
      return {
        finding,
        proposedAction: "escalate_to_human",
        rationale: `mission ${finding.subjectRef} was denied at admission — re-authorization is a human act`,
      };
    case "evidence_unverified":
      return {
        finding,
        proposedAction: "escalate_to_human",
        rationale: `execution ${finding.subjectRef} carries unverified evidence — an independent verifier must act; Hermes cannot verify`,
      };
    case "worker_quarantined":
      return {
        finding,
        proposedAction: "escalate_to_human",
        rationale: `worker ${finding.subjectRef} is quarantined — release requires human review`,
      };
    case "worker_suspended":
      return {
        finding,
        proposedAction: "escalate_to_human",
        rationale: `worker ${finding.subjectRef} is suspended — lifecycle restoration is a human act`,
      };
  }
}

function isCriticalUnderlying(action: string): boolean {
  return isCriticalMissionAction(action);
}

/* ─────────────────────────────────────────────────────────────
 * OBSERVE + ASSESS (pure over port results)
 * ────────────────────────────────────────────────────────────*/

/** Derive findings from observed executions (Hermes' own repairs excluded). */
export function assessExecutions(
  executions: readonly MissionExecutionState[],
  verificationRecords: readonly { executionId: string; decision: string; reason: string }[],
  tenantId: string,
  now: string,
  config: { assignedStaleAfterMs: number },
): HermesFinding[] {
  const findings: HermesFinding[] = [];
  const failedVerifications = new Map(
    verificationRecords
      .filter((record) => record.decision === "failed")
      .map((record) => [record.executionId, record]),
  );

  for (const execution of executions) {
    // Self-exclusion: Hermes never orchestrates its own repair missions.
    if (execution.missionId.startsWith(HERMES_REPAIR_MISSION_PREFIX)) continue;

    const claim = hermesClaim(
      "mission_record_port",
      `cg_execution_record:${execution.executionId}`,
      now,
      `action=${execution.action} stage=${execution.stage} updatedAt=${execution.updatedAt}`,
    );
    const evidenceRefs = execution.evidenceIds.map((id) => `cg_foundation_evidence:${id}`);

    if (STUCK_CANDIDATE_STAGES.includes(execution.stage)) {
      const stuck = isStuck(execution, now, config.assignedStaleAfterMs);
      if (stuck) {
        findings.push({
          findingId: `mission_stuck:${execution.executionId}`,
          kind: "mission_stuck",
          tenantId,
          subjectRef: execution.executionId,
          severity: "warning",
          summary: stuck,
          evidenceRefs:
            evidenceRefs.length > 0
              ? evidenceRefs
              : [`cg_execution_record:${execution.executionId}`],
          observedAt: now,
          claim,
        });
        continue;
      }
    }

    if (execution.stage === "exhausted" || failedVerifications.has(execution.executionId)) {
      const failed = failedVerifications.get(execution.executionId);
      findings.push({
        findingId: `mission_failed:${execution.executionId}`,
        kind: "mission_failed",
        tenantId,
        subjectRef: execution.executionId,
        severity: "critical",
        summary: failed
          ? `execution failed independent verification: ${failed.reason}`
          : "execution exhausted its bounded attempts",
        evidenceRefs:
          evidenceRefs.length > 0 ? evidenceRefs : [`cg_execution_record:${execution.executionId}`],
        observedAt: now,
        claim,
      });
      continue;
    }

    if (execution.stage === "denied") {
      findings.push({
        findingId: `mission_denied:${execution.executionId}`,
        kind: "mission_denied",
        tenantId,
        subjectRef: execution.executionId,
        severity: "warning",
        summary: `execution denied at admission: ${execution.denyReason ?? "unspecified"}`,
        evidenceRefs: [`cg_execution_record:${execution.executionId}`],
        observedAt: now,
        claim,
      });
      continue;
    }

    if (execution.stage === "evidenced") {
      findings.push({
        findingId: `evidence_unverified:${execution.executionId}`,
        kind: "evidence_unverified",
        tenantId,
        subjectRef: execution.executionId,
        severity: "info",
        summary: `execution carries ${execution.evidenceIds.length} unverified evidence record(s) — awaiting independent verification`,
        evidenceRefs:
          evidenceRefs.length > 0 ? evidenceRefs : [`cg_execution_record:${execution.executionId}`],
        observedAt: now,
        claim,
      });
    }
  }
  return findings;
}

function isStuck(
  execution: MissionExecutionState,
  now: string,
  assignedStaleAfterMs: number,
): string | null {
  const nowMs = Date.parse(now);
  if (execution.stage === "leased") {
    if (execution.lease === null)
      return "leased execution holds no lease record (state inconsistency)";
    if (Date.parse(execution.lease.leaseExpiresAt) <= nowMs) {
      return `lease expired at ${execution.lease.leaseExpiresAt} — orphaned work`;
    }
    return null;
  }
  if (execution.stage === "requeued") {
    if (execution.retryScheduledAt !== null && Date.parse(execution.retryScheduledAt) <= nowMs) {
      return `retry was scheduled at ${execution.retryScheduledAt} and has not been picked up`;
    }
    return null;
  }
  // assigned: unupdated beyond the staleness window.
  if (nowMs - Date.parse(execution.updatedAt) > assignedStaleAfterMs) {
    return `assigned but unupdated since ${execution.updatedAt}`;
  }
  return null;
}

/** Derive findings from observed worker postures. */
export function assessWorkers(
  postures: readonly {
    workerId: string;
    tenantId: string;
    lifecycle: string;
    quarantined: boolean;
    failureCount: number;
    observedAt: string;
  }[],
  tenantId: string,
  now: string,
): HermesFinding[] {
  const findings: HermesFinding[] = [];
  for (const posture of postures) {
    if (posture.tenantId !== tenantId) continue; // tenant-scoped assessment only
    const claim = hermesClaim(
      "worker_registry_port",
      `cg_worker_definition:${posture.workerId}`,
      now,
      `lifecycle=${posture.lifecycle} quarantined=${String(posture.quarantined)}`,
    );
    if (posture.quarantined) {
      findings.push({
        findingId: `worker_quarantined:${posture.workerId}`,
        kind: "worker_quarantined",
        tenantId,
        subjectRef: posture.workerId,
        severity: "warning",
        summary: `worker quarantined after ${posture.failureCount} failure(s)`,
        evidenceRefs: [`cg_worker_quarantine:${posture.workerId}`],
        observedAt: now,
        claim,
      });
    } else if (posture.lifecycle === "suspended") {
      findings.push({
        findingId: `worker_suspended:${posture.workerId}`,
        kind: "worker_suspended",
        tenantId,
        subjectRef: posture.workerId,
        severity: "info",
        summary: "worker lifecycle is suspended — no authority resolves",
        evidenceRefs: [`cg_worker_definition:${posture.workerId}`],
        observedAt: now,
        claim,
      });
    }
  }
  return findings;
}

/** Deterministic, explainable prioritization (§16: every order carries why). */
export function prioritizeFindings(findings: readonly HermesFinding[]): HermesAssessment[] {
  return [...findings]
    .sort((a, b) => {
      const rankDelta = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      if (rankDelta !== 0) return rankDelta;
      return a.subjectRef < b.subjectRef ? -1 : a.subjectRef > b.subjectRef ? 1 : 0;
    })
    .map((finding) => assessFinding(finding, underlyingActionOf(finding)));
}

function underlyingActionOf(finding: HermesFinding): string | null {
  const match = /action=(\S+)/.exec(finding.claim.claim);
  return match?.[1] ?? null;
}

/* ─────────────────────────────────────────────────────────────
 * The cycle
 * ────────────────────────────────────────────────────────────*/

export async function runHermesCycle(
  deps: HermesCycleDeps,
  identity: HermesGovernedIdentity,
  input: HermesCycleInput,
): Promise<HermesCycleResult> {
  const parsedInput = hermesCycleInputSchema.safeParse(input);
  if (!parsedInput.success) {
    throw new Error(`hermes cycle input rejected: ${parsedInput.error.message}`);
  }
  const parsedConfig = hermesCycleConfigSchema.safeParse(deps.config ?? {});
  if (!parsedConfig.success) {
    throw new Error(`hermes cycle config rejected: ${parsedConfig.error.message}`);
  }
  const config = parsedConfig.data;
  const { tenantId, now } = parsedInput.data;
  const hermesId = identity.definition.id;
  const cycleId = `hermes:cycle:${tenantId}:${now}`;
  const phases: HermesCyclePhaseTrace[] = [];

  /* ── WAKE ─────────────────────────────────────────────── */
  if (identity.definition.tenantScope !== tenantId) {
    const reason = "hermes definition tenant scope does not match the cycle tenant";
    phases.push({ phase: "WAKE", ok: false, detail: reason });
    return emptyCycle(cycleId, tenantId, now, phases, reason);
  }
  if (identity.definition.classification !== "ai" || hermesId === "") {
    const reason = "hermes must operate as a governed AI worker identity";
    phases.push({ phase: "WAKE", ok: false, detail: reason });
    return emptyCycle(cycleId, tenantId, now, phases, reason);
  }
  phases.push({
    phase: "WAKE",
    ok: true,
    detail: `governed hermes identity ${hermesId} awake with ${identity.grants.length} pre-recorded delegation grant(s)`,
  });

  /* ── OBSERVE (real state through the read-only ports) ── */
  const [executions, workerPostures, verificationRecords] = await Promise.all([
    deps.observations.listExecutions(tenantId),
    deps.observations.listWorkerPostures(tenantId),
    deps.observations.listVerificationRecords(tenantId),
  ]);
  phases.push({
    phase: "OBSERVE",
    ok: true,
    detail: `observed ${executions.length} execution(s), ${workerPostures.length} worker posture(s), ${verificationRecords.length} verification record(s) — DB-backed state of record`,
  });

  /* ── ASSESS (derive findings; deterministic) ─────────── */
  const findings: HermesFinding[] = [
    ...assessExecutions(executions, verificationRecords, tenantId, now, config),
    ...assessWorkers(workerPostures, tenantId, now),
  ];
  phases.push({
    phase: "ASSESS",
    ok: true,
    detail: `${findings.length} finding(s) derived (Hermes-created repair missions excluded)`,
  });

  /* ── PRIORITIZE (deterministic, explainable) ─────────── */
  const ordered = prioritizeFindings(findings);
  const actionable = ordered.slice(0, config.maxFindingsPerCycle);
  const deferred = ordered.slice(config.maxFindingsPerCycle).map((a) => a.finding.findingId);
  phases.push({
    phase: "PRIORITIZE",
    ok: true,
    detail: `${actionable.length} finding(s) prioritized (severity, then subject ref); ${deferred.length} deferred past the cycle bound`,
  });

  /* ── ACT (classify first; delegate / escalate / deny) ── */
  const decisions: HermesDecision[] = [];
  const delegations: HermesDelegationOutcome[] = [];
  const approvalRequests: HermesApprovalRequest[] = [];
  const escalations: { recordId: string; tier: string }[] = [];
  const memoryWrites: { recordId: string; provenance: string }[] = [];

  const memoryScope = await declareHermesMemoryScope(deps.memory, { tenantId, hermesId });
  if (!memoryScope.ok) {
    phases.push({
      phase: "ACT",
      ok: false,
      detail: `memory scope unavailable: ${memoryScope.error}`,
    });
  }

  for (const assessment of actionable) {
    const { finding, proposedAction } = assessment;
    const verdict = classifyHermesAction({
      actionClass: proposedAction,
      underlyingAction: underlyingActionOf(finding) ?? "",
    });

    if (verdict.decision === "DENY") {
      decisions.push({
        decisionId: `${finding.findingId}:decision`,
        findingId: finding.findingId,
        proposedAction,
        verdict,
        acted: false,
        reason: `denied fail-closed: ${verdict.reason}`,
        decidedAt: now,
      });
      continue;
    }

    if (verdict.decision === "REQUIRE_APPROVAL") {
      // Typed REQUIRE_APPROVAL outcome: routed to a human, NEVER executed.
      const escalated = escalateIncident({
        incidentRef: `hermes:approval:${finding.findingId}`,
        tenantRef: tenantId,
        severity: finding.severity,
        summary: `HUMAN APPROVAL REQUIRED — ${finding.summary} (${verdict.reason})`,
        evidenceRefs: finding.evidenceRefs,
        at: now,
      });
      if (escalated.decision === "escalate") {
        approvalRequests.push({
          approvalId: `hermes:approval:${finding.findingId}`,
          findingId: finding.findingId,
          subjectRef: finding.subjectRef,
          proposedAction,
          summary: verdict.reason,
          severity: finding.severity,
          requestedAt: now,
          routedTo: "human_operator",
        });
        escalations.push({
          recordId: escalated.record.incidentRef,
          tier: escalated.record.tier,
        });
        decisions.push({
          decisionId: `${finding.findingId}:decision`,
          findingId: finding.findingId,
          proposedAction,
          verdict,
          acted: true,
          reason: `routed to ${verdict.routedTo} — Hermes did not execute`,
          decidedAt: now,
        });
      } else {
        decisions.push({
          decisionId: `${finding.findingId}:decision`,
          findingId: finding.findingId,
          proposedAction,
          verdict,
          acted: false,
          reason: `approval routing failed closed: ${escalated.reason}`,
          decidedAt: now,
        });
      }
      continue;
    }

    // ALLOW — act per the class.
    if (proposedAction === "retry_safe_mission" || proposedAction === "open_repair_intent") {
      const outcome = await delegateRepair(deps, identity, finding, proposedAction, now);
      delegations.push(outcome);
      decisions.push({
        decisionId: `${finding.findingId}:decision`,
        findingId: finding.findingId,
        proposedAction,
        verdict,
        acted: outcome.assignmentRecorded,
        reason:
          outcome.denialReason ??
          (outcome.replayed
            ? "repair already on record — idempotent replay, no new external effect"
            : `repair delegated via ${outcome.authorityRef}`),
        decidedAt: now,
      });
      continue;
    }

    if (proposedAction === "escalate_to_human") {
      const escalated = escalateIncident({
        incidentRef: `hermes:escalation:${finding.findingId}`,
        tenantRef: tenantId,
        severity: finding.severity,
        summary: finding.summary,
        evidenceRefs: finding.evidenceRefs,
        at: now,
      });
      if (escalated.decision === "escalate") {
        escalations.push({ recordId: escalated.record.incidentRef, tier: escalated.record.tier });
        decisions.push({
          decisionId: `${finding.findingId}:decision`,
          findingId: finding.findingId,
          proposedAction,
          verdict,
          acted: true,
          reason: `escalated at tier ${escalated.record.tier} for human disposition`,
          decidedAt: now,
        });
      } else {
        decisions.push({
          decisionId: `${finding.findingId}:decision`,
          findingId: finding.findingId,
          proposedAction,
          verdict,
          acted: false,
          reason: `escalation failed closed: ${escalated.reason}`,
          decidedAt: now,
        });
      }
      continue;
    }

    // record_cycle_memory and any other allowed class: decision provenance
    // only — no external effect.
    decisions.push({
      decisionId: `${finding.findingId}:decision`,
      findingId: finding.findingId,
      proposedAction,
      verdict,
      acted: false,
      reason: verdict.reason,
      decidedAt: now,
    });
  }

  phases.push({
    phase: "ACT",
    ok: true,
    detail: `${decisions.filter((d) => d.acted).length} act(s), ${delegations.length} delegation(s), ${approvalRequests.length} approval request(s), ${escalations.length} escalation(s)`,
  });

  /* ── LEARN (memory through the canonical substrate) ──── */
  for (const decision of decisions) {
    if (!memoryScope.ok) break;
    const finding = findings.find((f) => f.findingId === decision.findingId);
    if (finding === undefined) continue;
    const written = await writeHermesDecisionMemory(deps.memory, {
      tenantId,
      hermesId,
      finding,
      proposedAction: decision.proposedAction,
      cycleId,
      now,
    });
    if (written.ok && written.written) {
      memoryWrites.push({ recordId: written.recordId, provenance: written.provenance });
    }
  }

  /* ── REPORT ──────────────────────────────────────────── */
  const briefingEvents: BriefingEvent[] = escalations.map((escalation) => {
    const finding = findings.find(
      (f) =>
        `hermes:escalation:${f.findingId}` === escalation.recordId ||
        `hermes:approval:${f.findingId}` === escalation.recordId,
    );
    return {
      kind: "hermes-escalation",
      tenantRef: tenantId,
      at: now,
      severity: finding?.severity ?? "info",
      summary: escalation.recordId,
    };
  });
  const briefing = briefingEvents.length > 0 ? composeBriefing(briefingEvents) : null;

  const report: HermesCycleReport = {
    cycleId,
    tenantId,
    actorRef: HERMES_ACTOR_REF,
    startedAt: now,
    finishedAt: now,
    observed: {
      executions: executions.length,
      workers: workerPostures.length,
      verificationRecords: verificationRecords.length,
    },
    findings,
    prioritized: actionable,
    decisions,
    delegations,
    approvalRequests,
    escalations,
    memoryWrites,
    deferred,
    sleep: {
      state: "sleeping",
      reason: "cycle complete — Hermes sleeps (library-form, no resident process)",
    },
  };
  phases.push({
    phase: "REPORT",
    ok: true,
    detail: `cycle summary assembled: ${findings.length} finding(s), ${decisions.length} decision(s), ${memoryWrites.length} memory record(s) with §12 provenance`,
  });

  /* ── SLEEP ───────────────────────────────────────────── */
  phases.push({ phase: "SLEEP", ok: true, detail: report.sleep.reason });

  return { report, phases };
}

/* ─────────────────────────────────────────────────────────────
 * Delegation (the ONLY lawful act on a mission): intent + assignment
 * through the V1-004 record port under Hermes' OWN RBAC-resolved identity.
 * ────────────────────────────────────────────────────────────*/

async function delegateRepair(
  deps: HermesCycleDeps,
  identity: HermesGovernedIdentity,
  finding: HermesFinding,
  proposedAction: HermesActionClass,
  now: string,
): Promise<HermesDelegationOutcome> {
  const repairMissionId = `${HERMES_REPAIR_MISSION_PREFIX}${finding.subjectRef}`;
  const repairExecutionId = `${repairMissionId}-exec-1`;
  const underlyingAction = underlyingActionOf(finding) ?? finding.kind;
  const idempotencyKey = `hermes:${finding.findingId}:v1`;

  // Authority resolution through the NEUTRAL RBAC engine: Hermes' actor is
  // built ONLY from its pre-recorded definition + delegation grants. No
  // grants ⇒ an actor with zero effective permissions ⇒ the engine denies.
  const authority = buildWorkerMissionActor({
    definition: identity.definition,
    grants: identity.grants,
    tenantId: finding.tenantId,
    missionId: repairMissionId,
  });
  if (!authority.ok) {
    return {
      findingId: finding.findingId,
      repairMissionId,
      repairExecutionId,
      intentRecorded: false,
      assignmentRecorded: false,
      replayed: false,
      denialReason: `delegation_denied:${authority.reason}`,
      authorityRef: null,
    };
  }
  const actor: MissionActorContext = authority.actor;
  const delegationGrantRef = `delegation:${identity.grants.find((g) => g.state === "active")?.grantId ?? "none"}`;

  const intent = await deps.missions.recordIntent({
    actor,
    intent: {
      tenantId: finding.tenantId,
      missionId: repairMissionId,
      version: "1.0",
      purpose: `hermes-${proposedAction}:${finding.kind}`.slice(0, 200),
      authorityRef: delegationGrantRef,
      contextRef: finding.findingId,
      ownerRef: `hermes:${identity.definition.id}`,
      nonScope: ["deploy", "delete_data", "modify_governance", "production_state_mutation"],
      authorizedActions: [underlyingAction],
      expiresAt: null,
    },
    now,
  });
  if (!intent.ok) {
    return {
      findingId: finding.findingId,
      repairMissionId,
      repairExecutionId,
      intentRecorded: false,
      assignmentRecorded: false,
      replayed: false,
      denialReason: `intent_denied:${intent.code}:${intent.reason}`,
      authorityRef: delegationGrantRef,
    };
  }

  const assignment = await deps.missions.assignExecution({
    actor,
    assignment: {
      tenantId: finding.tenantId,
      missionId: repairMissionId,
      version: "1.0",
      executionId: repairExecutionId,
      idempotencyKey,
      action: underlyingAction,
      realityRef: `hermes:finding:${finding.findingId}`,
      now,
    },
  });
  if (!assignment.ok) {
    return {
      findingId: finding.findingId,
      repairMissionId,
      repairExecutionId,
      intentRecorded: true,
      assignmentRecorded: false,
      replayed: false,
      denialReason: `assignment_denied:${assignment.code}:${assignment.reason}`,
      authorityRef: delegationGrantRef,
    };
  }

  return {
    findingId: finding.findingId,
    repairMissionId,
    repairExecutionId,
    intentRecorded: true,
    assignmentRecorded: true,
    replayed: intent.value.replayed || assignment.value.replayed,
    denialReason: null,
    authorityRef: delegationGrantRef,
  };
}

function emptyCycle(
  cycleId: string,
  tenantId: string,
  now: string,
  phases: HermesCyclePhaseTrace[],
  reason: string,
): HermesCycleResult {
  return {
    report: {
      cycleId,
      tenantId,
      actorRef: HERMES_ACTOR_REF,
      startedAt: now,
      finishedAt: now,
      observed: { executions: 0, workers: 0, verificationRecords: 0 },
      findings: [],
      prioritized: [],
      decisions: [],
      delegations: [],
      approvalRequests: [],
      escalations: [],
      memoryWrites: [],
      deferred: [],
      sleep: { state: "sleeping", reason },
    },
    phases,
  };
}
