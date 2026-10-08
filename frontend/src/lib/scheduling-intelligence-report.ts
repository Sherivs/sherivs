/**
 * CoreGrid — Scheduling & Timetable Intelligence: the L4 intelligence report.
 *
 * The report is evidence, not marketing. Every check below EXECUTES the scheduling engines and
 * states what it observed; a check that cannot be observed is reported as a declared gap rather
 * than as a pass. Rules cite the module and the test suite that hold them, so a reviewer can go
 * from a claim in this file to the code that enforces it.
 *
 * Domain-neutral: the report describes CoreGrid scheduling semantics. It names no runtime and no
 * customer, because the capability belongs to the platform and each organization experiences it
 * through its own activities, resources and calendars.
 */

import {
  CONFLICT_TYPES,
  detectConflicts,
  escalateConflicts,
  isBlocking,
  RESOLUTION_STRATEGIES,
  type SchedulingAssignment,
} from "./scheduling-conflicts";
import {
  analyseImpact,
  balanceOf,
  compareVersions,
  explainPlacement,
  measureDisruption,
  rankCandidates,
  SCORE_DIMENSIONS,
  scoreSchedule,
  type RankedCandidate,
} from "./scheduling-quality";

export interface SchedulingRule {
  id: string;
  statement: string;
  /** The module that holds the rule, and the suite that proves it. */
  module: string;
  suite: string;
}

/** The invariants this subsystem must never break. */
export const SCHEDULING_RULES: readonly SchedulingRule[] = [
  {
    id: "SCH-01",
    statement:
      "A schedule is a constrained allocation of participants and resources to time, not a list of times.",
    module: "scheduling-conflicts.ts",
    suite: "scheduling-governance.test.ts",
  },
  {
    id: "SCH-02",
    statement:
      "A hard-constraint violation is never resolved silently; blocking conflicts stop publication.",
    module: "scheduling-conflicts.ts",
    suite: "scheduling-governance.test.ts",
  },
  {
    id: "SCH-03",
    statement:
      "An infeasible request is reported as infeasible with guidance, never fabricated into a valid plan.",
    module: "scheduling-conflicts.ts",
    suite: "scheduling-governance.test.ts",
  },
  {
    id: "SCH-04",
    statement: "Blocked periods are policy: a blocked interval is a conflict, not a preference.",
    module: "scheduling-conflicts.ts",
    suite: "scheduling-governance.test.ts",
  },
  {
    id: "SCH-05",
    statement: "Capacity exceedance is refused and the numbers involved are stated.",
    module: "scheduling-conflicts.ts",
    suite: "scheduling-governance.test.ts",
  },
  {
    id: "SCH-06",
    statement: "Accessibility is a scheduling constraint, not a user-interface feature.",
    module: "scheduling-conflicts.ts",
    suite: "scheduling-governance.test.ts",
  },
  {
    id: "SCH-07",
    statement:
      "Movement between resources must be physically possible; impossible transitions are conflicts.",
    module: "scheduling-conflicts.ts",
    suite: "scheduling-governance.test.ts",
  },
  {
    id: "SCH-08",
    statement:
      "Feasibility dominates optimization: feasibility is binary and never traded for quality.",
    module: "scheduling-quality.ts",
    suite: "scheduling-governance.test.ts",
  },
  {
    id: "SCH-09",
    statement:
      "A change to an active plan is measured by its disruption, and stability tolerance is explicit.",
    module: "scheduling-quality.ts",
    suite: "scheduling-governance.test.ts",
  },
  {
    id: "SCH-10",
    statement:
      "Minimal disruption outranks theoretical efficiency when choosing between feasible candidates.",
    module: "scheduling-quality.ts",
    suite: "scheduling-governance.test.ts",
  },
  {
    id: "SCH-11",
    statement:
      "Two versions of a plan are comparable by placement, resource, participant and conflict.",
    module: "scheduling-quality.ts",
    suite: "scheduling-governance.test.ts",
  },
  {
    id: "SCH-12",
    statement:
      "Every placement is explainable: why here, why this resource, why not the alternatives.",
    module: "scheduling-quality.ts",
    suite: "scheduling-governance.test.ts",
  },
  {
    id: "SCH-13",
    statement:
      "Fairness is measurable: load balance is computed from committed load, not asserted.",
    module: "scheduling-quality.ts",
    suite: "scheduling-governance.test.ts",
  },
  {
    id: "SCH-14",
    statement:
      "Scheduling vocabulary is institutional data; the kernel never assumes one organization's roles.",
    module: "scheduling-conflicts.ts",
    suite: "platform-neutrality.test.ts",
  },
];

export type CheckStatus = "ENFORCED" | "FAILED" | "DECLARED";

export interface SchedulingCheck {
  id: string;
  name: string;
  module: string;
  suite: string;
  status: CheckStatus;
  /** What the check actually observed when it ran. */
  evidence: string;
}

export interface SchedulingGap {
  id: string;
  statement: string;
  why: string;
  owner: string;
}

const CHECKED_AT = "2026-01-05T08:00:00Z";

function fixture(overrides: Partial<SchedulingAssignment> & { id: string }): SchedulingAssignment {
  return {
    tenantId: "tenant-under-check",
    activityId: `activity-${overrides.id}`,
    participants: [],
    resources: [],
    start: "2026-03-02T09:00:00Z",
    end: "2026-03-02T10:00:00Z",
    timezone: "UTC",
    ...overrides,
  };
}

function evaluate(
  id: string,
  name: string,
  module: string,
  observation: () => string,
): SchedulingCheck {
  const base = { id, name, module, suite: "scheduling-governance.test.ts" };
  try {
    return { ...base, status: "ENFORCED", evidence: observation() };
  } catch (error) {
    return {
      ...base,
      status: "FAILED",
      evidence: error instanceof Error ? error.message : "The check could not be observed",
    };
  }
}

function require(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/**
 * Run every check against the live engines. Nothing here is a stored assertion: each evidence
 * string is produced by a call made in this run, so a regression changes the report.
 */
export function runSchedulingChecks(): readonly SchedulingCheck[] {
  return [
    evaluate(
      "CHK-SCH-01",
      "A participant cannot be in two overlapping activities",
      "scheduling-conflicts.ts",
      () => {
        const conflicts = detectConflicts({
          tenantId: "tenant-under-check",
          now: CHECKED_AT,
          assignments: [
            fixture({ id: "c1", activityId: "a1", participants: ["p-1"] }),
            fixture({
              id: "c2",
              activityId: "a2",
              participants: ["p-1"],
              start: "2026-03-02T09:30:00Z",
              end: "2026-03-02T10:30:00Z",
            }),
          ],
        });
        const blocking = conflicts.filter(isBlocking);
        require(blocking.length ===
          1, `Expected one blocking participant conflict, observed ${blocking.length}`);
        return `1 blocking participant conflict observed for an overlap of 30 minutes`;
      },
    ),

    evaluate("CHK-SCH-02", "A resource cannot be double-booked", "scheduling-conflicts.ts", () => {
      const conflicts = detectConflicts({
        tenantId: "tenant-under-check",
        now: CHECKED_AT,
        assignments: [
          fixture({ id: "c1", resources: ["r-1"] }),
          fixture({
            id: "c2",
            resources: ["r-1"],
            start: "2026-03-02T09:45:00Z",
            end: "2026-03-02T10:15:00Z",
          }),
        ],
      });
      const blocking = conflicts.filter((conflict) => conflict.type === "resource");
      require(blocking.length === 1, `Expected one resource conflict, observed ${blocking.length}`);
      return `1 resource conflict observed; strategies offered: ${blocking[0].proposedResolutions.length}`;
    }),

    evaluate(
      "CHK-SCH-03",
      "Capacity exceedance is refused and quantified",
      "scheduling-conflicts.ts",
      () => {
        const conflicts = detectConflicts({
          tenantId: "tenant-under-check",
          now: CHECKED_AT,
          resourceCapacity: { "r-2": 2 },
          assignments: [
            fixture({ id: "c1", resources: ["r-2"], participants: ["p-1", "p-2", "p-3"] }),
          ],
        });
        const capacity = conflicts.find((conflict) => conflict.type === "capacity");
        require(capacity !==
          undefined, "No capacity conflict was reported for a 3-into-2 allocation");
        return capacity.detail;
      },
    ),

    evaluate(
      "CHK-SCH-04",
      "Blocked periods are policy, not preference",
      "scheduling-conflicts.ts",
      () => {
        const conflicts = detectConflicts({
          tenantId: "tenant-under-check",
          now: CHECKED_AT,
          blockedPeriods: [
            {
              id: "b-1",
              start: "2026-03-02T00:00:00Z",
              end: "2026-03-03T00:00:00Z",
              reason: "shutdown",
            },
          ],
          assignments: [fixture({ id: "c1" })],
        });
        const calendar = conflicts.find((conflict) => conflict.type === "calendar");
        require(calendar !== undefined &&
          isBlocking(calendar), "A blocked period did not block the plan");
        return calendar.detail;
      },
    ),

    evaluate(
      "CHK-SCH-05",
      "Capability and accessibility requirements are enforced",
      "scheduling-conflicts.ts",
      () => {
        const conflicts = detectConflicts({
          tenantId: "tenant-under-check",
          now: CHECKED_AT,
          resourceCapabilities: { "r-3": [] },
          accessibleResources: { "r-3": [] },
          assignments: [
            fixture({
              id: "c1",
              resources: ["r-3"],
              demands: { specialised: 1 },
              accessibilityRequirements: ["step_free"],
            }),
          ],
        });
        const types = conflicts.map((conflict) => conflict.type);
        require(types.includes("capability") &&
          types.includes("accessibility"), "A declared requirement was not enforced");
        return `Observed conflict types: ${types.join(", ")}`;
      },
    ),

    evaluate(
      "CHK-SCH-06",
      "Impossible transitions between resources are detected",
      "scheduling-conflicts.ts",
      () => {
        const conflicts = detectConflicts({
          tenantId: "tenant-under-check",
          now: CHECKED_AT,
          assignments: [
            fixture({ id: "c1", resources: ["r-a"], travelMinutesFrom: { "r-b": 45 } }),
            fixture({
              id: "c2",
              resources: ["r-b"],
              start: "2026-03-02T10:05:00Z",
              end: "2026-03-02T11:00:00Z",
            }),
          ],
        });
        const travel = conflicts.find((conflict) => conflict.type === "travel");
        require(travel !== undefined, "An impossible transition produced no conflict");
        return travel.detail;
      },
    ),
  ];
}

/** The quality, disruption and explanation checks, all executed against the live engines. */
export function runSchedulingQualityChecks(): readonly SchedulingCheck[] {
  return [
    evaluate(
      "CHK-SCH-07",
      "Feasibility is binary and derived from blocking conflicts",
      "scheduling-quality.ts",
      () => {
        const conflicts = detectConflicts({
          tenantId: "tenant-under-check",
          now: CHECKED_AT,
          resourceCapacity: { "r-4": 1 },
          assignments: [fixture({ id: "c1", resources: ["r-4"], participants: ["p-1", "p-2"] })],
        });
        const quality = scoreSchedule({ assignments: [fixture({ id: "c1" })], conflicts });
        const feasibility = quality.scores.find((score) => score.dimension === "feasibility");
        require(feasibility?.value ===
          0, `Expected infeasibility, observed ${String(feasibility?.value)}`);
        return feasibility.basis;
      },
    ),

    evaluate(
      "CHK-SCH-08",
      "A change is measured by how much it disturbs the organization",
      "scheduling-quality.ts",
      () => {
        const before = [
          fixture({ id: "c1" }),
          fixture({ id: "c2" }),
          fixture({ id: "c3" }),
          fixture({ id: "c4" }),
        ];
        const vector = measureDisruption(
          before,
          {
            added: [],
            removed: [],
            moved: [
              {
                before: before[0],
                after: { ...before[0], start: "2026-03-02T14:00:00Z", end: "2026-03-02T15:00:00Z" },
              },
            ],
          },
          before,
          0.25,
        );
        require(vector.withinTolerance, "A single move was reported as exceeding a 25% stability tolerance");
        return vector.summary;
      },
    ),

    evaluate(
      "CHK-SCH-09",
      "Minimal disruption outranks theoretical efficiency",
      "scheduling-quality.ts",
      () => {
        const quality = scoreSchedule({
          assignments: [fixture({ id: "c1" })],
          conflicts: [],
          loads: { "p-1": 1 },
        });
        const candidate = (
          id: string,
          ratio: number,
          overall: number,
          recommended: boolean,
        ): RankedCandidate => ({
          candidateId: id,
          quality: { ...quality, overall },
          disruption: {
            changedAssignments: Math.round(ratio * 10),
            affectedParticipants: Math.round(ratio * 10),
            affectedResources: Math.round(ratio * 10),
            disruptionRatio: ratio,
            withinTolerance: ratio <= 0.25,
            summary: id,
          },
          conflicts: [],
          recommended,
          rationale: id,
        });
        const ranked = rankCandidates([
          candidate("sweeping", 0.9, 0.99, false),
          candidate("steady", 0.1, 0.6, true),
        ]);
        require(ranked[0].candidateId === "steady", `Ranking preferred ${ranked[0].candidateId}`);
        return `Ranked ${ranked.map((entry) => entry.candidateId).join(" > ")}`;
      },
    ),

    evaluate(
      "CHK-SCH-10",
      "Two versions are comparable and the difference is stated",
      "scheduling-quality.ts",
      () => {
        const from = [fixture({ id: "c1", activityId: "act-1", resources: ["r-1"] })];
        const to = [
          fixture({
            id: "c1",
            activityId: "act-1",
            resources: ["r-2"],
            start: "2026-03-02T13:00:00Z",
            end: "2026-03-02T14:00:00Z",
          }),
        ];
        const comparison = compareVersions("v1", "v2", from, to);
        require(comparison.movedActivities.includes("act-1"), "A moved activity was not reported");
        return comparison.summary;
      },
    ),

    evaluate(
      "CHK-SCH-11",
      "Impact analysis escalates what it cannot resolve automatically",
      "scheduling-quality.ts",
      () => {
        const plan = [
          fixture({ id: "c1", participants: ["p-1"] }),
          fixture({ id: "c2", participants: ["p-2"] }),
        ];
        const conflicts = detectConflicts({
          tenantId: "tenant-under-check",
          now: CHECKED_AT,
          blockedPeriods: [
            {
              id: "b-2",
              start: "2026-03-02T00:00:00Z",
              end: "2026-03-03T00:00:00Z",
              reason: "site closing",
            },
          ],
          assignments: plan,
        });
        const impact = analyseImpact("site closing", plan, conflicts);
        require(impact.escalation !== null, "A critical conflict produced no escalation");
        return `${impact.affectedActivities.length} activity(ies) affected; ${impact.escalation}`;
      },
    ),

    evaluate(
      "CHK-SCH-12",
      "A placement is explainable in terms of constraints and rejected alternatives",
      "scheduling-quality.ts",
      () => {
        const whole = fixture({ id: "c1", resources: ["r-5"], participants: ["p-1"] });
        const conflicts = detectConflicts({
          tenantId: "tenant-under-check",
          now: CHECKED_AT,
          resourceCapabilities: { "r-5": [] },
          assignments: [{ ...whole, demands: { specialised: 1 } }],
        });
        const explanation = explainPlacement(whole, conflicts, [
          { id: "r-6", reason: "already committed" },
        ]);
        require(explanation.constraintsThatDecided.length > 0 &&
          explanation.whyAlternativesRejected.length >
            0, "The explanation named no constraint and no rejected alternative");
        return `${explanation.constraintsThatDecided.length} constraint(s) named, ${explanation.selectedOver.length} alternative(s) rejected`;
      },
    ),

    evaluate(
      "CHK-SCH-13",
      "Fairness is measured from committed load, not asserted",
      "scheduling-quality.ts",
      () => {
        const balanced = balanceOf({ "p-1": 4, "p-2": 4 });
        const skewed = balanceOf({ "p-1": 0, "p-2": 8 });
        require(balanced === 1 &&
          skewed < 1, "Load balance did not distinguish equal from skewed load");
        return `balanced=${balanced.toFixed(2)}, skewed=${skewed.toFixed(2)}`;
      },
    ),
  ];
}

/**
 * Capabilities the blueprint requires that this phase does not yet hold in code. They are stated
 * openly, with an owner, because a report that hides a gap is not evidence.
 */
export const SCHEDULING_GAPS: readonly SchedulingGap[] = [
  {
    id: "GAP-SCH-01",
    statement: "No solver adapter is wired to an external optimization solver.",
    why: "The engines validate, score, rank and explain plans, and a solver can be attached behind the abstraction, but no production solver is called in this phase.",
    owner: "Phase 12 (solver adapters) with Phase 14 for job infrastructure",
  },
  {
    id: "GAP-SCH-02",
    statement:
      "Long-running optimization runs are not yet exposed as cancellable asynchronous jobs.",
    why: "Job lifecycle, progress and cancellation belong to the runtime and automation layers; the domain reports run state without owning the queue.",
    owner: "Phase 05 / Phase 17",
  },
  {
    id: "GAP-SCH-03",
    statement:
      "External calendar, HR and room-system import/export adapters are declared, not wired.",
    why: "Interoperability adapters require provider credentials and validation policy that are out of this phase's scope.",
    owner: "Phase 12 adapters with Phase 14 data platform",
  },
  {
    id: "GAP-SCH-04",
    statement: "Publication approval workflow is not implemented here.",
    why: "Phase 12 provides the validation and version a publication requires; the approval workflow itself belongs to the workflow phase.",
    owner: "Phase 17",
  },
  {
    id: "GAP-SCH-05",
    statement:
      "Daylight-saving transition rules are represented by explicit timezone fields, not by a DST rule engine.",
    why: "Interval semantics and timezones are enforced; a calendar conversion engine is a separate concern.",
    owner: "Phase 12 with the data platform",
  },
  {
    id: "GAP-SCH-06",
    statement: "Learned solver selection and adaptive constraint weighting are not implemented.",
    why: "The platform records solver behaviour as evidence; learning must remain subordinate to deterministic validation and is not wired.",
    owner: "Phase 18 analytics with Phase 12",
  },
];

export interface SchedulingIntelligenceReport {
  phase: string;
  title: string;
  generatedAt: string;
  modules: readonly string[];
  rules: readonly SchedulingRule[];
  checks: readonly SchedulingCheck[];
  gaps: readonly SchedulingGap[];
  totals: {
    rules: number;
    enforced: number;
    failed: number;
    declared: number;
    gaps: number;
    conflictTypes: number;
    scoreDimensions: number;
    resolutionStrategies: number;
  };
  summary: string;
}

/**
 * Assemble the report. The totals are computed from the live rule list, the executed checks and
 * the module constants, so the numbers cannot drift away from the code.
 */
export function buildSchedulingIntelligenceReport(
  generatedAt: string = new Date().toISOString(),
): SchedulingIntelligenceReport {
  const checks = [...runSchedulingChecks(), ...runSchedulingQualityChecks()];
  const enforced = checks.filter((check) => check.status === "ENFORCED").length;
  const failed = checks.filter((check) => check.status === "FAILED").length;
  const declared = checks.filter((check) => check.status === "DECLARED").length;

  const totals = {
    rules: SCHEDULING_RULES.length,
    enforced,
    failed,
    declared,
    gaps: SCHEDULING_GAPS.length,
    conflictTypes: CONFLICT_TYPES.length,
    scoreDimensions: SCORE_DIMENSIONS.length,
    resolutionStrategies: RESOLUTION_STRATEGIES.length,
  };

  const summary = [
    `Sherivs scheduling intelligence is exercised by ${totals.rules} rule(s) and ${checks.length} executed check(s).`,
    `${enforced} check(s) observed the enforced behaviour, ${failed} failed, ${declared} are declared only.`,
    `The conflict engine distinguishes ${totals.conflictTypes} conflict types and offers ${totals.resolutionStrategies} resolution strategies.`,
    `A plan is scored on ${totals.scoreDimensions} independent dimensions, with feasibility never traded for quality.`,
    `${totals.gaps} capability gap(s) are declared rather than implied.`,
  ].join(" ");

  return {
    phase: "12",
    title: "Scheduling & Timetable Intelligence",
    generatedAt,
    modules: ["scheduling-conflicts.ts", "scheduling-quality.ts"],
    rules: SCHEDULING_RULES,
    checks,
    gaps: SCHEDULING_GAPS,
    totals,
    summary,
  };
}
