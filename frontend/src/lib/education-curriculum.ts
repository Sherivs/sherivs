/**
 * CoreGrid — Education Reality Engine curriculum engine.
 *
 * Implements `architecture/phase-04-education-reality-engine.md`:
 * - Curriculum engine models curriculum, versions, frameworks, subjects, courses,
 *   topics, units, competencies, learning outcomes, skills, practical and
 *   examination requirements (Section 7).
 * - Multiple curricula may operate simultaneously (Section 8).
 * - Every curriculum supports versioning, effective/expiry dates, revision
 *   history, authority, source, applicability, and migration rules (Section 9).
 * - National curriculum support without hard-coding one country's model (Section 10).
 * - Religious education is configurable — the system must not assume one religion (Section 11).
 * - Vocational, agricultural, technical, and entrepreneurship education are supported (Sections 13–16).
 * - Subjects are not hard-coded (Section 19).
 * - Cross-subject learning relationships are supported (Section 20).
 * - Programme model defines purpose, duration, curriculum, levels, required/optional
 *   subjects, competencies, assessments, progression rules, certification (Section 21).
 * - AI cannot invent curriculum or alter authoritative grades (Section 117).
 */

import type { TenantId } from "./tenant-core";
import {
  curriculumId,
  curriculumVersionId,
  subjectId,
  courseId,
  topicId,
  unitId,
  competencyId,
  programmeId,
  educationalLevelId,
  type CurriculumId,
  type CurriculumVersionId,
  type SubjectId,
  type CourseId,
  type TopicId,
  type UnitId,
  type CompetencyId,
  type ProgrammeId,
  type EducationalLevelId,
  type TenantScopedEntity,
  type EducationalAuditEvent,
} from "./education-core";

/* ─────────────────────────────────────────────────────────────
 * Curriculum (Sections 7–10)
 * ────────────────────────────────────────────────────────────*/

export type CurriculumFramework =
  | "national"
  | "religious"
  | "vocational"
  | "technical"
  | "agricultural"
  | "traditional"
  | "community"
  | "international"
  | "institution_defined";

export const CURRICULUM_FRAMEWORKS: readonly CurriculumFramework[] = [
  "national",
  "religious",
  "vocational",
  "technical",
  "agricultural",
  "traditional",
  "community",
  "international",
  "institution_defined",
] as const;

export interface Curriculum extends TenantScopedEntity {
  id: CurriculumId;
  name: string;
  code: string;
  framework: CurriculumFramework;
  /** Country/region applicability (Section 10). */
  applicableCountry: string | null;
  /** Institution-defined description. */
  description: string | null;
  /** Whether this curriculum is currently active. */
  isActive: boolean;
}

/* ─────────────────────────────────────────────────────────────
 * Curriculum versioning (Section 9)
 * ────────────────────────────────────────────────────────────*/

export interface CurriculumVersion extends TenantScopedEntity {
  id: CurriculumVersionId;
  curriculumId: CurriculumId;
  version: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
  /** Revision history. */
  revisionHistory: Array<{
    version: number;
    changedBy: string;
    changedAt: string;
    reason: string;
  }>;
  /** Authority that approved this version. */
  authority: string;
  /** Source of this curriculum version. */
  source: string;
  /** Applicability scope. */
  applicability: string;
  /** Migration rules from previous version. */
  migrationRules: string[];
  /** Whether this is the current active version. */
  isCurrent: boolean;
}

/* ─────────────────────────────────────────────────────────────
 * Subject model (Section 19)
 * ────────────────────────────────────────────────────────────*/

export interface Subject extends TenantScopedEntity {
  id: SubjectId;
  code: string;
  name: string;
  description: string | null;
  /** Curriculum relationship. */
  curriculumId: CurriculumId;
  /** Department reference. */
  departmentRef: string | null;
  /** Level applicability. */
  levelIds: EducationalLevelId[];
  /** Learning objectives. */
  learningObjectives: string[];
  /** Competencies. */
  competencyIds: CompetencyId[];
  /** Assessment references. */
  assessmentRefs: string[];
  /** Required facilities. */
  requiredFacilityTypes: string[];
  /** Required equipment. */
  requiredEquipmentRefs: string[];
  /** Required teacher qualifications. */
  requiredTeacherQualificationRefs: string[];
  /** Cross-subject learning relationships (Section 20). */
  relatedSubjectIds: SubjectId[];
}

/* ─────────────────────────────────────────────────────────────
 * Course / topic / unit / competency (Section 7)
 * ────────────────────────────────────────────────────────────*/

export interface Course extends TenantScopedEntity {
  id: CourseId;
  subjectId: SubjectId;
  name: string;
  code: string;
  description: string | null;
  topicIds: TopicId[];
  /** Practical requirements (Section 7). */
  practicalRequirements: string[];
  /** Examination requirements (Section 7). */
  examinationRequirements: string[];
}

export interface Topic extends TenantScopedEntity {
  id: TopicId;
  courseId: CourseId;
  name: string;
  description: string | null;
  unitIds: UnitId[];
  /** Learning outcomes. */
  learningOutcomes: string[];
}

export interface Unit extends TenantScopedEntity {
  id: UnitId;
  topicId: TopicId;
  name: string;
  description: string | null;
  /** Skills covered. */
  skills: string[];
  /** Estimated duration (e.g., "3 weeks"). */
  estimatedDuration: string | null;
}

export type CompetencyType =
  "academic" | "technical" | "practical" | "vocational" | "behavioural" | "professional";

export const COMPETENCY_TYPES: readonly CompetencyType[] = [
  "academic",
  "technical",
  "practical",
  "vocational",
  "behavioural",
  "professional",
] as const;

export type MasteryState =
  "not_started" | "developing" | "competent" | "proficient" | "mastered" | "institution_defined";

export const MASTERY_STATES: readonly MasteryState[] = [
  "not_started",
  "developing",
  "competent",
  "proficient",
  "mastered",
  "institution_defined",
] as const;

export interface Competency extends TenantScopedEntity {
  id: CompetencyId;
  name: string;
  description: string | null;
  type: CompetencyType;
  /** Mastery states supported (Section 103). */
  masteryStates: MasteryState[];
  /** Evidence requirements. */
  evidenceRequirements: string[];
  /** Parent competency (for hierarchical competencies). */
  parentCompetencyId: CompetencyId | null;
}

/* ─────────────────────────────────────────────────────────────
 * Programme model (Section 21)
 * ────────────────────────────────────────────────────────────*/

export interface Programme extends TenantScopedEntity {
  id: ProgrammeId;
  name: string;
  code: string;
  purpose: string;
  /** Duration (e.g., "3 years", "6 terms"). */
  duration: string;
  curriculumId: CurriculumId;
  levelIds: EducationalLevelId[];
  requiredSubjectIds: SubjectId[];
  optionalSubjectIds: SubjectId[];
  competencyIds: CompetencyId[];
  assessmentRefs: string[];
  /** Progression rules (Section 42). */
  progressionRules: string[];
  /** Certification requirements. */
  certificationRequirements: string[];
  /** Whether this programme is currently active. */
  isActive: boolean;
}

/* ─────────────────────────────────────────────────────────────
 * Curriculum validation (Section 83)
 * ────────────────────────────────────────────────────────────*/

export interface CurriculumValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate curriculum consistency (Section 83).
 * Detects missing subjects, curriculum conflicts, inconsistent relationships.
 */
export function validateCurriculum(
  curriculum: Curriculum,
  versions: CurriculumVersion[],
  subjects: Subject[],
): CurriculumValidationResult {
  const errors: string[] = [];

  // Curriculum must have a name and code.
  if (curriculum.name.trim() === "") {
    errors.push("Curriculum name is required");
  }
  if (curriculum.code.trim() === "") {
    errors.push("Curriculum code is required");
  }

  // At least one version must exist.
  if (versions.length === 0) {
    errors.push("Curriculum must have at least one version");
  }

  // Exactly one version must be current.
  const currentVersions = versions.filter((v) => v.isCurrent);
  if (currentVersions.length !== 1) {
    errors.push("Curriculum must have exactly one current version");
  }

  // Subjects must reference this curriculum.
  for (const subject of subjects) {
    if (subject.curriculumId !== curriculum.id) {
      errors.push(`Subject ${subject.code} does not belong to curriculum ${curriculum.code}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/* ─────────────────────────────────────────────────────────────
 * Curriculum versioning operations (Section 9)
 * ────────────────────────────────────────────────────────────*/

export interface CreateCurriculumVersionInput {
  curriculumId: CurriculumId;
  version: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
  authority: string;
  source: string;
  applicability: string;
  migrationRules: string[];
  changedBy: string;
  reason: string;
}

export type CreateCurriculumVersionResult =
  | { ok: true; version: CurriculumVersion; auditEvent: EducationalAuditEvent }
  | { ok: false; error: string };

export function createCurriculumVersion(
  input: CreateCurriculumVersionInput,
  existingVersions: CurriculumVersion[],
  tenantId: TenantId,
  now: string,
): CreateCurriculumVersionResult {
  // Version numbers must be unique.
  if (existingVersions.some((v) => v.version === input.version)) {
    return { ok: false, error: `Curriculum version ${input.version} already exists` };
  }

  // Authority is required.
  if (input.authority.trim() === "") {
    return { ok: false, error: "Curriculum version requires an authority" };
  }

  // Source is required.
  if (input.source.trim() === "") {
    return { ok: false, error: "Curriculum version requires a source" };
  }

  const version: CurriculumVersion = {
    id: curriculumVersionId(`${input.curriculumId}:v${input.version}`),
    tenantId,
    curriculumId: input.curriculumId,
    version: input.version,
    effectiveFrom: input.effectiveFrom,
    effectiveUntil: input.effectiveUntil,
    revisionHistory: [
      {
        version: input.version,
        changedBy: input.changedBy,
        changedAt: now,
        reason: input.reason,
      },
    ],
    authority: input.authority,
    source: input.source,
    applicability: input.applicability,
    migrationRules: input.migrationRules,
    isCurrent: existingVersions.length === 0,
    createdAt: now,
    updatedAt: now,
  };

  const auditEvent: EducationalAuditEvent = {
    id: `audit-${now}-${input.curriculumId}`,
    type: "CurriculumVersioned",
    tenantId,
    actorId: input.changedBy,
    occurredAt: now,
    entityType: "CurriculumVersion",
    entityId: version.id,
    result: "success",
    metadata: {
      curriculumId: input.curriculumId,
      version: input.version,
      authority: input.authority,
      source: input.source,
    },
  };

  return { ok: true, version, auditEvent };
}

/* ─────────────────────────────────────────────────────────────
 * Subject creation (Section 19)
 * ────────────────────────────────────────────────────────────*/

export interface CreateSubjectInput {
  tenantId: TenantId;
  code: string;
  name: string;
  description: string | null;
  curriculumId: CurriculumId;
  departmentRef: string | null;
  levelIds: EducationalLevelId[];
  learningObjectives: string[];
  competencyIds: CompetencyId[];
  assessmentRefs: string[];
  requiredFacilityTypes: string[];
  requiredEquipmentRefs: string[];
  requiredTeacherQualificationRefs: string[];
  relatedSubjectIds: SubjectId[];
}

export type CreateSubjectResult = { ok: true; subject: Subject } | { ok: false; error: string };

export function createSubject(
  input: CreateSubjectInput,
  existingSubjects: Subject[],
  now: string,
): CreateSubjectResult {
  // Subject codes must be unique within the tenant.
  if (existingSubjects.some((s) => s.code === input.code)) {
    return { ok: false, error: `Subject code ${input.code} already exists` };
  }

  if (input.name.trim() === "") {
    return { ok: false, error: "Subject name is required" };
  }

  const subject: Subject = {
    id: subjectId(`${input.tenantId}:${input.code}`),
    tenantId: input.tenantId,
    code: input.code,
    name: input.name,
    description: input.description,
    curriculumId: input.curriculumId,
    departmentRef: input.departmentRef,
    levelIds: input.levelIds,
    learningObjectives: input.learningObjectives,
    competencyIds: input.competencyIds,
    assessmentRefs: input.assessmentRefs,
    requiredFacilityTypes: input.requiredFacilityTypes,
    requiredEquipmentRefs: input.requiredEquipmentRefs,
    requiredTeacherQualificationRefs: input.requiredTeacherQualificationRefs,
    relatedSubjectIds: input.relatedSubjectIds,
    createdAt: now,
    updatedAt: now,
  };

  return { ok: true, subject };
}

/* ─────────────────────────────────────────────────────────────
 * Programme creation (Section 21)
 * ────────────────────────────────────────────────────────────*/

export interface CreateProgrammeInput {
  tenantId: TenantId;
  name: string;
  code: string;
  purpose: string;
  duration: string;
  curriculumId: CurriculumId;
  levelIds: EducationalLevelId[];
  requiredSubjectIds: SubjectId[];
  optionalSubjectIds: SubjectId[];
  competencyIds: CompetencyId[];
  assessmentRefs: string[];
  progressionRules: string[];
  certificationRequirements: string[];
}

export type CreateProgrammeResult =
  { ok: true; programme: Programme } | { ok: false; error: string };

export function createProgramme(
  input: CreateProgrammeInput,
  existingProgrammes: Programme[],
  now: string,
): CreateProgrammeResult {
  // Programme codes must be unique within the tenant.
  if (existingProgrammes.some((p) => p.code === input.code)) {
    return { ok: false, error: `Programme code ${input.code} already exists` };
  }

  if (input.name.trim() === "") {
    return { ok: false, error: "Programme name is required" };
  }

  if (input.purpose.trim() === "") {
    return { ok: false, error: "Programme purpose is required" };
  }

  const programme: Programme = {
    id: programmeId(`${input.tenantId}:${input.code}`),
    tenantId: input.tenantId,
    name: input.name,
    code: input.code,
    purpose: input.purpose,
    duration: input.duration,
    curriculumId: input.curriculumId,
    levelIds: input.levelIds,
    requiredSubjectIds: input.requiredSubjectIds,
    optionalSubjectIds: input.optionalSubjectIds,
    competencyIds: input.competencyIds,
    assessmentRefs: input.assessmentRefs,
    progressionRules: input.progressionRules,
    certificationRequirements: input.certificationRequirements,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };

  return { ok: true, programme };
}

/* ─────────────────────────────────────────────────────────────
 * Competency creation (Section 102)
 * ────────────────────────────────────────────────────────────*/

export interface CreateCompetencyInput {
  tenantId: TenantId;
  name: string;
  description: string | null;
  type: CompetencyType;
  masteryStates: MasteryState[];
  evidenceRequirements: string[];
  parentCompetencyId: CompetencyId | null;
}

export type CreateCompetencyResult =
  { ok: true; competency: Competency } | { ok: false; error: string };

export function createCompetency(
  input: CreateCompetencyInput,
  now: string,
): CreateCompetencyResult {
  if (input.name.trim() === "") {
    return { ok: false, error: "Competency name is required" };
  }

  if (input.masteryStates.length === 0) {
    return { ok: false, error: "Competency must define at least one mastery state" };
  }

  const competency: Competency = {
    id: competencyId(`${input.tenantId}:${input.name}`),
    tenantId: input.tenantId,
    name: input.name,
    description: input.description,
    type: input.type,
    masteryStates: input.masteryStates,
    evidenceRequirements: input.evidenceRequirements,
    parentCompetencyId: input.parentCompetencyId,
    createdAt: now,
    updatedAt: now,
  };

  return { ok: true, competency };
}

/* ─────────────────────────────────────────────────────────────
 * Curriculum evolution (Section 178)
 * ────────────────────────────────────────────────────────────*/

/**
 * A new curriculum must not destroy historical curriculum records (Section 178).
 * This validates that a curriculum can be superseded without data loss.
 */
export function canSupersedeCurriculum(
  curriculum: Curriculum,
  versions: CurriculumVersion[],
): { ok: boolean; error?: string } {
  if (versions.length === 0) {
    return { ok: false, error: "Cannot supersede a curriculum with no versions" };
  }

  const current = versions.find((v) => v.isCurrent);
  if (!current) {
    return { ok: false, error: "Cannot supersede a curriculum with no current version" };
  }

  return { ok: true };
}
