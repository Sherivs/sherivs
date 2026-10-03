/**
 * CoreGrid — Phase 37 Simulation & Future Intelligence Engine contracts
 * (Squad G / mission G-057, Contract Architect).
 *
 * This module defines the typed, Zod-validated substrate surface for
 * scenario definition, bounded simulation runs, and simulated outcomes.
 * It is a CONTRACT module: pure, no I/O, no persistence, no vendor
 * imports, no secrets, offline-testable.
 *
 * TRUTH BOUNDARY (AGENTS §9 — canonical truth vs. intelligence):
 * Everything this engine produces is DERIVED intelligence. A simulated
 * outcome is a labelled, bounded, expiring, reproducible estimate —
 * never a measurement, never a canonical record. The schema itself
 * enforces the boundary:
 *   - every outcome carries `origin: "derived"` and the literal admits
 *     no other value ("observed" / "canonical" do not parse);
 *   - outcomes can only exist for a run whose status is "completed";
 *   - every outcome carries a validity expiry — derived intelligence
 *     that is never invalidated is a governance defect, so expiry is
 *     mandatory and inverted lifetimes fail closed;
 *   - the ONLY path from a simulated outcome toward a canonical surface
 *     is `decideSimulatedWriteback`, which implements AGENTS §16/§21
 *     (Proposal → Validation → Policy → Approval → Audit) and fails
 *     closed: without policy, a matching non-expired approval, and an
 *     audit destination the decision is DENY or REQUIRE_APPROVAL —
 *     never a silent write.
 *
 * OTHER LAWS ENCODED HERE:
 *   - Multi-tenancy (§13): every artifact carries tenant context, and
 *     cross-artifact tenant mismatch fails closed.
 *   - Purpose limitation (§16): a run request without a declared
 *     purpose does not parse.
 *   - Reproducibility & bounds (phase contract principle): a run is
 *     deterministic (declared seed) and horizon-bounded; an unbounded
 *     simulation is invalid.
 *   - Provenance (§12): scenarios and outcomes carry who/what/when/
 *     under-which-authority records.
 *   - Clock injection: all time flows from caller-supplied `nowMs`.
 */

import { z } from "zod";

/* ─────────────────────────────────────────────────────────────
 * Vocabulary
 * ────────────────────────────────────────────────────────────*/

/** Bump on any breaking change to the bundle shape. */
export const SIMULATION_CONTRACT_SCHEMA_VERSION = 1 as const;

/** Lifecycle of a scenario definition. Only "approved" scenarios may run. */
export const SCENARIO_STATUSES = ["draft", "approved", "retired"] as const;
export type ScenarioStatus = (typeof SCENARIO_STATUSES)[number];

/** Lifecycle of a simulation run. Outcomes exist only for "completed" runs. */
export const RUN_STATUSES = ["pending", "running", "completed", "failed"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** The only origin a simulated artifact may declare (AGENTS §9). */
export const DERIVED_ORIGIN = "derived" as const;

/** Governance decisions (AGENTS §16 subset this module can emit). */
export type SimulationGovernanceDecision = "ALLOW" | "DENY" | "REQUIRE_APPROVAL";

/* ─────────────────────────────────────────────────────────────
 * Shared primitives
 * ────────────────────────────────────────────────────────────*/

/**
 * Provenance record (AGENTS §12): who produced the artifact, under
 * which authority, and when. Anonymous artifacts do not parse.
 */
export const ProvenanceSchema = z.object({
  declaredBy: z.string().min(1),
  authority: z.string().min(1),
  recordedAtMs: z.number().int().nonnegative(),
});

export type Provenance = z.infer<typeof ProvenanceSchema>;

/** A declared assumption the scenario depends on. Assumptions are explicit or the scenario is invalid. */
export const ScenarioAssumptionSchema = z.object({
  assumptionId: z.string().min(1),
  statement: z.string().min(1),
  provenance: ProvenanceSchema,
});

export type ScenarioAssumption = z.infer<typeof ScenarioAssumptionSchema>;

/** One named, bounded parameter. Values are numeric; units are declared, not guessed. */
export const SimulationParameterSchema = z.object({
  key: z.string().min(1),
  value: z.number().finite(),
  unit: z.string().min(1),
});

export type SimulationParameter = z.infer<typeof SimulationParameterSchema>;

/**
 * A reference to a canonical subject the scenario READS. Scenarios are
 * readers of reality, never writers: the reference is opaque here and
 * no mutation surface exists anywhere in this module's schemas.
 */
export const SubjectRefSchema = z
  .string()
  .min(1)
  .refine((ref) => !ref.startsWith("/"), "subjectRef must be a logical reference, not a path");

export type SubjectRef = z.infer<typeof SubjectRefSchema>;

/* ─────────────────────────────────────────────────────────────
 * Scenario definition
 * ────────────────────────────────────────────────────────────*/

export const ScenarioDefinitionSchema = z.object({
  schemaVersion: z.literal(SIMULATION_CONTRACT_SCHEMA_VERSION),
  scenarioId: z.string().min(1),
  /** Tenant context (AGENTS §13) — every scenario is tenant-scoped. */
  tenantRef: z.string().min(1),
  title: z.string().min(1),
  status: z.enum(SCENARIO_STATUSES),
  /** Canonical subjects this scenario reads (read-only, opaque refs). */
  subjectRefs: z.array(SubjectRefSchema).min(1, "a scenario must name the subjects it reads"),
  assumptions: z.array(ScenarioAssumptionSchema).min(1, "a scenario must declare its assumptions"),
  parameters: z.array(SimulationParameterSchema).max(64),
  /** Forward-planning bound, in model steps. Positive and finite. */
  horizonSteps: z.number().int().positive(),
  /** Scenario-level run cap: a scenario without declared bounds is invalid. */
  maxRuns: z.number().int().positive(),
  /** Fail-closed by construction: the only parseable value is `false`. */
  canonicalWriteback: z.literal(false),
  provenance: ProvenanceSchema,
});

export type ScenarioDefinition = z.infer<typeof ScenarioDefinitionSchema>;

/* ─────────────────────────────────────────────────────────────
 * Run request
 * ────────────────────────────────────────────────────────────*/

export const SimulationRunRequestSchema = z.object({
  runId: z.string().min(1),
  scenarioId: z.string().min(1),
  tenantRef: z.string().min(1),
  /**
   * Deterministic seed. Reproducibility is mandatory: an unseeded run
   * cannot be re-validated and therefore does not parse.
   */
  seed: z.number().int().nonnegative(),
  /** Effective horizon for THIS run; must not exceed the scenario's bound (cross-checked). */
  horizonSteps: z.number().int().positive(),
  /** Purpose limitation (AGENTS §16): why is this run executing? */
  purpose: z.string().min(1),
  requestedBy: z.string().min(1),
  requestedAtMs: z.number().int().nonnegative(),
  /**
   * Execution isolation, fail-closed by construction: only the isolated
   * runtime parses. A run that could observe or mutate its surroundings
   * is not a simulation this contract describes.
   */
  executionIsolation: z.literal("isolated"),
});

export type SimulationRunRequest = z.infer<typeof SimulationRunRequestSchema>;

/* ─────────────────────────────────────────────────────────────
 * Simulated outcome (derived intelligence)
 * ────────────────────────────────────────────────────────────*/

export const SimulatedOutcomeSchema = z.object({
  outcomeId: z.string().min(1),
  runId: z.string().min(1),
  tenantRef: z.string().min(1),
  /** The §9 label. `z.literal` admits nothing but "derived". */
  origin: z.literal(DERIVED_ORIGIN),
  /** Canonical subjects this estimate was derived FROM (provenance of inputs). */
  subjectRefs: z.array(SubjectRefSchema).min(1),
  /** Position on the run's timeline this estimate describes (0 = start of run). */
  horizonStep: z.number().int().nonnegative(),
  /** Point estimate produced by the run. */
  estimate: z.number().finite(),
  /** Uncertainty band: must contain the estimate (cross-checked). */
  lowerBound: z.number().finite(),
  upperBound: z.number().finite(),
  /** Confidence in [0, 1]. */
  confidence: z.number().min(0).max(1),
  generatedAtMs: z.number().int().nonnegative(),
  /** Mandatory freshness bound: derived intelligence expires (invariant cross-checked). */
  validUntilMs: z.number().int().nonnegative(),
  /** Immutable audit record reference for the run that produced this outcome (AGENTS §29). */
  auditRef: z.string().min(1),
  provenance: ProvenanceSchema,
});

export type SimulatedOutcome = z.infer<typeof SimulatedOutcomeSchema>;

/**
 * The complete, self-describing artifact of one simulation: scenario,
 * run request, run status, and (only for completed runs) outcomes.
 */
export const SimulationRunBundleSchema = z.object({
  schemaVersion: z.literal(SIMULATION_CONTRACT_SCHEMA_VERSION),
  scenario: ScenarioDefinitionSchema,
  run: SimulationRunRequestSchema,
  status: z.enum(RUN_STATUSES),
  outcomes: z.array(SimulatedOutcomeSchema),
});

export type SimulationRunBundle = z.infer<typeof SimulationRunBundleSchema>;

/* ─────────────────────────────────────────────────────────────
 * Validation (fail closed, typed issues)
 * ────────────────────────────────────────────────────────────*/

export type SimulationIssueCode =
  | "invalid_input"
  | "schema_version_unsupported"
  | "tenant_mismatch"
  | "scenario_mismatch"
  | "run_mismatch"
  | "horizon_exceeded"
  | "scenario_not_approved"
  | "outcomes_before_completion"
  | "duplicate_outcome"
  | "inverted_validity"
  | "bounds_exclude_estimate"
  | "unknown_subject";

export interface SimulationIssue {
  code: SimulationIssueCode;
  detail: string;
}

export type SimulationValidationResult =
  | { readonly ok: true; readonly bundle: SimulationRunBundle }
  | { readonly ok: false; readonly issues: readonly SimulationIssue[] };

export interface ValidateSimulationBundleOptions {
  /** Caller-injected observation time (ms). Required for freshness checks. */
  nowMs?: number;
  /** Absolute cap any run horizon must respect (runaway-simulation guard). */
  maxHorizonSteps?: number;
}

function crossFieldIssues(bundle: SimulationRunBundle, options: ValidateSimulationBundleOptions): SimulationIssue[] {
  const issues: SimulationIssue[] = [];
  const { scenario, run, status, outcomes } = bundle;

  if (run.scenarioId !== scenario.scenarioId) {
    issues.push({
      code: "scenario_mismatch",
      detail: `run ${run.runId} references scenario ${run.scenarioId} but the bundle declares ${scenario.scenarioId}`,
    });
  }
  if (run.tenantRef !== scenario.tenantRef) {
    issues.push({
      code: "tenant_mismatch",
      detail: "run tenant context differs from the scenario's tenant context; tenant isolation fails closed",
    });
  }
  if (run.horizonSteps > scenario.horizonSteps) {
    issues.push({
      code: "horizon_exceeded",
      detail: `run horizon ${run.horizonSteps} exceeds the scenario bound ${scenario.horizonSteps}`,
    });
  }
  if (options.maxHorizonSteps !== undefined && run.horizonSteps > options.maxHorizonSteps) {
    issues.push({
      code: "horizon_exceeded",
      detail: `run horizon ${run.horizonSteps} exceeds the governed maximum ${options.maxHorizonSteps}`,
    });
  }
  if (scenario.status !== "approved") {
    issues.push({
      code: "scenario_not_approved",
      detail: `scenario ${scenario.scenarioId} has status "${scenario.status}"; only approved scenarios may run`,
    });
  }
  if (status !== "completed" && outcomes.length > 0) {
    issues.push({
      code: "outcomes_before_completion",
      detail: `run status is "${status}" but ${outcomes.length} outcome(s) are attached; outcomes exist only for completed runs`,
    });
  }

  const scenarioSubjects = new Set(scenario.subjectRefs);
  const seenOutcomes = new Set<string>();
  for (const outcome of outcomes) {
    if (seenOutcomes.has(outcome.outcomeId)) {
      issues.push({
        code: "duplicate_outcome",
        detail: `outcomeId ${outcome.outcomeId} appears more than once`,
      });
    }
    seenOutcomes.add(outcome.outcomeId);

    if (outcome.runId !== run.runId) {
      issues.push({
        code: "run_mismatch",
        detail: `outcome ${outcome.outcomeId} belongs to run ${outcome.runId}, not ${run.runId}`,
      });
    }
    if (outcome.tenantRef !== scenario.tenantRef) {
      issues.push({
        code: "tenant_mismatch",
        detail: `outcome ${outcome.outcomeId} carries a tenant context different from the scenario's`,
      });
    }
    if (outcome.validUntilMs <= outcome.generatedAtMs) {
      issues.push({
        code: "inverted_validity",
        detail: `outcome ${outcome.outcomeId}: validUntilMs must be strictly after generatedAtMs`,
      });
    }
    if (outcome.lowerBound > outcome.estimate || outcome.estimate > outcome.upperBound) {
      issues.push({
        code: "bounds_exclude_estimate",
        detail: `outcome ${outcome.outcomeId}: the uncertainty band [${outcome.lowerBound}, ${outcome.upperBound}] does not contain the estimate ${outcome.estimate}`,
      });
    }
    for (const subject of outcome.subjectRefs) {
      if (!scenarioSubjects.has(subject)) {
        issues.push({
          code: "unknown_subject",
          detail: `outcome ${outcome.outcomeId} references subject ${subject} that the scenario does not read`,
        });
      }
    }
    if (options.nowMs !== undefined && outcome.validUntilMs <= options.nowMs) {
      issues.push({
        code: "inverted_validity",
        detail: `outcome ${outcome.outcomeId} expired at ${outcome.validUntilMs} (observed at ${options.nowMs}); expired derived intelligence is not usable`,
      });
    }
  }

  return issues;
}

/**
 * Validate a raw (untrusted) value as a simulation run bundle. Shape
 * first (Zod), then cross-field invariants, then freshness against the
 * injected clock. All issues are collected, never truncated to the first.
 */
export function validateSimulationRunBundle(
  raw: unknown,
  options: ValidateSimulationBundleOptions = {},
): SimulationValidationResult {
  const parsed = SimulationRunBundleSchema.safeParse(raw);
  if (!parsed.success) {
    const isVersionProblem = parsed.error.issues.some(
      (issue) => issue.path.length >= 1 && issue.path[0] === "schemaVersion",
    );
    return {
      ok: false,
      issues: [
        isVersionProblem
          ? {
              code: "schema_version_unsupported",
              detail: "bundle schemaVersion is not supported by this validator",
            }
          : {
              code: "invalid_input",
              detail: parsed.error.issues
                .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
                .join("; "),
            },
      ],
    };
  }

  const bundle = parsed.data;
  const issues = crossFieldIssues(bundle, options);
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, bundle };
}

/* ─────────────────────────────────────────────────────────────
 * Decision-support usability (pure, clock-injected)
 * ────────────────────────────────────────────────────────────*/

export type OutcomeUsabilityCode =
  | "usable"
  | "not_completed"
  | "expired"
  | "confidence_below_threshold";

export interface OutcomeUsability {
  readonly usable: boolean;
  readonly reason: Exclude<OutcomeUsabilityCode, "usable"> | null;
}

/**
 * Whether a derived outcome may inform decision support RIGHT NOW.
 * Fail-closed: any doubt (unknown status, expired freshness, weak
 * confidence) resolves to "not usable" with a named reason.
 */
export function usabilityForDecisionSupport(
  bundle: SimulationRunBundle,
  outcome: SimulatedOutcome,
  options: { nowMs: number; minConfidence?: number } ,
): OutcomeUsability {
  if (bundle.status !== "completed") {
    return { usable: false, reason: "not_completed" };
  }
  if (outcome.validUntilMs <= options.nowMs) {
    return { usable: false, reason: "expired" };
  }
  const minConfidence = options.minConfidence ?? 0;
  if (outcome.confidence < minConfidence) {
    return { usable: false, reason: "confidence_below_threshold" };
  }
  return { usable: true, reason: null };
}

/* ─────────────────────────────────────────────────────────────
 * Comparison against reality (read-only diagnostic)
 * ────────────────────────────────────────────────────────────*/

export interface RealityComparison {
  /** Always "derived": even a comparison ABOUT derived intelligence is derived. */
  readonly label: typeof DERIVED_ORIGIN;
  readonly outcomeId: string;
  readonly observedValue: number;
  readonly withinPredictedBounds: boolean;
  readonly divergence: number;
}

/**
 * Compare a simulated estimate against an observed value. The observed
 * value is supplied by the CALLER, read from the canonical layer under
 * its own authorization — this module has no read or write path to
 * canonical records. The result is a diagnostic, never an update.
 */
export function compareAgainstObservation(
  outcome: SimulatedOutcome,
  observedValue: number,
): RealityComparison {
  return {
    label: DERIVED_ORIGIN,
    outcomeId: outcome.outcomeId,
    observedValue,
    withinPredictedBounds: observedValue >= outcome.lowerBound && observedValue <= outcome.upperBound,
    divergence: observedValue - outcome.estimate,
  };
}

/* ─────────────────────────────────────────────────────────────
 * The ONLY bridge toward canonical surfaces (§9/§16/§21)
 * ────────────────────────────────────────────────────────────*/

/**
 * A governed proposal to let a simulated outcome influence a canonical
 * surface. This module can DECIDE such proposals; it can never execute
 * them — no write surface exists here. Execution, when a decision is
 * ALLOW, belongs to the owning domain phase under its own policy,
 * approval and audit machinery.
 */
export const SimulationWritebackProposalSchema = z.object({
  proposalId: z.string().min(1),
  tenantRef: z.string().min(1),
  /** The single canonical subject the proposal targets. */
  targetSubjectRef: SubjectRefSchema,
  purpose: z.string().min(1),
  /**
   * Governing policy reference (AGENTS §16 — under which policy?).
   * Optional in shape, mandatory at the decision gate: a proposal
   * without one is DENIED, never silently routed.
   */
  policyRef: z.string().min(1).optional(),
  /** Where the audit record for the executed write will land (AGENTS §29). */
  auditDestinationRef: z.string().min(1).optional(),
  outcome: SimulatedOutcomeSchema,
});

export type SimulationWritebackProposal = z.infer<typeof SimulationWritebackProposalSchema>;

/** A recorded human approval for a specific tenant + subject scope. */
export const WritebackApprovalSchema = z.object({
  approvalId: z.string().min(1),
  approvedBy: z.string().min(1),
  approvedAtMs: z.number().int().nonnegative(),
  /** Approvals expire (AGENTS §31: expired access fails). */
  expiresAtMs: z.number().int().nonnegative(),
  tenantRef: z.string().min(1),
  subjectRefs: z.array(SubjectRefSchema).min(1),
  revoked: z.boolean().default(false),
});

export type WritebackApproval = z.infer<typeof WritebackApprovalSchema>;

export type WritebackDenyReason =
  | "invalid_input"
  | "no_policy"
  | "approval_mismatch_tenant"
  | "approval_mismatch_subject"
  | "approval_expired"
  | "approval_revoked"
  | "no_audit_destination";

export type WritebackDecision =
  | { readonly decision: "DENY"; readonly reason: WritebackDenyReason }
  | { readonly decision: "REQUIRE_APPROVAL" }
  | { readonly decision: "ALLOW" };

export interface DecideWritebackOptions {
  nowMs: number;
  approval?: WritebackApproval;
}

/**
 * Decide a simulated-writeback proposal. Fail-closed ordering:
 *   1. shape — an unparseable proposal is DENY ("invalid_input");
 *   2. policy — no declared policy, no decision surface: DENY;
 *   3. approval — absent → REQUIRE_APPROVAL (escalation, not a write);
 *      present but mismatched, expired, or revoked → DENY;
 *   4. audit — no declared audit destination → DENY;
 *   5. otherwise ALLOW — the proposal MAY proceed to execution elsewhere,
 *      under the declared policy, with the approval and audit trail
 *      recorded. The `origin: "derived"` literal on the embedded outcome
 *      guarantees no unlabelled artifact can ever reach step 5.
 */
export function decideSimulatedWriteback(
  raw: unknown,
  options: DecideWritebackOptions,
): WritebackDecision {
  const parsed = SimulationWritebackProposalSchema.safeParse(raw);
  if (!parsed.success) {
    return { decision: "DENY", reason: "invalid_input" };
  }
  const proposal = parsed.data;

  if (proposal.policyRef === undefined || proposal.policyRef.trim().length === 0) {
    return { decision: "DENY", reason: "no_policy" };
  }
  if (proposal.auditDestinationRef === undefined) {
    return { decision: "DENY", reason: "no_audit_destination" };
  }

  const approval = options.approval;
  if (approval === undefined) {
    return { decision: "REQUIRE_APPROVAL" };
  }

  if (approval.tenantRef !== proposal.tenantRef || proposal.outcome.tenantRef !== proposal.tenantRef) {
    return { decision: "DENY", reason: "approval_mismatch_tenant" };
  }
  const covered =
    approval.subjectRefs.includes(proposal.targetSubjectRef) &&
    proposal.outcome.subjectRefs.includes(proposal.targetSubjectRef);
  if (!covered) {
    return { decision: "DENY", reason: "approval_mismatch_subject" };
  }
  if (approval.expiresAtMs <= options.nowMs) {
    return { decision: "DENY", reason: "approval_expired" };
  }
  if (approval.revoked) {
    return { decision: "DENY", reason: "approval_revoked" };
  }

  return { decision: "ALLOW" };
}
