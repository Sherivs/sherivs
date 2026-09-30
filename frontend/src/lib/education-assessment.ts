/**
 * CoreGrid — Education Reality Engine assessment engine.
 *
 * Implements `architecture/phase-04-education-reality-engine.md`:
 * - Assessment model: continuous assessment, examinations, practicals, projects,
 *   portfolios, competencies (Section 40).
 * - Grading systems are configurable (Section 41).
 * - Progression rules are configurable (Section 42).
 * - AI cannot alter authoritative grades without authorization (Section 117).
 * - Sensitive mutations must produce audit records (Section 138).
 */

import type { TenantId } from "./tenant-core";
import {
  assessmentId,
  gradingSystemId,
  type AssessmentId,
  type GradingSystemId,
  type TenantScopedEntity,
  type StudentProfileId,
  type SubjectId,
  type AcademicPeriodId,
  type EducationalAuditEvent,
} from "./education-core";

/* ─────────────────────────────────────────────────────────────
 * Grading system (Section 41)
 * ────────────────────────────────────────────────────────────*/

export interface GradeBand {
  label: string;
  minScore: number;
  maxScore: number;
  /** Optional grade point. */
  gradePoint: number | null;
  /** Optional remark. */
  remark: string | null;
}

export interface GradingSystem extends TenantScopedEntity {
  id: GradingSystemId;
  name: string;
  /** Configurable grade bands. */
  bands: GradeBand[];
  /** Whether this is the default grading system. */
  isDefault: boolean;
}

/* ─────────────────────────────────────────────────────────────
 * Assessment (Section 40)
 * ────────────────────────────────────────────────────────────*/

export type AssessmentType =
  | "continuous_assessment"
  | "examination"
  | "practical"
  | "project"
  | "portfolio"
  | "competency"
  | "oral"
  | "field_work";

export const ASSESSMENT_TYPES: readonly AssessmentType[] = [
  "continuous_assessment",
  "examination",
  "practical",
  "project",
  "portfolio",
  "competency",
  "oral",
  "field_work",
] as const;

export interface Assessment extends TenantScopedEntity {
  id: AssessmentId;
  name: string;
  type: AssessmentType;
  subjectId: SubjectId;
  academicPeriodId: AcademicPeriodId;
  gradingSystemId: GradingSystemId;
  /** Weight in the overall subject grade. */
  weight: number;
  /** Whether this assessment is currently active. */
  isActive: boolean;
}

/* ─────────────────────────────────────────────────────────────
 * Assessment result (Section 40)
 * ────────────────────────────────────────────────────────────*/

export interface AssessmentResult extends TenantScopedEntity {
  id: string;
  assessmentId: AssessmentId;
  studentProfileId: StudentProfileId;
  score: number;
  /** Grade derived from the grading system. */
  grade: string | null;
  /** Whether this result is final. */
  isFinal: boolean;
  /** Who recorded this result. */
  recordedBy: string;
  recordedAt: string;
  /** Whether this result was AI-generated (Section 117). */
  isAiGenerated: boolean;
}

/* ─────────────────────────────────────────────────────────────
 * Grade recording (Section 117)
 * ────────────────────────────────────────────────────────────*/

export interface RecordGradeInput {
  tenantId: TenantId;
  assessmentId: AssessmentId;
  studentProfileId: StudentProfileId;
  score: number;
  gradingSystem: GradingSystem;
  recordedBy: string;
  isAiGenerated: boolean;
}

export type RecordGradeResult =
  | { ok: true; result: AssessmentResult; auditEvent: EducationalAuditEvent }
  | { ok: false; error: string };

export function recordGrade(input: RecordGradeInput, now: string): RecordGradeResult {
  // AI cannot alter authoritative grades without authorization (Section 117).
  if (input.isAiGenerated) {
    return { ok: false, error: "AI cannot record authoritative grades" };
  }

  // Score must be within the grading system's range.
  const minScore = Math.min(...input.gradingSystem.bands.map((b) => b.minScore));
  const maxScore = Math.max(...input.gradingSystem.bands.map((b) => b.maxScore));

  if (input.score < minScore || input.score > maxScore) {
    return {
      ok: false,
      error: `Score ${input.score} is outside the grading range ${minScore}-${maxScore}`,
    };
  }

  // Determine the grade band.
  const band = input.gradingSystem.bands.find(
    (b) => input.score >= b.minScore && input.score <= b.maxScore,
  );

  const result: AssessmentResult = {
    id: `result-${input.tenantId}-${input.assessmentId}-${input.studentProfileId}`,
    tenantId: input.tenantId,
    assessmentId: input.assessmentId,
    studentProfileId: input.studentProfileId,
    score: input.score,
    grade: band ? band.label : null,
    isFinal: true,
    recordedBy: input.recordedBy,
    recordedAt: now,
    isAiGenerated: false,
    createdAt: now,
    updatedAt: now,
  };

  const auditEvent: EducationalAuditEvent = {
    id: `audit-${now}-${result.id}`,
    type: "GradeChanged",
    tenantId: input.tenantId,
    actorId: input.recordedBy,
    occurredAt: now,
    entityType: "AssessmentResult",
    entityId: result.id,
    result: "success",
    metadata: {
      assessmentId: input.assessmentId,
      studentProfileId: input.studentProfileId,
      score: input.score,
      grade: result.grade,
    },
  };

  return { ok: true, result, auditEvent };
}

/* ─────────────────────────────────────────────────────────────
 * Progression (Section 42)
 * ────────────────────────────────────────────────────────────*/

export type ProgressionDecision =
  "promoted" | "retained" | "conditional" | "graduated" | "referred";

export const PROGRESSION_DECISIONS: readonly ProgressionDecision[] = [
  "promoted",
  "retained",
  "conditional",
  "graduated",
  "referred",
] as const;

export interface ProgressionRecord extends TenantScopedEntity {
  id: string;
  studentProfileId: StudentProfileId;
  fromLevelId: string;
  toLevelId: string | null;
  academicPeriodId: AcademicPeriodId;
  decision: ProgressionDecision;
  /** Reason for the decision. */
  reason: string;
  /** Who made the decision. */
  decidedBy: string;
  decidedAt: string;
}

export interface MakeProgressionDecisionInput {
  tenantId: TenantId;
  studentProfileId: StudentProfileId;
  fromLevelId: string;
  toLevelId: string | null;
  academicPeriodId: AcademicPeriodId;
  decision: ProgressionDecision;
  reason: string;
  decidedBy: string;
}

export type MakeProgressionDecisionResult =
  | { ok: true; record: ProgressionRecord; auditEvent: EducationalAuditEvent }
  | { ok: false; error: string };

export function makeProgressionDecision(
  input: MakeProgressionDecisionInput,
  now: string,
): MakeProgressionDecisionResult {
  if (input.reason.trim() === "") {
    return { ok: false, error: "Progression decision requires a reason" };
  }

  // A promoted/graduated student must have a target level.
  if (
    (input.decision === "promoted" || input.decision === "graduated") &&
    input.toLevelId === null
  ) {
    return { ok: false, error: "Promotion/graduation requires a target level" };
  }

  const record: ProgressionRecord = {
    id: `prog-${input.tenantId}-${input.studentProfileId}-${now}`,
    tenantId: input.tenantId,
    studentProfileId: input.studentProfileId,
    fromLevelId: input.fromLevelId,
    toLevelId: input.toLevelId,
    academicPeriodId: input.academicPeriodId,
    decision: input.decision,
    reason: input.reason,
    decidedBy: input.decidedBy,
    decidedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  const auditEvent: EducationalAuditEvent = {
    id: `audit-${now}-${record.id}`,
    type: "PromotionDecision",
    tenantId: input.tenantId,
    actorId: input.decidedBy,
    occurredAt: now,
    entityType: "ProgressionRecord",
    entityId: record.id,
    result: "success",
    metadata: {
      studentProfileId: input.studentProfileId,
      fromLevelId: input.fromLevelId,
      toLevelId: input.toLevelId,
      decision: input.decision,
    },
  };

  return { ok: true, record, auditEvent };
}

/* ─────────────────────────────────────────────────────────────
 * Grading system validation
 * ────────────────────────────────────────────────────────────*/

export function validateGradingSystem(system: GradingSystem): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (system.name.trim() === "") {
    errors.push("Grading system name is required");
  }

  if (system.bands.length === 0) {
    errors.push("Grading system must have at least one band");
  }

  // Bands must not overlap.
  for (let i = 0; i < system.bands.length; i++) {
    for (let j = i + 1; j < system.bands.length; j++) {
      const a = system.bands[i];
      const b = system.bands[j];
      if (a.minScore <= b.maxScore && b.minScore <= a.maxScore) {
        errors.push(`Grade bands ${a.label} and ${b.label} overlap`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
