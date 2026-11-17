/**
 * Sherivs — Conductor executive orchestrator, pure contract
 * (MISSION V1-002, team CONDUCTOR).
 *
 * Conductor is the GOVERNED coordinator of the V1 mission substrate — the
 * executive orchestrator the V5.3 Part 15 "Jarvis" boundary described, now
 * operating over REAL state (AGENTS §11: a coordinator, never a god-object):
 *
 *   missions      — `MissionExecutionState` rows read through observation
 *                   ports wired to the V1-004 record ports (DB-backed);
 *   workers       — governed worker postures from the V1-003 workforce
 *                   registry (lifecycle + quarantine ledger);
 *   evidence      — §12 evidence refs carried by executions
 *                   (`cg_foundation_evidence` at the DB boundary);
 *   verification  — recorded independent verification decisions.
 *
 * §9 CANONICAL TRUTH: every claim Conductor makes about system state is READ
 * from those DB-backed ports — Conductor memory is never truth. Claims carry
 * `verified`/`confidence` so a consumer can always distinguish verified
 * state from derived intelligence; uncertain claims are MARKED, never
 * silently promoted (§12 provenance on every claim).
 *
 * Authority model (Invariant 12 + AGENTS §5/§8): Conductor is an untrusted AI
 * worker identity. It holds NO authority of its own — every delegation act
 * resolves through the neutral RBAC engine via the workforce registry's
 * `buildWorkerMissionActor` over PRE-RECORDED human delegation grants.
 * Conductor cannot self-grant, cannot bypass verification, and cannot execute
 * critical actions: the action classifier (`conductor-classifier.ts`) fails
 * closed and critical/high-risk decisions produce a typed
 * REQUIRE_APPROVAL outcome routed to a human.
 *
 * Loop (event/queue-triggered, WAKE→WORK→SLEEP cost discipline — there is
 * NO always-on Conductor process):
 *
 *   OBSERVE → ASSESS → PRIORITIZE → ACT → REPORT (+ LEARN via memory)
 *
 * `lib/jarvis/` classification (§52): `escalation.ts` and `briefing.ts` are
 * CONSUMED as-is (imported by `conductor-cycle.ts`); `jarvis-contract.ts` is
 * SUPERSEDED by `conductor-classifier.ts` (the enumerated-capability evaluator
 * is replaced by neutral-RBAC resolution + the fail-closed classifier) —
 * kept in place, not deleted.
 *
 * Boundary: pure data + pure functions + Zod schemas. No I/O, no vendor, no
 * wall-clock sampling (time is always caller-supplied), no persistence.
 */

import { z } from "zod";
import type { ExecutionPathStage, MissionExecutionState } from "../missions/mission-execution";
import type { IncidentSeverity } from "../jarvis/escalation";

/* ─────────────────────────────────────────────────────────────
 * Identity + vocabulary
 * ────────────────────────────────────────────────────────────*/

/** The only actor ref Conductor signs decisions with (§12 provenance). */
export const CONDUCTOR_ACTOR_REF = "conductor" as const;

/** Mission-id prefix of Conductor-created repair missions (self-exclusion rule). */
export const CONDUCTOR_REPAIR_MISSION_PREFIX = "conductor-repair-";

/** The memory domain Conductor writes through the canonical memory tier. */
export const CONDUCTOR_MEMORY_DOMAIN = "orchestration";

export const CONDUCTOR_CYCLE_PHASES = [
  "WAKE",
  "OBSERVE",
  "ASSESS",
  "PRIORITIZE",
  "ACT",
  "REPORT",
  "SLEEP",
] as const;

export type ConductorCyclePhase = (typeof CONDUCTOR_CYCLE_PHASES)[number];

/**
 * Finding kinds Conductor derives from observed state. Each kind maps
 * deterministically (see `conductor-cycle.ts`) onto a proposed action class.
 */
export type ConductorFindingKind =
  | "mission_stuck"
  | "mission_failed"
  | "mission_denied"
  | "evidence_unverified"
  | "worker_quarantined"
  | "worker_suspended";

export const CONDUCTOR_FINDING_KINDS: readonly ConductorFindingKind[] = [
  "mission_stuck",
  "mission_failed",
  "mission_denied",
  "evidence_unverified",
  "worker_quarantined",
  "worker_suspended",
];

/**
 * The action classes Conductor may PROPOSE. Destructive classes exist only so
 * the classifier can refuse them by name (fail-closed deny rules) — no
 * Conductor code path ever constructs them as an intended outcome.
 */
export type ConductorActionClass =
  | "retry_safe_mission"
  | "open_repair_intent"
  | "escalate_to_human"
  | "record_cycle_memory"
  | "execute_critical_action"
  | "deploy"
  | "delete_data"
  | "purge_production_state"
  | "modify_governance"
  | "grant_authority";

export const CONDUCTOR_ACTION_CLASSES: readonly ConductorActionClass[] = [
  "retry_safe_mission",
  "open_repair_intent",
  "escalate_to_human",
  "record_cycle_memory",
  "execute_critical_action",
  "deploy",
  "delete_data",
  "purge_production_state",
  "modify_governance",
  "grant_authority",
];

/** Closed deny-code vocabulary of the Conductor classifier (fail-closed). */
export type ConductorDenyCode =
  | "deploy_forbidden"
  | "destructive_write_forbidden"
  | "production_state_forbidden"
  | "governance_mutation_forbidden"
  | "self_authority_grant_forbidden"
  | "unknown_action_class";

/* ─────────────────────────────────────────────────────────────
 * Claims (§9/§12 — provenance-bearing observations)
 * ────────────────────────────────────────────────────────────*/

/** Where a Conductor claim came from. DB-backed ports are verified state. */
export type ConductorClaimSource =
  "mission_record_port" | "worker_registry_port" | "verification_port" | "conductor_memory";

/**
 * A provenance-stamped claim about system state. `verified: true` marks
 * DB-backed canonical state (Reality, §9); `false` marks derived or
 * memory-carried intelligence — never promoted silently.
 */
export interface ConductorClaim<T> {
  readonly source: ConductorClaimSource;
  /** Structured pointer into the source of record (table + key). */
  readonly sourceRef: string;
  readonly observedAt: string;
  readonly verified: boolean;
  /** `canonical` only when verified; everything else is `uncertain`. */
  readonly confidence: "canonical" | "uncertain";
  readonly claim: T;
}

export function conductorClaim<T>(
  source: ConductorClaimSource,
  sourceRef: string,
  observedAt: string,
  claim: T,
): ConductorClaim<T> {
  return {
    source,
    sourceRef,
    observedAt,
    verified: source !== "conductor_memory",
    confidence: source === "conductor_memory" ? "uncertain" : "canonical",
    claim,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Observation ports (read-only; DB-backed at runtime wiring)
 * ────────────────────────────────────────────────────────────*/

/** The worker-side posture Conductor assesses (workforce registry read). */
export interface ConductorWorkerPosture {
  readonly workerId: string;
  readonly tenantId: string;
  readonly lifecycle: string;
  readonly quarantined: boolean;
  readonly failureCount: number;
  readonly observedAt: string;
}

/** A recorded independent verification decision (verification port read). */
export interface ConductorVerificationRecord {
  readonly executionId: string;
  readonly decision: "verified" | "failed" | "inconclusive";
  readonly reason: string;
  readonly verifierId: string;
  readonly recordedAt: string;
}

/**
 * The READ-ONLY observation surface Conductor assesses. Implementations are
 * wired to the DB-backed record/registry ports at the server boundary; the
 * cycle itself performs no persistence through this port (§27: server
 * functions remain the APIs — Conductor only reads state of record).
 */
export interface ConductorObservationPort {
  readonly backend: "db";
  listExecutions(tenantId: string): Promise<readonly MissionExecutionState[]>;
  listWorkerPostures(tenantId: string): Promise<readonly ConductorWorkerPosture[]>;
  listVerificationRecords(tenantId: string): Promise<readonly ConductorVerificationRecord[]>;
}

/* ─────────────────────────────────────────────────────────────
 * Findings, assessments, decisions
 * ────────────────────────────────────────────────────────────*/

/** A derived assessment item — Intelligence, never canonical truth (§9). */
export interface ConductorFinding {
  /** Deterministic: `${kind}:${subjectRef}` — the idempotency anchor. */
  readonly findingId: string;
  readonly kind: ConductorFindingKind;
  readonly tenantId: string;
  /** The execution or worker the finding is about. */
  readonly subjectRef: string;
  readonly severity: IncidentSeverity;
  readonly summary: string;
  /** Evidence refs backing the finding (escalations require them). */
  readonly evidenceRefs: readonly string[];
  readonly observedAt: string;
  /** Provenance of the underlying state claim (§12). */
  readonly claim: ConductorClaim<string>;
}

export interface ConductorAssessment {
  readonly finding: ConductorFinding;
  readonly proposedAction: ConductorActionClass;
  /** Deterministic, explainable ordering rationale (AGENTS §16 decision). */
  readonly rationale: string;
}

export type ConductorClassifierVerdict =
  | { readonly decision: "ALLOW"; readonly reason: string }
  | {
      readonly decision: "REQUIRE_APPROVAL";
      readonly reason: string;
      readonly routedTo: "human_operator";
    }
  | { readonly decision: "DENY"; readonly code: ConductorDenyCode; readonly reason: string };

export interface ConductorDecision {
  readonly decisionId: string;
  readonly findingId: string;
  readonly proposedAction: ConductorActionClass;
  readonly verdict: ConductorClassifierVerdict;
  /** Whether Conductor ACTED (delegated / escalated) — approvals are never self-executed. */
  readonly acted: boolean;
  readonly reason: string;
  readonly decidedAt: string;
}

export interface ConductorApprovalRequest {
  readonly approvalId: string;
  readonly findingId: string;
  readonly subjectRef: string;
  readonly proposedAction: ConductorActionClass;
  readonly summary: string;
  readonly severity: IncidentSeverity;
  readonly requestedAt: string;
  /** Always `human_operator` — Conductor never executes past this gate (§21). */
  readonly routedTo: "human_operator";
}

export interface ConductorDelegationOutcome {
  readonly findingId: string;
  readonly repairMissionId: string;
  readonly repairExecutionId: string;
  readonly intentRecorded: boolean;
  readonly assignmentRecorded: boolean;
  /** True when the idempotency key replayed a recorded outcome (§10). */
  readonly replayed: boolean;
  /** Set when the RBAC engine or the mission path DENIED the delegation. */
  readonly denialReason: string | null;
  /** Provenance of the authority used (the delegation grant ref), or null. */
  readonly authorityRef: string | null;
}

/* ─────────────────────────────────────────────────────────────
 * Cycle report (the structured cycle summary)
 * ────────────────────────────────────────────────────────────*/

export interface ConductorCycleReport {
  readonly cycleId: string;
  readonly tenantId: string;
  readonly actorRef: typeof CONDUCTOR_ACTOR_REF;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly observed: {
    readonly executions: number;
    readonly workers: number;
    readonly verificationRecords: number;
  };
  readonly findings: readonly ConductorFinding[];
  readonly prioritized: readonly ConductorAssessment[];
  readonly decisions: readonly ConductorDecision[];
  readonly delegations: readonly ConductorDelegationOutcome[];
  readonly approvalRequests: readonly ConductorApprovalRequest[];
  readonly escalations: readonly { readonly recordId: string; readonly tier: string }[];
  readonly memoryWrites: readonly { readonly recordId: string; readonly provenance: string }[];
  /** Findings above the per-cycle bound — left for the next cycle (§45). */
  readonly deferred: readonly string[];
  readonly sleep: {
    readonly state: "sleeping";
    readonly reason: string;
  };
}

/* ─────────────────────────────────────────────────────────────
 * Input schemas (Zod — everything crossing the trust boundary)
 * ────────────────────────────────────────────────────────────*/

export const conductorWorkerPostureSchema = z
  .object({
    workerId: z.string().trim().min(1).max(160),
    tenantId: z.string().trim().min(1).max(128),
    lifecycle: z.string().trim().min(1).max(64),
    quarantined: z.boolean(),
    failureCount: z.number().int().min(0).max(1_000_000),
    observedAt: z.string().refine((v) => Number.isFinite(Date.parse(v)), {
      message: "must be a parseable timestamp",
    }),
  })
  .strict();

export const conductorVerificationRecordSchema = z
  .object({
    executionId: z.string().trim().min(1).max(160),
    decision: z.enum(["verified", "failed", "inconclusive"]),
    reason: z.string().trim().min(1).max(500),
    verifierId: z.string().trim().min(1).max(160),
    recordedAt: z.string().refine((v) => Number.isFinite(Date.parse(v)), {
      message: "must be a parseable timestamp",
    }),
  })
  .strict();

export const conductorCycleConfigSchema = z
  .object({
    /** Cost bound (§32): at most this many findings are acted on per cycle. */
    maxFindingsPerCycle: z.number().int().min(1).max(100).default(20),
    /** An `assigned` execution unupdated for longer than this is stuck. */
    assignedStaleAfterMs: z.number().int().min(1).max(86_400_000).default(60_000),
  })
  .strict();

export type ConductorCycleConfig = z.input<typeof conductorCycleConfigSchema>;

export const conductorCycleInputSchema = z
  .object({
    tenantId: z.string().trim().min(1).max(128),
    /** The cycle instant (J-023: supplied, never sampled). */
    now: z
      .string()
      .refine((v) => Number.isFinite(Date.parse(v)), { message: "must be a parseable timestamp" }),
  })
  .strict();

export type ConductorCycleInput = z.infer<typeof conductorCycleInputSchema>;

/** Execution stages that are non-terminal and non-evidenced (stuck candidates). */
export const STUCK_CANDIDATE_STAGES: readonly ExecutionPathStage[] = [
  "assigned",
  "leased",
  "requeued",
];

/** Underlying mission actions that are NEVER safe for Conductor to retry (§45). */
export const CRITICAL_ACTION_PATTERNS: readonly RegExp[] = [
  /^deploy/i,
  /^delete/i,
  /^payout/i,
  /^migrate[-_]prod/i,
  /^rotate[-_]secret/i,
];

export function isCriticalMissionAction(action: string): boolean {
  return CRITICAL_ACTION_PATTERNS.some((pattern) => pattern.test(action));
}
