/**
 * CoreGrid — Academic Learning Intelligence prerequisite engine,
 * learning-gap engine, and intervention lifecycle (Phase 11, Sections AD,
 * AE, AF, AG, AH, AB).
 *
 * Implements `architecture/phase-11-academic-intelligence.md`:
 * - Prerequisite Engine (AD): determines whether required knowledge exists
 *   before recommending advanced content; supports direct prerequisites,
 *   transitive prerequisites, alternative prerequisites, and prerequisite
 *   exceptions.
 * - Learning Gap Engine (AE): a learning gap is a meaningful difference
 *   between expected competency, observed evidence, and estimated mastery.
 *   The system identifies missing prerequisites, weak competencies,
 *   incomplete objectives, inconsistent performance, and assessment
 *   weakness.
 * - Intervention Intelligence (AF): recommends interventions — practice,
 *   remediation, tutoring, alternative resources, teacher review, peer
 *   support, assessment retake where institutionally permitted. The engine
 *   recommends interventions; it does not impose disciplinary action.
 * - Intervention Lifecycle (AG): DETECTED -> ANALYZED -> RECOMMENDED ->
 *   REVIEWED -> ASSIGNED -> ACTIVE -> EVALUATED -> RESOLVED.
 * - Intervention Evaluation (AH): measures whether the intervention
 *   improved mastery, engagement, completion, assessment performance, or
 *   learning progression.
 * - Learning Pathway Engine (AB): possible sequences of educational
 *   experiences using prerequisites, competencies, objectives, learner
 *   mastery, curriculum requirements, and available resources.
 *
 * Boundary: interventions are recommendations; assignment and enforcement
 * remain governed by institutional policy and Phase 08 authorization.
 */

import type { TenantId } from "./tenant-core";

/* ─────────────────────────────────────────────────────────────
 * Prerequisite engine (AD)
 * ────────────────────────────────────────────────────────────*/

export interface PrerequisiteEdge {
  id: string;
  /** The competency/objective that must be satisfied first. */
  prerequisiteId: string;
  /** The competency/objective that depends on the prerequisite. */
  dependentId: string;
  /** Alternative prerequisites form an OR group via this key. */
  alternativeGroupId: string | null;
  isException: boolean;
  tenantId: TenantId;
}

export interface CreatePrerequisiteEdgeInput {
  id: string;
  prerequisiteId: string;
  dependentId: string;
  alternativeGroupId?: string | null;
  isException?: boolean;
  tenantId: TenantId;
}

export type CreatePrerequisiteEdgeResult =
  { ok: true; edge: PrerequisiteEdge } | { ok: false; error: string };

export function createPrerequisiteEdge(
  input: CreatePrerequisiteEdgeInput,
): CreatePrerequisiteEdgeResult {
  if (input.prerequisiteId === input.dependentId) {
    return { ok: false, error: "A competency cannot be its own prerequisite (AD)" };
  }
  return {
    ok: true,
    edge: {
      id: input.id,
      prerequisiteId: input.prerequisiteId,
      dependentId: input.dependentId,
      alternativeGroupId: input.alternativeGroupId ?? null,
      isException: input.isException ?? false,
      tenantId: input.tenantId,
    },
  };
}

export interface PrerequisiteResolutionInput {
  competencyId: string;
  edges: PrerequisiteEdge[];
  /** Competency ids the learner has already mastered/satisfied. */
  satisfiedIds: string[];
}

export type PrerequisiteResolutionResult =
  | { ok: true; satisfied: boolean; missing: string[]; reason: string }
  | { ok: false; error: string };

/**
 * Resolve whether a learner satisfies the prerequisites for a competency
 * (AD). Supports:
 * - direct prerequisites (edges where dependentId === competencyId),
 * - transitive prerequisites (DFS over the graph),
 * - alternative prerequisites (same alternativeGroupId => OR group),
 * - exceptions (edge.isException exempts the learner).
 * Cycle-safe via a visited set.
 */
export function resolvePrerequisites(
  input: PrerequisiteResolutionInput,
): PrerequisiteResolutionResult {
  if (input.edges.length > 0 && input.edges.some((e) => e.tenantId !== input.edges[0].tenantId)) {
    return { ok: false, error: "Prerequisite edges must belong to a single tenant" };
  }

  const missing: string[] = [];
  const initiallySatisfied = new Set<string>(input.satisfiedIds);

  // DFS returns whether `competencyId` is satisfied. `path` is the cycle
  // guard: a node already on the current path is treated as not satisfied
  // (a cyclic prerequisite can never be resolved without a satisfied base).
  const visit = (competencyId: string, path: Set<string>): boolean => {
    if (initiallySatisfied.has(competencyId)) return true;
    if (path.has(competencyId)) return false;
    path.add(competencyId);

    const direct = input.edges.filter((e) => e.dependentId === competencyId);
    if (direct.length === 0) {
      // A leaf node with no incoming requirement edges has no dependencies
      // of its own; it is satisfied only if it was in the satisfied set
      // (handled above) — otherwise it is missing.
      path.delete(competencyId);
      if (!initiallySatisfied.has(competencyId)) {
        missing.push(competencyId);
      }
      return initiallySatisfied.has(competencyId);
    }

    const groups = new Map<string, PrerequisiteEdge[]>();
    const plain: PrerequisiteEdge[] = [];
    for (const edge of direct) {
      if (edge.isException) continue; // exceptions exempt the requirement (AD)
      if (edge.alternativeGroupId) {
        const list = groups.get(edge.alternativeGroupId) ?? [];
        list.push(edge);
        groups.set(edge.alternativeGroupId, list);
      } else {
        plain.push(edge);
      }
    }

    // Every OR-group must have at least one satisfied member.
    for (const [groupId, groupEdges] of groups) {
      const groupSatisfied = groupEdges.some((e) => visit(e.prerequisiteId, path));
      if (!groupSatisfied) {
        missing.push(`alt:${groupId}`);
      }
    }

    // Every plain prerequisite must be satisfied (directly or transitively).
    const plainSatisfiedResults: boolean[] = [];
    for (const edge of plain) {
      const satisfiedHere = visit(edge.prerequisiteId, path);
      plainSatisfiedResults.push(satisfiedHere);
      if (!satisfiedHere) {
        missing.push(edge.prerequisiteId);
      }
    }

    path.delete(competencyId);
    const allGroupsSatisfied = [...groups.keys()].every(
      (groupId) => !missing.includes(`alt:${groupId}`),
    );
    const allPlainSatisfied = plainSatisfiedResults.every(Boolean);
    return allGroupsSatisfied && allPlainSatisfied;
  };

  // Determine satisfaction of the requested competency.
  const satisfied = visit(input.competencyId, new Set<string>());

  return {
    ok: true,
    satisfied,
    missing: [...new Set(missing)],
    reason: satisfied
      ? "All prerequisites satisfied"
      : `Missing prerequisites: ${missing.join(", ")}`,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Learning gap engine (AE)
 * ────────────────────────────────────────────────────────────*/

export type LearningGapType =
  | "missing_prerequisite"
  | "weak_competency"
  | "incomplete_objective"
  | "inconsistent_performance"
  | "assessment_weakness";

export const LEARNING_GAP_TYPES: readonly LearningGapType[] = [
  "missing_prerequisite",
  "weak_competency",
  "incomplete_objective",
  "inconsistent_performance",
  "assessment_weakness",
] as const;

export interface LearningGap {
  id: string;
  learnerId: string;
  tenantId: TenantId;
  competencyId: string;
  type: LearningGapType;
  severity: "low" | "medium" | "high";
  detail: string;
  detectedAt: string;
}

export interface DetectGapsInput {
  learnerId: string;
  tenantId: TenantId;
  competencyId: string;
  masteryEstimate: number;
  evidenceCount: number;
  expectedLevel: number;
  missingPrerequisiteIds: string[];
  hasInconsistentPerformance: boolean;
  weakAssessmentSource: string | null;
  now: string;
}

export interface DetectGapsResult {
  gaps: LearningGap[];
}

/**
 * Detect learning gaps (AE): a gap is a meaningful difference between the
 * expected competency level and the learner's observed evidence/estimated
 * mastery.
 */
export function detectLearningGaps(input: DetectGapsInput): DetectGapsResult {
  const gaps: LearningGap[] = [];

  for (const prereqId of input.missingPrerequisiteIds) {
    gaps.push({
      id: `gap-${input.learnerId}-${input.competencyId}-prereq-${prereqId}`,
      learnerId: input.learnerId,
      tenantId: input.tenantId,
      competencyId: input.competencyId,
      type: "missing_prerequisite",
      severity: "high",
      detail: `Missing prerequisite: ${prereqId}`,
      detectedAt: input.now,
    });
  }

  if (input.evidenceCount > 0 && input.masteryEstimate < input.expectedLevel - 15) {
    gaps.push({
      id: `gap-${input.learnerId}-${input.competencyId}-weak`,
      learnerId: input.learnerId,
      tenantId: input.tenantId,
      competencyId: input.competencyId,
      type: "weak_competency",
      severity: input.masteryEstimate < 40 ? "high" : "medium",
      detail: `Estimated mastery (${input.masteryEstimate}) is below expected (${input.expectedLevel})`,
      detectedAt: input.now,
    });
  }

  if (input.evidenceCount === 0) {
    gaps.push({
      id: `gap-${input.learnerId}-${input.competencyId}-incomplete`,
      learnerId: input.learnerId,
      tenantId: input.tenantId,
      competencyId: input.competencyId,
      type: "incomplete_objective",
      severity: "low",
      detail: "No evidence observed for this objective",
      detectedAt: input.now,
    });
  }

  if (input.hasInconsistentPerformance) {
    gaps.push({
      id: `gap-${input.learnerId}-${input.competencyId}-inconsistent`,
      learnerId: input.learnerId,
      tenantId: input.tenantId,
      competencyId: input.competencyId,
      type: "inconsistent_performance",
      severity: "medium",
      detail: "Performance varies significantly across evidence",
      detectedAt: input.now,
    });
  }

  if (input.weakAssessmentSource !== null) {
    gaps.push({
      id: `gap-${input.learnerId}-${input.competencyId}-assessment`,
      learnerId: input.learnerId,
      tenantId: input.tenantId,
      competencyId: input.competencyId,
      type: "assessment_weakness",
      severity: "medium",
      detail: `Weak assessment evidence from ${input.weakAssessmentSource}`,
      detectedAt: input.now,
    });
  }

  return { gaps };
}

/* ─────────────────────────────────────────────────────────────
 * Intervention intelligence and lifecycle (AF, AG, AH)
 * ────────────────────────────────────────────────────────────*/

export type InterventionType =
  | "additional_practice"
  | "remediation"
  | "tutoring"
  | "alternative_resources"
  | "teacher_review"
  | "peer_support"
  | "assessment_retake";

export const INTERVENTION_TYPES: readonly InterventionType[] = [
  "additional_practice",
  "remediation",
  "tutoring",
  "alternative_resources",
  "teacher_review",
  "peer_support",
  "assessment_retake",
] as const;

export type InterventionState =
  | "DETECTED"
  | "ANALYZED"
  | "RECOMMENDED"
  | "REVIEWED"
  | "ASSIGNED"
  | "ACTIVE"
  | "EVALUATED"
  | "RESOLVED";

export const INTERVENTION_STATES: readonly InterventionState[] = [
  "DETECTED",
  "ANALYZED",
  "RECOMMENDED",
  "REVIEWED",
  "ASSIGNED",
  "ACTIVE",
  "EVALUATED",
  "RESOLVED",
] as const;

const INTERVENTION_TRANSITIONS: Readonly<Record<InterventionState, readonly InterventionState[]>> =
  {
    DETECTED: ["ANALYZED"],
    ANALYZED: ["RECOMMENDED"],
    RECOMMENDED: ["REVIEWED", "ANALYZED"],
    REVIEWED: ["ASSIGNED", "ANALYZED"],
    ASSIGNED: ["ACTIVE"],
    ACTIVE: ["EVALUATED"],
    EVALUATED: ["RESOLVED"],
    RESOLVED: [],
  };

export function isInterventionTransitionAllowed(
  from: InterventionState,
  to: InterventionState,
): boolean {
  return INTERVENTION_TRANSITIONS[from].includes(to);
}

export interface Intervention {
  id: string;
  learnerId: string;
  tenantId: TenantId;
  competencyId: string;
  type: InterventionType;
  state: InterventionState;
  reason: string;
  evidenceRefs: string[];
  assignedBy: string | null;
  outcome: InterventionOutcome | null;
  createdAt: string;
  updatedAt: string;
}

export interface InterventionOutcome {
  masteryBefore: number;
  masteryAfter: number;
  improvement: boolean;
  evaluatedAt: string;
}

export interface RecommendInterventionInput {
  id: string;
  learnerId: string;
  tenantId: TenantId;
  competencyId: string;
  type: InterventionType;
  reason: string;
  evidenceRefs: string[];
  now: string;
}

export type RecommendInterventionResult =
  { ok: true; intervention: Intervention } | { ok: false; error: string };

export function recommendIntervention(
  input: RecommendInterventionInput,
): RecommendInterventionResult {
  if (input.type === "assessment_retake") {
    return { ok: false, error: "Assessment retake requires institutional permission (AF)" };
  }
  if (input.reason.trim() === "") {
    return { ok: false, error: "Intervention recommendation requires a reason (AF)" };
  }
  return {
    ok: true,
    intervention: {
      id: input.id,
      learnerId: input.learnerId,
      tenantId: input.tenantId,
      competencyId: input.competencyId,
      type: input.type,
      state: "DETECTED",
      reason: input.reason,
      evidenceRefs: input.evidenceRefs,
      assignedBy: null,
      outcome: null,
      createdAt: input.now,
      updatedAt: input.now,
    },
  };
}

export function transitionIntervention(
  intervention: Intervention,
  to: InterventionState,
  now: string,
): { ok: true; intervention: Intervention } | { ok: false; error: string } {
  if (!isInterventionTransitionAllowed(intervention.state, to)) {
    return {
      ok: false,
      error: `Intervention transition ${intervention.state} -> ${to} is not allowed (AG)`,
    };
  }
  return { ok: true, intervention: { ...intervention, state: to, updatedAt: now } };
}

export function assignIntervention(
  intervention: Intervention,
  assignedBy: string,
  now: string,
): { ok: true; intervention: Intervention } | { ok: false; error: string } {
  if (intervention.state !== "REVIEWED") {
    return { ok: false, error: "Intervention must be reviewed before assignment (AG)" };
  }
  return {
    ok: true,
    intervention: { ...intervention, state: "ASSIGNED", assignedBy, updatedAt: now },
  };
}

export function evaluateIntervention(
  intervention: Intervention,
  masteryBefore: number,
  masteryAfter: number,
  now: string,
): { ok: true; intervention: Intervention } | { ok: false; error: string } {
  if (intervention.state !== "ACTIVE") {
    return { ok: false, error: "Only an active intervention can be evaluated (AH)" };
  }
  return {
    ok: true,
    intervention: {
      ...intervention,
      state: "EVALUATED",
      outcome: {
        masteryBefore,
        masteryAfter,
        improvement: masteryAfter > masteryBefore,
        evaluatedAt: now,
      },
      updatedAt: now,
    },
  };
}
