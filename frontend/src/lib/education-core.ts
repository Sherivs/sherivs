/**
 * CoreGrid — Education Reality Engine core domain model.
 *
 * Implements `architecture/phase-04-education-reality-engine.md`:
 * - Configuration-driven, policy-driven, context-driven, relationship-driven, AI-native (Section 2).
 * - Africa-first: no hidden Western defaults (Section 3).
 * - Every educational entity must resolve to the correct tenant (Section 134).
 * - Sensitive educational data must be purpose-limited (Section 136).
 * - Student information requires heightened protection (Section 137).
 * - Sensitive mutations must produce audit records (Section 138).
 * - AI is not the system of record (Section 146).
 * - Phase 04 owns the semantic educational model; it does not duplicate identity, tenancy,
 *   security, digital twin, scheduling, analytics, or automation (Sections 130, 185, 198).
 */

import type { TenantId, TenantContext, DataClassification } from "./tenant-core";

/* ─────────────────────────────────────────────────────────────
 * Branded educational IDs
 * ────────────────────────────────────────────────────────────*/

export type EducationalLevelId = string & { readonly __brand: "EducationalLevelId" };
export type ProgrammeId = string & { readonly __brand: "ProgrammeId" };
export type CurriculumId = string & { readonly __brand: "CurriculumId" };
export type CurriculumVersionId = string & { readonly __brand: "CurriculumVersionId" };
export type SubjectId = string & { readonly __brand: "SubjectId" };
export type CourseId = string & { readonly __brand: "CourseId" };
export type TopicId = string & { readonly __brand: "TopicId" };
export type UnitId = string & { readonly __brand: "UnitId" };
export type CompetencyId = string & { readonly __brand: "CompetencyId" };
export type ClassId = string & { readonly __brand: "ClassId" };
export type CohortId = string & { readonly __brand: "CohortId" };
export type StreamId = string & { readonly __brand: "StreamId" };
export type AcademicPeriodId = string & { readonly __brand: "AcademicPeriodId" };
export type ShiftId = string & { readonly __brand: "ShiftId" };
export type CampusId = string & { readonly __brand: "CampusId" };
export type BuildingId = string & { readonly __brand: "BuildingId" };
export type RoomId = string & { readonly __brand: "RoomId" };
export type FacilityId = string & { readonly __brand: "FacilityId" };
export type LanguageId = string & { readonly __brand: "LanguageId" };
export type StudentProfileId = string & { readonly __brand: "StudentProfileId" };
export type StaffContextId = string & { readonly __brand: "StaffContextId" };
export type AssessmentId = string & { readonly __brand: "AssessmentId" };
export type GradingSystemId = string & { readonly __brand: "GradingSystemId" };
export type LearningActivityId = string & { readonly __brand: "LearningActivityId" };
export type LessonId = string & { readonly __brand: "LessonId" };
export type AssignmentId = string & { readonly __brand: "AssignmentId" };
export type ExaminationId = string & { readonly __brand: "ExaminationId" };
export type AttendanceEventId = string & { readonly __brand: "AttendanceEventId" };
export type BlueprintId = string & { readonly __brand: "BlueprintId" };
export type PolicyId = string & { readonly __brand: "PolicyId" };
export type EvidenceId = string & { readonly __brand: "EvidenceId" };
export type SchoolEventId = string & { readonly __brand: "SchoolEventId" };
export type ClubId = string & { readonly __brand: "ClubId" };
export type HouseId = string & { readonly __brand: "HouseId" };
export type BoardingHouseId = string & { readonly __brand: "BoardingHouseId" };
export type TransportRouteId = string & { readonly __brand: "TransportRouteId" };
export type ResourceId = string & { readonly __brand: "ResourceId" };
export type DeviceContextId = string & { readonly __brand: "DeviceContextId" };
export type FamilyRelationshipId = string & { readonly __brand: "FamilyRelationshipId" };
export type InspectionId = string & { readonly __brand: "InspectionId" };
export type AccreditationId = string & { readonly __brand: "AccreditationId" };
export type CertificationId = string & { readonly __brand: "CertificationId" };
export type DocumentId = string & { readonly __brand: "DocumentId" };
export type ScenarioId = string & { readonly __brand: "ScenarioId" };
export type SnapshotId = string & { readonly __brand: "SnapshotId" };

export function educationalLevelId(raw: string): EducationalLevelId {
  return raw as EducationalLevelId;
}
export function programmeId(raw: string): ProgrammeId {
  return raw as ProgrammeId;
}
export function curriculumId(raw: string): CurriculumId {
  return raw as CurriculumId;
}
export function curriculumVersionId(raw: string): CurriculumVersionId {
  return raw as CurriculumVersionId;
}
export function subjectId(raw: string): SubjectId {
  return raw as SubjectId;
}
export function courseId(raw: string): CourseId {
  return raw as CourseId;
}
export function topicId(raw: string): TopicId {
  return raw as TopicId;
}
export function unitId(raw: string): UnitId {
  return raw as UnitId;
}
export function competencyId(raw: string): CompetencyId {
  return raw as CompetencyId;
}
export function classId(raw: string): ClassId {
  return raw as ClassId;
}
export function cohortId(raw: string): CohortId {
  return raw as CohortId;
}
export function streamId(raw: string): StreamId {
  return raw as StreamId;
}
export function academicPeriodId(raw: string): AcademicPeriodId {
  return raw as AcademicPeriodId;
}
export function shiftId(raw: string): ShiftId {
  return raw as ShiftId;
}
export function campusId(raw: string): CampusId {
  return raw as CampusId;
}
export function buildingId(raw: string): BuildingId {
  return raw as BuildingId;
}
export function roomId(raw: string): RoomId {
  return raw as RoomId;
}
export function facilityId(raw: string): FacilityId {
  return raw as FacilityId;
}
export function languageId(raw: string): LanguageId {
  return raw as LanguageId;
}
export function studentProfileId(raw: string): StudentProfileId {
  return raw as StudentProfileId;
}
export function staffContextId(raw: string): StaffContextId {
  return raw as StaffContextId;
}
export function assessmentId(raw: string): AssessmentId {
  return raw as AssessmentId;
}
export function gradingSystemId(raw: string): GradingSystemId {
  return raw as GradingSystemId;
}
export function learningActivityId(raw: string): LearningActivityId {
  return raw as LearningActivityId;
}
export function lessonId(raw: string): LessonId {
  return raw as LessonId;
}
export function assignmentId(raw: string): AssignmentId {
  return raw as AssignmentId;
}
export function examinationId(raw: string): ExaminationId {
  return raw as ExaminationId;
}
export function attendanceEventId(raw: string): AttendanceEventId {
  return raw as AttendanceEventId;
}
export function blueprintId(raw: string): BlueprintId {
  return raw as BlueprintId;
}
export function policyId(raw: string): PolicyId {
  return raw as PolicyId;
}
export function evidenceId(raw: string): EvidenceId {
  return raw as EvidenceId;
}
export function schoolEventId(raw: string): SchoolEventId {
  return raw as SchoolEventId;
}
export function clubId(raw: string): ClubId {
  return raw as ClubId;
}
export function houseId(raw: string): HouseId {
  return raw as HouseId;
}
export function boardingHouseId(raw: string): BoardingHouseId {
  return raw as BoardingHouseId;
}
export function transportRouteId(raw: string): TransportRouteId {
  return raw as TransportRouteId;
}
export function resourceId(raw: string): ResourceId {
  return raw as ResourceId;
}
export function deviceContextId(raw: string): DeviceContextId {
  return raw as DeviceContextId;
}
export function familyRelationshipId(raw: string): FamilyRelationshipId {
  return raw as FamilyRelationshipId;
}
export function inspectionId(raw: string): InspectionId {
  return raw as InspectionId;
}
export function accreditationId(raw: string): AccreditationId {
  return raw as AccreditationId;
}
export function certificationId(raw: string): CertificationId {
  return raw as CertificationId;
}
export function documentId(raw: string): DocumentId {
  return raw as DocumentId;
}
export function scenarioId(raw: string): ScenarioId {
  return raw as ScenarioId;
}
export function snapshotId(raw: string): SnapshotId {
  return raw as SnapshotId;
}

/* ─────────────────────────────────────────────────────────────
 * Tenant-scoped educational entity base
 * ────────────────────────────────────────────────────────────*/

/**
 * Every educational entity must resolve to the correct tenant (Section 134).
 * This is the base contract for all Phase 04 entities.
 */
export interface TenantScopedEntity {
  tenantId: TenantId;
  createdAt: string;
  updatedAt: string;
}

/** Invariant: every educational entity must have a determinable tenant boundary. */
export function hasEducationalTenantBoundary(
  entity: Pick<TenantScopedEntity, "tenantId">,
): boolean {
  return entity.tenantId.length > 0;
}

/** Invariant: an educational entity must belong to the active tenant context. */
export function isEntityInTenant(
  entity: Pick<TenantScopedEntity, "tenantId">,
  context: Pick<TenantContext, "tenantId">,
): boolean {
  return context.tenantId === null || entity.tenantId === context.tenantId;
}

/* ─────────────────────────────────────────────────────────────
 * Data classification for educational entities
 * ────────────────────────────────────────────────────────────*/

/**
 * Educational data classification (Sections 136–137).
 * Student information requires heightened protection.
 */
export type EducationalDataClassification =
  "PUBLIC" | "TENANT_INTERNAL" | "CONFIDENTIAL" | "SENSITIVE" | "RESTRICTED";

export const EDUCATIONAL_DATA_CLASSIFICATIONS: readonly EducationalDataClassification[] = [
  "PUBLIC",
  "TENANT_INTERNAL",
  "CONFIDENTIAL",
  "SENSITIVE",
  "RESTRICTED",
] as const;

export function educationalClassificationRank(c: EducationalDataClassification): number {
  switch (c) {
    case "PUBLIC":
      return 0;
    case "TENANT_INTERNAL":
      return 1;
    case "CONFIDENTIAL":
      return 2;
    case "SENSITIVE":
      return 3;
    case "RESTRICTED":
      return 4;
  }
}

/* ─────────────────────────────────────────────────────────────
 * Educational audit event (Section 138)
 * ────────────────────────────────────────────────────────────*/

export type EducationalAuditEventType =
  | "EducationalEntityCreated"
  | "EducationalEntityUpdated"
  | "EducationalEntityDeleted"
  | "CurriculumVersioned"
  | "ClassAssignmentChanged"
  | "StudentEnrolmentChanged"
  | "AssessmentRecorded"
  | "GradeChanged"
  | "PromotionDecision"
  | "BlueprintVersioned"
  | "PolicyChanged"
  | "SensitiveDataAccessed"
  | "SafeguardingCaseOpened"
  | "SafeguardingCaseEscalated"
  | "ConfigurationRolledBack";

export interface EducationalAuditEvent {
  id: string;
  type: EducationalAuditEventType;
  tenantId: TenantId;
  actorId: string | null;
  occurredAt: string;
  entityType: string;
  entityId: string;
  result: "success" | "failure" | "partial";
  metadata: Record<string, unknown>;
}

/* ─────────────────────────────────────────────────────────────
 * Educational level (Section 5)
 * ────────────────────────────────────────────────────────────*/

/**
 * Educational levels are configurable — never hard-coded (Section 5).
 * Examples: early childhood, nursery, kindergarten, pre-primary, primary,
 * lower primary, upper primary, junior secondary, senior secondary,
 * technical secondary, vocational training, teacher training, college,
 * tertiary, adult education, continuing education, professional education,
 * institutional custom levels.
 */
export interface EducationalLevel extends TenantScopedEntity {
  id: EducationalLevelId;
  name: string;
  code: string;
  /** Ordinal position within the institution's level hierarchy. */
  order: number;
  /** Parent level (e.g., "primary" → "lower primary"). */
  parentLevelId: EducationalLevelId | null;
  /** Whether this level is the terminal level of a programme. */
  isTerminal: boolean;
  /** Institution-defined description. */
  description: string | null;
}

/* ─────────────────────────────────────────────────────────────
 * Language model (Section 17)
 * ────────────────────────────────────────────────────────────*/

export type LanguageRole =
  "instructional" | "administrative" | "local" | "examination" | "communication";

export const LANGUAGE_ROLES: readonly LanguageRole[] = [
  "instructional",
  "administrative",
  "local",
  "examination",
  "communication",
] as const;

export interface Language extends TenantScopedEntity {
  id: LanguageId;
  name: string;
  code: string;
  roles: LanguageRole[];
  /** Whether this is the institution's primary instructional language. */
  isPrimaryInstructional: boolean;
}

/* ─────────────────────────────────────────────────────────────
 * Academic period (Section 30)
 * ────────────────────────────────────────────────────────────*/

export type AcademicPeriodType =
  "annual" | "semester" | "term" | "trimester" | "quarter" | "custom";

export const ACADEMIC_PERIOD_TYPES: readonly AcademicPeriodType[] = [
  "annual",
  "semester",
  "term",
  "trimester",
  "quarter",
  "custom",
] as const;

export interface AcademicPeriod extends TenantScopedEntity {
  id: AcademicPeriodId;
  name: string;
  type: AcademicPeriodType;
  startsOn: string;
  endsOn: string;
  /** Parent period (e.g., a term within an academic year). */
  parentPeriodId: AcademicPeriodId | null;
  /** Whether this period is currently active. */
  isActive: boolean;
}

/* ─────────────────────────────────────────────────────────────
 * Shift model (Section 33)
 * ────────────────────────────────────────────────────────────*/

export type ShiftType = "morning" | "afternoon" | "evening" | "night" | "rotating" | "weekend";

export const SHIFT_TYPES: readonly ShiftType[] = [
  "morning",
  "afternoon",
  "evening",
  "night",
  "rotating",
  "weekend",
] as const;

export interface Shift extends TenantScopedEntity {
  id: ShiftId;
  name: string;
  type: ShiftType;
  opensAt: string;
  closesAt: string;
  /** Shift-specific policies (Section 34). */
  policyRefs: string[];
}

/* ─────────────────────────────────────────────────────────────
 * Campus / building / room / facility (Sections 59–63)
 * ────────────────────────────────────────────────────────────*/

export type FacilityType =
  | "classroom"
  | "laboratory"
  | "workshop"
  | "library"
  | "office"
  | "hall"
  | "dormitory"
  | "clinic"
  | "cafeteria"
  | "kitchen"
  | "farm"
  | "sports_field"
  | "prayer_facility"
  | "mosque"
  | "church"
  | "community_centre"
  | "custom";

export const FACILITY_TYPES: readonly FacilityType[] = [
  "classroom",
  "laboratory",
  "workshop",
  "library",
  "office",
  "hall",
  "dormitory",
  "clinic",
  "cafeteria",
  "kitchen",
  "farm",
  "sports_field",
  "prayer_facility",
  "mosque",
  "church",
  "community_centre",
  "custom",
] as const;

export type FacilityState = "operational" | "degraded" | "maintenance" | "unavailable";

export const FACILITY_STATES: readonly FacilityState[] = [
  "operational",
  "degraded",
  "maintenance",
  "unavailable",
] as const;

export interface Campus extends TenantScopedEntity {
  id: CampusId;
  name: string;
  address: string | null;
  /** Whether this campus is currently operational. */
  isActive: boolean;
}

export interface Building extends TenantScopedEntity {
  id: BuildingId;
  campusId: CampusId;
  name: string;
  purpose: string | null;
  capacity: number | null;
}

export interface Room extends TenantScopedEntity {
  id: RoomId;
  buildingId: BuildingId;
  name: string;
  type: FacilityType;
  capacity: number;
  /** Declared capabilities (Section 63). */
  capabilities: string[];
  /** Assigned activities (Section 62). */
  assignedActivityIds: string[];
  state: FacilityState;
}

export interface Facility extends TenantScopedEntity {
  id: FacilityId;
  campusId: CampusId;
  name: string;
  type: FacilityType;
  capacity: number | null;
  /** Declared capabilities (Section 63). */
  capabilities: string[];
  state: FacilityState;
  /** Availability restrictions (Section 74). */
  availabilityRestrictions: string[];
  /** Equipment references (Section 64). */
  equipmentRefs: string[];
  /** Maintenance state (Section 76). */
  maintenanceState: string | null;
}

/* ─────────────────────────────────────────────────────────────
 * School calendar (Section 31)
 * ────────────────────────────────────────────────────────────*/

export type CalendarEntryType =
  | "instructional_day"
  | "holiday"
  | "examination"
  | "event"
  | "break"
  | "training_day"
  | "public_holiday"
  | "institutional_closure";

export const CALENDAR_ENTRY_TYPES: readonly CalendarEntryType[] = [
  "instructional_day",
  "holiday",
  "examination",
  "event",
  "break",
  "training_day",
  "public_holiday",
  "institutional_closure",
] as const;

export interface SchoolCalendarEntry extends TenantScopedEntity {
  id: string;
  type: CalendarEntryType;
  date: string;
  description: string | null;
  /** Optional academic period association. */
  academicPeriodId: AcademicPeriodId | null;
}

/* ─────────────────────────────────────────────────────────────
 * School hours (Section 32)
 * ────────────────────────────────────────────────────────────*/

export interface SchoolHours extends TenantScopedEntity {
  id: string;
  shiftId: ShiftId | null;
  opensAt: string;
  closesAt: string;
  /** Named periods within the school day (e.g., assembly, lunch, prayer). */
  periods: Array<{
    name: string;
    startsAt: string;
    endsAt: string;
  }>;
}

/* ─────────────────────────────────────────────────────────────
 * Attendance (Sections 38–39)
 * ────────────────────────────────────────────────────────────*/

export type AttendanceStatus =
  "present" | "absent" | "late" | "excused" | "early_departure" | "remote" | "field_activity";

export const ATTENDANCE_STATUSES: readonly AttendanceStatus[] = [
  "present",
  "absent",
  "late",
  "excused",
  "early_departure",
  "remote",
  "field_activity",
] as const;

export type AttendanceSubject = "student" | "staff" | "class" | "event" | "practical" | "boarding";

export const ATTENDANCE_SUBJECTS: readonly AttendanceSubject[] = [
  "student",
  "staff",
  "class",
  "event",
  "practical",
  "boarding",
] as const;

export interface AttendanceEvent extends TenantScopedEntity {
  id: AttendanceEventId;
  subject: AttendanceSubject;
  subjectId: string;
  status: AttendanceStatus;
  recordedBy: string;
  recordedAt: string;
  /** Optional lesson/activity association. */
  activityId: string | null;
  /** Optional reason for absence/excusal. */
  reason: string | null;
}

/* ─────────────────────────────────────────────────────────────
 * Student profile (Sections 26–27)
 * ────────────────────────────────────────────────────────────*/

export type StudentProgressionState =
  | "enrolled"
  | "active"
  | "on_leave"
  | "transferred"
  | "graduated"
  | "withdrawn"
  | "suspended"
  | "expelled";

export const STUDENT_PROGRESSION_STATES: readonly StudentProgressionState[] = [
  "enrolled",
  "active",
  "on_leave",
  "transferred",
  "graduated",
  "withdrawn",
  "suspended",
  "expelled",
] as const;

/**
 * Student educational profile (Section 27).
 * Consumes authoritative identity from Phase 02; adds educational context.
 * Sensitive information remains governed by policy.
 */
export interface StudentProfile extends TenantScopedEntity {
  id: StudentProfileId;
  /** Phase 02 identity reference. */
  identityId: string;
  programmeId: ProgrammeId | null;
  classId: ClassId | null;
  cohortId: CohortId | null;
  subjectIds: SubjectId[];
  academicHistoryRefs: string[];
  attendanceRefs: string[];
  competencyRefs: string[];
  assessmentRefs: string[];
  activityRefs: string[];
  supportNeedRefs: string[];
  progressionState: StudentProgressionState;
  /** Data classification — student data is heightened-protection (Section 137). */
  dataClassification: EducationalDataClassification;
}

/* ─────────────────────────────────────────────────────────────
 * Staff educational context (Sections 28–29)
 * ────────────────────────────────────────────────────────────*/

export interface TeacherWorkload extends TenantScopedEntity {
  id: string;
  staffContextId: StaffContextId;
  teachingHours: number;
  preparationHours: number;
  assessmentHours: number;
  supervisionHours: number;
  dutyHours: number;
  meetingHours: number;
  extracurricularHours: number;
  academicPeriodId: AcademicPeriodId;
}

export interface StaffEducationalContext extends TenantScopedEntity {
  id: StaffContextId;
  /** Phase 02 identity reference. */
  identityId: string;
  subjectIds: SubjectId[];
  classIds: ClassId[];
  campusIds: CampusId[];
  departmentRefs: string[];
  shiftIds: ShiftId[];
  programmeIds: ProgrammeId[];
  academicPeriodIds: AcademicPeriodId[];
  responsibilityRefs: string[];
}

/* ─────────────────────────────────────────────────────────────
 * Educational graph relationships (Section 123)
 * ────────────────────────────────────────────────────────────*/

export type EducationalRelationshipType =
  | "teaches"
  | "attends"
  | "belongs_to"
  | "located_in"
  | "requires"
  | "scheduled_in"
  | "supervises"
  | "manages"
  | "enrolled_in"
  | "assessed_by"
  | "uses"
  | "assigned_to";

export const EDUCATIONAL_RELATIONSHIP_TYPES: readonly EducationalRelationshipType[] = [
  "teaches",
  "attends",
  "belongs_to",
  "located_in",
  "requires",
  "scheduled_in",
  "supervises",
  "manages",
  "enrolled_in",
  "assessed_by",
  "uses",
  "assigned_to",
] as const;

/**
 * Temporal relationship (Section 124).
 * Relationships must support validity periods.
 */
export interface EducationalRelationship extends TenantScopedEntity {
  id: string;
  type: EducationalRelationshipType;
  fromEntityType: string;
  fromEntityId: string;
  toEntityType: string;
  toEntityId: string;
  validFrom: string;
  validUntil: string | null;
}

/* ─────────────────────────────────────────────────────────────
 * School blueprint (Sections 81–82)
 * ────────────────────────────────────────────────────────────*/

export interface SchoolBlueprint extends TenantScopedEntity {
  id: BlueprintId;
  version: number;
  author: string;
  reason: string;
  /** Validation result of this blueprint. */
  validation: {
    valid: boolean;
    errors: string[];
  };
  /** Migration impact assessment. */
  migrationImpact: string | null;
  /** Snapshot of the institutional configuration at this version. */
  configurationSnapshot: Record<string, unknown>;
}

/* ─────────────────────────────────────────────────────────────
 * School operating policy (Section 77)
 * ────────────────────────────────────────────────────────────*/

export type SchoolPolicyType =
  | "attendance"
  | "grading"
  | "promotion"
  | "discipline"
  | "academic"
  | "facility"
  | "device"
  | "communication";

export const SCHOOL_POLICY_TYPES: readonly SchoolPolicyType[] = [
  "attendance",
  "grading",
  "promotion",
  "discipline",
  "academic",
  "facility",
  "device",
  "communication",
] as const;

export interface SchoolPolicy extends TenantScopedEntity {
  id: PolicyId;
  type: SchoolPolicyType;
  name: string;
  /** Policy content — configuration, not code (Section 78). */
  content: Record<string, unknown>;
  version: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
  /** Policy changes require audit (Section 168). */
  lastChangedBy: string | null;
  lastChangedAt: string | null;
}

/* ─────────────────────────────────────────────────────────────
 * Evidence model (Section 100)
 * ────────────────────────────────────────────────────────────*/

export type EvidenceType =
  | "assignment"
  | "exam"
  | "project"
  | "practical"
  | "attendance"
  | "competency"
  | "teacher_observation";

export const EVIDENCE_TYPES: readonly EvidenceType[] = [
  "assignment",
  "exam",
  "project",
  "practical",
  "attendance",
  "competency",
  "teacher_observation",
] as const;

export interface EducationalEvidence extends TenantScopedEntity {
  id: EvidenceId;
  type: EvidenceType;
  studentProfileId: StudentProfileId;
  subjectId: SubjectId | null;
  activityId: string | null;
  /** Reference to the source record. */
  sourceRef: string;
  /** Provenance: database, device, user, administrator, external API, AI inference. */
  provenance: "database" | "device" | "user" | "administrator" | "external_api" | "ai_inference";
  /** AI-generated information must be distinguishable from verified source data. */
  isAiGenerated: boolean;
  dataClassification: EducationalDataClassification;
}

/* ─────────────────────────────────────────────────────────────
 * AI safety boundary (Section 117)
 * ────────────────────────────────────────────────────────────*/

/**
 * AI cannot invent student records, school policies, permissions,
 * alter authoritative grades without authorization, or override
 * institutional rules (Section 117).
 */
export interface AiEducationalContext {
  tenantId: TenantId;
  studentProfileId: StudentProfileId | null;
  classId: ClassId | null;
  subjectId: SubjectId | null;
  academicPeriodId: AcademicPeriodId | null;
  campusId: CampusId | null;
  /** AI context is read-only by default. */
  canMutate: false;
}

/* ─────────────────────────────────────────────────────────────
 * Helpers
 * ────────────────────────────────────────────────────────────*/

/** Section 162: If the system does not know, it must not invent. */
export function isUnknown(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === "";
}

/** Section 146: AI is not the system of record. */
export function isAiGeneratedEvidence(
  evidence: Pick<EducationalEvidence, "isAiGenerated">,
): boolean {
  return evidence.isAiGenerated;
}
