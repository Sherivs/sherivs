/**
 * CoreGrid — Academic Learning Intelligence core domain model
 * (Phase 11).
 *
 * Implements `architecture/phase-11-academic-intelligence.md`:
 * - Learner Contract (F.1): academic intelligence consumes an authoritative
 *   learner reference; it never duplicates identity authority (Phase 02).
 * - Course Contract (F.2) and Learning Objective Contract (F.3) reference
 *   Phase 04 structures.
 * - Evidence Contract (F.5): assignments, examinations, quizzes, projects,
 *   practicals, observations, participation, approved learning interactions;
 *   every evidence record requires provenance.
 * - Evidence semantics (P, Q): distinguish observed fact from inferred state,
 *   prediction, and recommendation; provenance records source, source record,
 *   timestamp, actor, assessment, methodology, confidence.
 * - Learner profile (learner academic profile), progress state (AA):
 *   NOT_STARTED, STARTED, IN_PROGRESS, APPROACHING_MASTERY, MASTERED,
 *   NEEDS_REVIEW, BLOCKED.
 * - Academic records are highly sensitive (BP, BQ): tenant isolation,
 *   purpose limitation, data minimization are mandatory.
 * - Academic memory (AT): learner progress, competency history, assessment
 *   history, intervention history, curriculum history.
 *
 * Boundaries:
 * - D.2 tenancy: every academic entity carries a tenant ID.
 * - D.5 security enforcement is Phase 08; this module defines academic-domain
 *   requirements only.
 * - D.6 provenance infrastructure is Phase 09; this module records academic
 *   evidence provenance references.
 */

import type { TenantId } from "./tenant-core";

/* ─────────────────────────────────────────────────────────────
 * Learner reference (F.1) — never duplicates identity authority
 * ────────────────────────────────────────────────────────────*/

export interface LearnerReference {
  learnerId: string;
  tenantId: TenantId;
  /** Academic period / cohort reference (Phase 04 structure). */
  cohortId: string | null;
  /** Enrolment/course membership reference (Phase 04 structure). */
  enrolledCourseIds: string[];
}

export interface CreateLearnerReferenceInput {
  learnerId: string;
  tenantId: TenantId;
  cohortId?: string | null;
  enrolledCourseIds?: string[];
}

export type CreateLearnerReferenceResult =
  { ok: true; learner: LearnerReference } | { ok: false; error: string };

export function createLearnerReference(
  input: CreateLearnerReferenceInput,
): CreateLearnerReferenceResult {
  if (input.learnerId.trim() === "") {
    return { ok: false, error: "Learner reference requires a learner id (F.1)" };
  }
  return {
    ok: true,
    learner: {
      learnerId: input.learnerId,
      tenantId: input.tenantId,
      cohortId: input.cohortId ?? null,
      enrolledCourseIds: input.enrolledCourseIds ?? [],
    },
  };
}

/** Academic data must never cross tenant boundaries implicitly (D.2, BP). */
export function isLearnerTenantConsistent(learner: LearnerReference, tenantId: TenantId): boolean {
  return learner.tenantId === tenantId;
}

/* ─────────────────────────────────────────────────────────────
 * Learning evidence (F.5, P, Q)
 * ────────────────────────────────────────────────────────────*/

export type EvidenceKind = "observed_fact" | "inferred_state" | "prediction" | "recommendation";

export const EVIDENCE_KINDS: readonly EvidenceKind[] = [
  "observed_fact",
  "inferred_state",
  "prediction",
  "recommendation",
] as const;

export type EvidenceSource =
  | "assignment"
  | "examination"
  | "quiz"
  | "project"
  | "practical"
  | "observation"
  | "participation"
  | "learning_interaction";

export const EVIDENCE_SOURCES: readonly EvidenceSource[] = [
  "assignment",
  "examination",
  "quiz",
  "project",
  "practical",
  "observation",
  "participation",
  "learning_interaction",
] as const;

export interface LearningEvidence {
  id: string;
  tenantId: TenantId;
  learnerId: string;
  courseId: string;
  competencyId: string;
  kind: EvidenceKind;
  source: EvidenceSource;
  sourceRecordId: string;
  score: number;
  weight: number;
  observedAt: string;
  actorId: string;
  methodology: string;
  confidence: number;
  provenanceRef: string | null;
  modelVersion: string | null;
}

export interface CreateEvidenceInput {
  tenantId: TenantId;
  learnerId: string;
  courseId: string;
  competencyId: string;
  kind: EvidenceKind;
  source: EvidenceSource;
  sourceRecordId: string;
  score: number;
  weight: number;
  observedAt: string;
  actorId: string;
  methodology: string;
  confidence: number;
  provenanceRef?: string | null;
  modelVersion?: string | null;
}

export type CreateEvidenceResult =
  { ok: true; evidence: LearningEvidence } | { ok: false; error: string };

export function createLearningEvidence(input: CreateEvidenceInput): CreateEvidenceResult {
  if (input.score < 0 || input.score > 100) {
    return { ok: false, error: "Evidence score must be between 0 and 100 (F.5)" };
  }
  if (input.weight <= 0) {
    return { ok: false, error: "Evidence weight must be positive (F.5)" };
  }
  if (input.confidence < 0 || input.confidence > 1) {
    return { ok: false, error: "Evidence confidence must be between 0 and 1 (Q)" };
  }
  if (input.sourceRecordId.trim() === "") {
    return { ok: false, error: "Evidence requires a source record reference (Q)" };
  }
  return {
    ok: true,
    evidence: {
      id: `evidence-${input.learnerId}-${input.competencyId}-${input.observedAt}-${Math.random().toString(36).slice(2, 8)}`,
      tenantId: input.tenantId,
      learnerId: input.learnerId,
      courseId: input.courseId,
      competencyId: input.competencyId,
      kind: input.kind,
      source: input.source,
      sourceRecordId: input.sourceRecordId,
      score: input.score,
      weight: input.weight,
      observedAt: input.observedAt,
      actorId: input.actorId,
      methodology: input.methodology,
      confidence: input.confidence,
      provenanceRef: input.provenanceRef ?? null,
      modelVersion: input.modelVersion ?? null,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Learning progress state (AA)
 * ────────────────────────────────────────────────────────────*/

export type LearningProgressState =
  | "NOT_STARTED"
  | "STARTED"
  | "IN_PROGRESS"
  | "APPROACHING_MASTERY"
  | "MASTERED"
  | "NEEDS_REVIEW"
  | "BLOCKED";

export const LEARNING_PROGRESS_STATES: readonly LearningProgressState[] = [
  "NOT_STARTED",
  "STARTED",
  "IN_PROGRESS",
  "APPROACHING_MASTERY",
  "MASTERED",
  "NEEDS_REVIEW",
  "BLOCKED",
] as const;

export interface LearningProgress {
  learnerId: string;
  tenantId: TenantId;
  courseId: string;
  competencyId: string;
  state: LearningProgressState;
  updatedAt: string;
  modelVersion: string;
}

export interface EvaluateProgressInput {
  learnerId: string;
  tenantId: TenantId;
  courseId: string;
  competencyId: string;
  masteryEstimate: number;
  evidenceCount: number;
  hasBlockingPrerequisiteGap: boolean;
  modelVersion: string;
  now: string;
}

export interface EvaluateProgressResult {
  progress: LearningProgress;
  reason: string;
}

/**
 * Derive a learning-progress state from mastery and prerequisite context.
 * Progress is always derived from evidence; it is never asserted by an AI
 * model directly (Section AA, P).
 */
export function evaluateLearningProgress(input: EvaluateProgressInput): EvaluateProgressResult {
  let state: LearningProgressState;
  let reason: string;

  if (input.hasBlockingPrerequisiteGap) {
    state = "BLOCKED";
    reason = "Blocking prerequisite gap prevents progression";
  } else if (input.evidenceCount === 0) {
    state = "NOT_STARTED";
    reason = "No evidence observed yet";
  } else if (input.masteryEstimate >= 80) {
    state = "MASTERED";
    reason = "Mastery estimate meets the mastery threshold";
  } else if (input.masteryEstimate >= 60) {
    state = "APPROACHING_MASTERY";
    reason = "Mastery estimate approaching the mastery threshold";
  } else if (input.masteryEstimate < 40) {
    state = "NEEDS_REVIEW";
    reason = "Mastery estimate is below expectations";
  } else {
    state = "IN_PROGRESS";
    reason = "Evidence is accumulating toward mastery";
  }

  return {
    progress: {
      learnerId: input.learnerId,
      tenantId: input.tenantId,
      courseId: input.courseId,
      competencyId: input.competencyId,
      state,
      updatedAt: input.now,
      modelVersion: input.modelVersion,
    },
    reason,
  };
}
