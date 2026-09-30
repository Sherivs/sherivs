/**
 * CoreGrid — Education Reality Engine institutional structure.
 *
 * Implements `architecture/phase-04-education-reality-engine.md`:
 * - Cohort model: intake, cohort, class, stream, group, house, tutorial group,
 *   practical group, examination group (Section 22).
 * - Class model: identity, level, programme, academic period, campus, room,
 *   teacher assignments, students, subjects, timetable, policies (Section 23).
 * - Streams: science, arts, commercial, technical, vocational, agricultural,
 *   custom (Section 24).
 * - Class flexibility: a learner may belong to different groups for different
 *   activities (Section 25).
 * - Student identity consumes Phase 02; adds educational context (Section 26).
 * - Staff educational context (Section 28).
 * - Teacher workload (Section 29).
 * - Student grouping (Section 52).
 * - Special educational needs (Section 53).
 * - Boarding model (Section 57).
 * - Transport model (Section 58).
 * - Family structure (Section 111).
 */

import type { TenantId } from "./tenant-core";
import {
  classId,
  cohortId,
  streamId,
  studentProfileId,
  staffContextId,
  boardingHouseId,
  transportRouteId,
  familyRelationshipId,
  type ClassId,
  type CohortId,
  type StreamId,
  type StudentProfileId,
  type StaffContextId,
  type BoardingHouseId,
  type TransportRouteId,
  type FamilyRelationshipId,
  type TenantScopedEntity,
  type AcademicPeriodId,
  type CampusId,
  type RoomId,
  type SubjectId,
  type ProgrammeId,
  type EducationalLevelId,
  type ShiftId,
  type EducationalAuditEvent,
} from "./education-core";

/* ─────────────────────────────────────────────────────────────
 * Stream (Section 24)
 * ────────────────────────────────────────────────────────────*/

export type StreamType =
  "science" | "arts" | "commercial" | "technical" | "vocational" | "agricultural" | "custom";

export const STREAM_TYPES: readonly StreamType[] = [
  "science",
  "arts",
  "commercial",
  "technical",
  "vocational",
  "agricultural",
  "custom",
] as const;

export interface Stream extends TenantScopedEntity {
  id: StreamId;
  name: string;
  type: StreamType;
  description: string | null;
}

/* ─────────────────────────────────────────────────────────────
 * Cohort (Section 22)
 * ────────────────────────────────────────────────────────────*/

export interface Cohort extends TenantScopedEntity {
  id: CohortId;
  name: string;
  /** Intake year/period. */
  intakeRef: string;
  programmeId: ProgrammeId;
  levelId: EducationalLevelId;
  academicPeriodId: AcademicPeriodId;
  /** Whether this cohort is currently active. */
  isActive: boolean;
}

/* ─────────────────────────────────────────────────────────────
 * Class (Section 23)
 * ────────────────────────────────────────────────────────────*/

export interface Class extends TenantScopedEntity {
  id: ClassId;
  name: string;
  levelId: EducationalLevelId;
  programmeId: ProgrammeId;
  academicPeriodId: AcademicPeriodId;
  campusId: CampusId;
  roomId: RoomId | null;
  /** Teacher assignments. */
  teacherAssignmentRefs: string[];
  /** Student references. */
  studentProfileIds: StudentProfileId[];
  subjectIds: SubjectId[];
  /** Timetable reference (Phase 12 owns optimization). */
  timetableRef: string | null;
  /** Class-specific policies. */
  policyRefs: string[];
  streamId: StreamId | null;
  shiftId: ShiftId | null;
  /** Whether this class is currently active. */
  isActive: boolean;
}

/* ─────────────────────────────────────────────────────────────
 * Class flexibility (Section 25)
 * ────────────────────────────────────────────────────────────*/

export type GroupType =
  "tutorial" | "practical" | "examination" | "house" | "sports" | "club" | "custom";

export const GROUP_TYPES: readonly GroupType[] = [
  "tutorial",
  "practical",
  "examination",
  "house",
  "sports",
  "club",
  "custom",
] as const;

/**
 * A learner may belong to different groups for different activities (Section 25).
 */
export interface StudentGroup extends TenantScopedEntity {
  id: string;
  name: string;
  type: GroupType;
  classId: ClassId;
  subjectId: SubjectId | null;
  studentProfileIds: StudentProfileId[];
  /** Group-specific policies. */
  policyRefs: string[];
}

/* ─────────────────────────────────────────────────────────────
 * Student enrolment (Section 26)
 * ────────────────────────────────────────────────────────────*/

export interface StudentEnrolment extends TenantScopedEntity {
  id: string;
  studentProfileId: StudentProfileId;
  classId: ClassId;
  programmeId: ProgrammeId;
  academicPeriodId: AcademicPeriodId;
  enrolledAt: string;
  /** Enrolment state. */
  state: "active" | "transferred" | "withdrawn" | "graduated";
  /** Transfer history. */
  transferHistory: Array<{
    fromClassId: ClassId;
    toClassId: ClassId;
    transferredAt: string;
    reason: string;
  }>;
}

/* ─────────────────────────────────────────────────────────────
 * Class operations
 * ────────────────────────────────────────────────────────────*/

export interface CreateClassInput {
  tenantId: TenantId;
  name: string;
  levelId: EducationalLevelId;
  programmeId: ProgrammeId;
  academicPeriodId: AcademicPeriodId;
  campusId: CampusId;
  roomId: RoomId | null;
  subjectIds: SubjectId[];
  streamId: StreamId | null;
  shiftId: ShiftId | null;
}

export type CreateClassResult = { ok: true; class: Class } | { ok: false; error: string };

export function createClass(
  input: CreateClassInput,
  existingClasses: Class[],
  now: string,
): CreateClassResult {
  if (input.name.trim() === "") {
    return { ok: false, error: "Class name is required" };
  }

  // Class names must be unique within the tenant.
  if (existingClasses.some((c) => c.name === input.name)) {
    return { ok: false, error: `Class ${input.name} already exists` };
  }

  const cls: Class = {
    id: classId(`${input.tenantId}:${input.name}`),
    tenantId: input.tenantId,
    name: input.name,
    levelId: input.levelId,
    programmeId: input.programmeId,
    academicPeriodId: input.academicPeriodId,
    campusId: input.campusId,
    roomId: input.roomId,
    teacherAssignmentRefs: [],
    studentProfileIds: [],
    subjectIds: input.subjectIds,
    timetableRef: null,
    policyRefs: [],
    streamId: input.streamId,
    shiftId: input.shiftId,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };

  return { ok: true, class: cls };
}

/* ─────────────────────────────────────────────────────────────
 * Student enrolment operations
 * ────────────────────────────────────────────────────────────*/

export interface EnrolStudentInput {
  tenantId: TenantId;
  studentProfileId: StudentProfileId;
  classId: ClassId;
  programmeId: ProgrammeId;
  academicPeriodId: AcademicPeriodId;
  actorId: string;
}

export type EnrolStudentResult =
  | { ok: true; enrolment: StudentEnrolment; auditEvent: EducationalAuditEvent }
  | { ok: false; error: string };

export function enrolStudent(
  input: EnrolStudentInput,
  existingEnrolments: StudentEnrolment[],
  now: string,
): EnrolStudentResult {
  // A student cannot be simultaneously active in incompatible contexts (Section 170).
  const activeEnrolment = existingEnrolments.find(
    (e) =>
      e.studentProfileId === input.studentProfileId &&
      e.state === "active" &&
      e.academicPeriodId === input.academicPeriodId,
  );

  if (activeEnrolment) {
    return {
      ok: false,
      error: "Student already has an active enrolment in this academic period",
    };
  }

  const enrolment: StudentEnrolment = {
    id: `enrol-${input.tenantId}-${input.studentProfileId}-${now}`,
    tenantId: input.tenantId,
    studentProfileId: input.studentProfileId,
    classId: input.classId,
    programmeId: input.programmeId,
    academicPeriodId: input.academicPeriodId,
    enrolledAt: now,
    state: "active",
    transferHistory: [],
    createdAt: now,
    updatedAt: now,
  };

  const auditEvent: EducationalAuditEvent = {
    id: `audit-${now}-${input.studentProfileId}`,
    type: "StudentEnrolmentChanged",
    tenantId: input.tenantId,
    actorId: input.actorId,
    occurredAt: now,
    entityType: "StudentEnrolment",
    entityId: enrolment.id,
    result: "success",
    metadata: {
      studentProfileId: input.studentProfileId,
      classId: input.classId,
      programmeId: input.programmeId,
      academicPeriodId: input.academicPeriodId,
    },
  };

  return { ok: true, enrolment, auditEvent };
}

/* ─────────────────────────────────────────────────────────────
 * Student transfer (Section 170)
 * ────────────────────────────────────────────────────────────*/

export interface TransferStudentInput {
  tenantId: TenantId;
  enrolmentId: string;
  toClassId: ClassId;
  reason: string;
  actorId: string;
}

export type TransferStudentResult =
  | { ok: true; enrolment: StudentEnrolment; auditEvent: EducationalAuditEvent }
  | { ok: false; error: string };

export function transferStudent(
  input: TransferStudentInput,
  enrolment: StudentEnrolment,
  now: string,
): TransferStudentResult {
  if (enrolment.state !== "active") {
    return { ok: false, error: "Cannot transfer a student who is not active" };
  }

  if (enrolment.classId === input.toClassId) {
    return { ok: false, error: "Student is already in the target class" };
  }

  if (input.reason.trim() === "") {
    return { ok: false, error: "Student transfer requires a reason" };
  }

  const updated: StudentEnrolment = {
    ...enrolment,
    classId: input.toClassId,
    transferHistory: [
      ...enrolment.transferHistory,
      {
        fromClassId: enrolment.classId,
        toClassId: input.toClassId,
        transferredAt: now,
        reason: input.reason,
      },
    ],
    updatedAt: now,
  };

  const auditEvent: EducationalAuditEvent = {
    id: `audit-${now}-${enrolment.id}`,
    type: "StudentEnrolmentChanged",
    tenantId: input.tenantId,
    actorId: input.actorId,
    occurredAt: now,
    entityType: "StudentEnrolment",
    entityId: enrolment.id,
    result: "success",
    metadata: {
      fromClassId: enrolment.classId,
      toClassId: input.toClassId,
      reason: input.reason,
    },
  };

  return { ok: true, enrolment: updated, auditEvent };
}

/* ─────────────────────────────────────────────────────────────
 * Boarding model (Section 57)
 * ────────────────────────────────────────────────────────────*/

export interface BoardingHouse extends TenantScopedEntity {
  id: BoardingHouseId;
  name: string;
  campusId: CampusId;
  capacity: number;
  supervisorRefs: string[];
  studentProfileIds: StudentProfileId[];
  /** Boarding schedules. */
  scheduleRefs: string[];
  /** Meal references. */
  mealRefs: string[];
  /** Incident references. */
  incidentRefs: string[];
}

/* ─────────────────────────────────────────────────────────────
 * Transport model (Section 58)
 * ────────────────────────────────────────────────────────────*/

export interface TransportRoute extends TenantScopedEntity {
  id: TransportRouteId;
  name: string;
  campusId: CampusId;
  stops: string[];
  vehicleRefs: string[];
  driverRefs: string[];
  studentProfileIds: StudentProfileId[];
  scheduleRefs: string[];
  vehicleCapacity: number;
}

/* ─────────────────────────────────────────────────────────────
 * Family structure (Section 111)
 * ────────────────────────────────────────────────────────────*/

export type FamilyRelationshipRole =
  "parent" | "guardian" | "foster_guardian" | "emergency_contact" | "authorized_representative";

export const FAMILY_RELATIONSHIP_ROLES: readonly FamilyRelationshipRole[] = [
  "parent",
  "guardian",
  "foster_guardian",
  "emergency_contact",
  "authorized_representative",
] as const;

/**
 * Parents and guardians may have controlled relationships to students.
 * Permissions must be policy-driven (Section 110).
 */
export interface FamilyRelationship extends TenantScopedEntity {
  id: FamilyRelationshipId;
  studentProfileId: StudentProfileId;
  /** Phase 02 identity reference for the family member. */
  identityId: string;
  role: FamilyRelationshipRole;
  /** Policy-driven permissions. */
  permissionRefs: string[];
  validFrom: string;
  validUntil: string | null;
}

/* ─────────────────────────────────────────────────────────────
 * Special educational needs (Section 53)
 * ────────────────────────────────────────────────────────────*/

export interface SpecialEducationalNeed extends TenantScopedEntity {
  id: string;
  studentProfileId: StudentProfileId;
  /** Configurable accommodations. */
  accommodations: string[];
  /** Accessibility resources. */
  accessibilityResourceRefs: string[];
  /** Specialized classroom reference. */
  specializedClassroomRef: string | null;
  /** Support staff references. */
  supportStaffRefs: string[];
  /** Assistive technology references. */
  assistiveTechnologyRefs: string[];
  /** Data classification — heightened protection (Section 137). */
  dataClassification: "SENSITIVE" | "RESTRICTED";
}

/* ─────────────────────────────────────────────────────────────
 * Validation helpers
 * ────────────────────────────────────────────────────────────*/

/** Section 170: A transferred student cannot remain simultaneously active in incompatible contexts. */
export function hasConflictingEnrolment(
  enrolments: StudentEnrolment[],
  studentProfileId: StudentProfileId,
  academicPeriodId: AcademicPeriodId,
): boolean {
  return enrolments.some(
    (e) =>
      e.studentProfileId === studentProfileId &&
      e.academicPeriodId === academicPeriodId &&
      e.state === "active",
  );
}

/** Section 170: A revoked teacher assignment cannot continue granting teaching authority. */
export function isTeacherAssignmentActive(
  assignment: { validUntil: string | null },
  now: string,
): boolean {
  return assignment.validUntil === null || assignment.validUntil > now;
}
