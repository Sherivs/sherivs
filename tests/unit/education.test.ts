import { describe, expect, it } from "vitest";
import { tenantId, type TenantId } from "@/lib/tenant-core";
import {
  educationalLevelId,
  programmeId,
  curriculumId,
  subjectId,
  classId,
  studentProfileId,
  academicPeriodId,
  campusId,
  roomId,
  facilityId,
  type StudentProfileId,
  type ClassId,
  type AcademicPeriodId,
  type CampusId,
  type RoomId,
  type FacilityId,
  type SubjectId,
  type ProgrammeId,
  type CurriculumId,
  type EducationalLevelId,
} from "@/lib/education-core";
import {
  createCurriculumVersion,
  createSubject,
  createProgramme,
  createCompetency,
  validateCurriculum,
  canSupersedeCurriculum,
  type CurriculumVersion,
  type Subject,
  type Programme,
  type Competency,
  type Curriculum,
} from "@/lib/education-curriculum";
import {
  createClass,
  enrolStudent,
  transferStudent,
  hasConflictingEnrolment,
  isTeacherAssignmentActive,
  type Class,
  type StudentEnrolment,
} from "@/lib/education-institution";
import {
  recordGrade,
  makeProgressionDecision,
  validateGradingSystem,
  type GradingSystem,
} from "@/lib/education-assessment";
import {
  createFacility,
  setFacilityAvailability,
  canScheduleFacility,
  authorizeFacilityAssignment,
  type FacilityAvailability,
} from "@/lib/education-facilities";
import {
  createBlueprint,
  validateInstitutionalConfiguration,
  createScenario,
  detectRealityDrift,
  rollbackConfiguration,
  createHumanOverride,
  captureRealitySnapshot,
  type SchoolBlueprint,
} from "@/lib/education-governance";

const TENANT_A = tenantId("tenant-a");
const TENANT_B = tenantId("tenant-b");
const NOW = "2026-08-21T10:00:00.000Z";

function makeGradingSystem(): GradingSystem {
  return {
    id: "grading-1" as never,
    tenantId: TENANT_A,
    name: "Standard",
    bands: [
      { label: "A", minScore: 70, maxScore: 100, gradePoint: 4, remark: "Excellent" },
      { label: "B", minScore: 60, maxScore: 69, gradePoint: 3, remark: "Good" },
      { label: "C", minScore: 50, maxScore: 59, gradePoint: 2, remark: "Average" },
      { label: "D", minScore: 40, maxScore: 49, gradePoint: 1, remark: "Pass" },
      { label: "F", minScore: 0, maxScore: 39, gradePoint: 0, remark: "Fail" },
    ],
    isDefault: true,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe("Phase 04 — Education Reality Engine", () => {
  describe("Tenant isolation (Section 134)", () => {
    it("rejects educational entities from a different tenant", () => {
      const subject = createSubject(
        {
          tenantId: TENANT_A,
          code: "MATH",
          name: "Mathematics",
          description: null,
          curriculumId: curriculumId("cur-1"),
          departmentRef: null,
          levelIds: [],
          learningObjectives: [],
          competencyIds: [],
          assessmentRefs: [],
          requiredFacilityTypes: [],
          requiredEquipmentRefs: [],
          requiredTeacherQualificationRefs: [],
          relatedSubjectIds: [],
        },
        [],
        NOW,
      );

      expect(subject.ok).toBe(true);
      if (subject.ok) {
        expect(subject.subject.tenantId).toBe(TENANT_A);
        expect(subject.subject.tenantId).not.toBe(TENANT_B);
      }
    });
  });

  describe("Curriculum engine (Sections 7–10)", () => {
    it("creates a curriculum version with audit event", () => {
      const result = createCurriculumVersion(
        {
          curriculumId: curriculumId("cur-1"),
          version: 1,
          effectiveFrom: "2026-01-01",
          effectiveUntil: null,
          authority: "Ministry of Education",
          source: "National Curriculum",
          applicability: "All levels",
          migrationRules: [],
          changedBy: "admin-1",
          reason: "Initial version",
        },
        [],
        TENANT_A,
        NOW,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.version.version).toBe(1);
        expect(result.version.isCurrent).toBe(true);
        expect(result.auditEvent.type).toBe("CurriculumVersioned");
        expect(result.auditEvent.tenantId).toBe(TENANT_A);
      }
    });

    it("rejects duplicate curriculum versions", () => {
      const existing: CurriculumVersion[] = [
        {
          id: "v1" as never,
          tenantId: TENANT_A,
          curriculumId: curriculumId("cur-1"),
          version: 1,
          effectiveFrom: "2026-01-01",
          effectiveUntil: null,
          revisionHistory: [],
          authority: "Ministry",
          source: "National",
          applicability: "All",
          migrationRules: [],
          isCurrent: true,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ];

      const result = createCurriculumVersion(
        {
          curriculumId: curriculumId("cur-1"),
          version: 1,
          effectiveFrom: "2026-01-01",
          effectiveUntil: null,
          authority: "Ministry",
          source: "National",
          applicability: "All",
          migrationRules: [],
          changedBy: "admin-1",
          reason: "Duplicate",
        },
        existing,
        TENANT_A,
        NOW,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("already exists");
      }
    });

    it("rejects curriculum version without authority", () => {
      const result = createCurriculumVersion(
        {
          curriculumId: curriculumId("cur-1"),
          version: 1,
          effectiveFrom: "2026-01-01",
          effectiveUntil: null,
          authority: "",
          source: "National",
          applicability: "All",
          migrationRules: [],
          changedBy: "admin-1",
          reason: "Test",
        },
        [],
        TENANT_A,
        NOW,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("authority");
      }
    });

    it("creates a subject with unique code", () => {
      const result = createSubject(
        {
          tenantId: TENANT_A,
          code: "MATH",
          name: "Mathematics",
          description: null,
          curriculumId: curriculumId("cur-1"),
          departmentRef: null,
          levelIds: [],
          learningObjectives: [],
          competencyIds: [],
          assessmentRefs: [],
          requiredFacilityTypes: [],
          requiredEquipmentRefs: [],
          requiredTeacherQualificationRefs: [],
          relatedSubjectIds: [],
        },
        [],
        NOW,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.subject.code).toBe("MATH");
        expect(result.subject.tenantId).toBe(TENANT_A);
      }
    });

    it("rejects duplicate subject codes", () => {
      const existing: Subject[] = [
        {
          id: "s1" as never,
          tenantId: TENANT_A,
          code: "MATH",
          name: "Mathematics",
          description: null,
          curriculumId: curriculumId("cur-1"),
          departmentRef: null,
          levelIds: [],
          learningObjectives: [],
          competencyIds: [],
          assessmentRefs: [],
          requiredFacilityTypes: [],
          requiredEquipmentRefs: [],
          requiredTeacherQualificationRefs: [],
          relatedSubjectIds: [],
          createdAt: NOW,
          updatedAt: NOW,
        },
      ];

      const result = createSubject(
        {
          tenantId: TENANT_A,
          code: "MATH",
          name: "Mathematics",
          description: null,
          curriculumId: curriculumId("cur-1"),
          departmentRef: null,
          levelIds: [],
          learningObjectives: [],
          competencyIds: [],
          assessmentRefs: [],
          requiredFacilityTypes: [],
          requiredEquipmentRefs: [],
          requiredTeacherQualificationRefs: [],
          relatedSubjectIds: [],
        },
        existing,
        NOW,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("already exists");
      }
    });

    it("creates a programme", () => {
      const result = createProgramme(
        {
          tenantId: TENANT_A,
          name: "Senior Secondary",
          code: "SS",
          purpose: "Senior secondary education",
          duration: "3 years",
          curriculumId: curriculumId("cur-1"),
          levelIds: [],
          requiredSubjectIds: [],
          optionalSubjectIds: [],
          competencyIds: [],
          assessmentRefs: [],
          progressionRules: [],
          certificationRequirements: [],
        },
        [],
        NOW,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.programme.code).toBe("SS");
        expect(result.programme.isActive).toBe(true);
      }
    });

    it("rejects programme without purpose", () => {
      const result = createProgramme(
        {
          tenantId: TENANT_A,
          name: "Test",
          code: "T",
          purpose: "",
          duration: "1 year",
          curriculumId: curriculumId("cur-1"),
          levelIds: [],
          requiredSubjectIds: [],
          optionalSubjectIds: [],
          competencyIds: [],
          assessmentRefs: [],
          progressionRules: [],
          certificationRequirements: [],
        },
        [],
        NOW,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("purpose");
      }
    });

    it("creates a competency", () => {
      const result = createCompetency(
        {
          tenantId: TENANT_A,
          name: "Critical Thinking",
          description: null,
          type: "academic",
          masteryStates: ["not_started", "developing", "competent", "proficient", "mastered"],
          evidenceRequirements: [],
          parentCompetencyId: null,
        },
        NOW,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.competency.type).toBe("academic");
        expect(result.competency.masteryStates).toContain("mastered");
      }
    });

    it("rejects competency without mastery states", () => {
      const result = createCompetency(
        {
          tenantId: TENANT_A,
          name: "Test",
          description: null,
          type: "academic",
          masteryStates: [],
          evidenceRequirements: [],
          parentCompetencyId: null,
        },
        NOW,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("mastery state");
      }
    });

    it("validates curriculum consistency", () => {
      const curriculum: Curriculum = {
        id: curriculumId("cur-1"),
        tenantId: TENANT_A,
        name: "National",
        code: "NAT",
        framework: "national",
        applicableCountry: "NG",
        description: null,
        isActive: true,
        createdAt: NOW,
        updatedAt: NOW,
      };

      const versions: CurriculumVersion[] = [
        {
          id: "v1" as never,
          tenantId: TENANT_A,
          curriculumId: curriculumId("cur-1"),
          version: 1,
          effectiveFrom: "2026-01-01",
          effectiveUntil: null,
          revisionHistory: [],
          authority: "Ministry",
          source: "National",
          applicability: "All",
          migrationRules: [],
          isCurrent: true,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ];

      const subjects: Subject[] = [
        {
          id: "s1" as never,
          tenantId: TENANT_A,
          code: "MATH",
          name: "Mathematics",
          description: null,
          curriculumId: curriculumId("cur-1"),
          departmentRef: null,
          levelIds: [],
          learningObjectives: [],
          competencyIds: [],
          assessmentRefs: [],
          requiredFacilityTypes: [],
          requiredEquipmentRefs: [],
          requiredTeacherQualificationRefs: [],
          relatedSubjectIds: [],
          createdAt: NOW,
          updatedAt: NOW,
        },
      ];

      const result = validateCurriculum(curriculum, versions, subjects);
      expect(result.valid).toBe(true);
    });

    it("detects curriculum with no current version", () => {
      const curriculum: Curriculum = {
        id: curriculumId("cur-1"),
        tenantId: TENANT_A,
        name: "National",
        code: "NAT",
        framework: "national",
        applicableCountry: "NG",
        description: null,
        isActive: true,
        createdAt: NOW,
        updatedAt: NOW,
      };

      const versions: CurriculumVersion[] = [
        {
          id: "v1" as never,
          tenantId: TENANT_A,
          curriculumId: curriculumId("cur-1"),
          version: 1,
          effectiveFrom: "2026-01-01",
          effectiveUntil: null,
          revisionHistory: [],
          authority: "Ministry",
          source: "National",
          applicability: "All",
          migrationRules: [],
          isCurrent: false,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ];

      const result = validateCurriculum(curriculum, versions, []);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Curriculum must have exactly one current version");
    });

    it("prevents superseding a curriculum with no versions (Section 178)", () => {
      const curriculum: Curriculum = {
        id: curriculumId("cur-1"),
        tenantId: TENANT_A,
        name: "National",
        code: "NAT",
        framework: "national",
        applicableCountry: "NG",
        description: null,
        isActive: true,
        createdAt: NOW,
        updatedAt: NOW,
      };

      const result = canSupersedeCurriculum(curriculum, []);
      expect(result.ok).toBe(false);
    });
  });

  describe("Institutional structure (Sections 22–29)", () => {
    it("creates a class", () => {
      const result = createClass(
        {
          tenantId: TENANT_A,
          name: "SS1A",
          levelId: educationalLevelId("level-1"),
          programmeId: programmeId("prog-1"),
          academicPeriodId: academicPeriodId("period-1"),
          campusId: campusId("campus-1"),
          roomId: null,
          subjectIds: [],
          streamId: null,
          shiftId: null,
        },
        [],
        NOW,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.class.name).toBe("SS1A");
        expect(result.class.isActive).toBe(true);
      }
    });

    it("rejects duplicate class names", () => {
      const existing: Class[] = [
        {
          id: "c1" as never,
          tenantId: TENANT_A,
          name: "SS1A",
          levelId: educationalLevelId("level-1"),
          programmeId: programmeId("prog-1"),
          academicPeriodId: academicPeriodId("period-1"),
          campusId: campusId("campus-1"),
          roomId: null,
          teacherAssignmentRefs: [],
          studentProfileIds: [],
          subjectIds: [],
          timetableRef: null,
          policyRefs: [],
          streamId: null,
          shiftId: null,
          isActive: true,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ];

      const result = createClass(
        {
          tenantId: TENANT_A,
          name: "SS1A",
          levelId: educationalLevelId("level-1"),
          programmeId: programmeId("prog-1"),
          academicPeriodId: academicPeriodId("period-1"),
          campusId: campusId("campus-1"),
          roomId: null,
          subjectIds: [],
          streamId: null,
          shiftId: null,
        },
        existing,
        NOW,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("already exists");
      }
    });

    it("enrols a student with audit event", () => {
      const result = enrolStudent(
        {
          tenantId: TENANT_A,
          studentProfileId: studentProfileId("student-1"),
          classId: classId("class-1"),
          programmeId: programmeId("prog-1"),
          academicPeriodId: academicPeriodId("period-1"),
          actorId: "admin-1",
        },
        [],
        NOW,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.enrolment.state).toBe("active");
        expect(result.auditEvent.type).toBe("StudentEnrolmentChanged");
      }
    });

    it("rejects double enrolment in same period (Section 170)", () => {
      const existing: StudentEnrolment[] = [
        {
          id: "e1",
          tenantId: TENANT_A,
          studentProfileId: studentProfileId("student-1"),
          classId: classId("class-1"),
          programmeId: programmeId("prog-1"),
          academicPeriodId: academicPeriodId("period-1"),
          enrolledAt: NOW,
          state: "active",
          transferHistory: [],
          createdAt: NOW,
          updatedAt: NOW,
        },
      ];

      const result = enrolStudent(
        {
          tenantId: TENANT_A,
          studentProfileId: studentProfileId("student-1"),
          classId: classId("class-2"),
          programmeId: programmeId("prog-1"),
          academicPeriodId: academicPeriodId("period-1"),
          actorId: "admin-1",
        },
        existing,
        NOW,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("already has an active enrolment");
      }
    });

    it("transfers a student with history", () => {
      const enrolment: StudentEnrolment = {
        id: "e1",
        tenantId: TENANT_A,
        studentProfileId: studentProfileId("student-1"),
        classId: classId("class-1"),
        programmeId: programmeId("prog-1"),
        academicPeriodId: academicPeriodId("period-1"),
        enrolledAt: NOW,
        state: "active",
        transferHistory: [],
        createdAt: NOW,
        updatedAt: NOW,
      };

      const result = transferStudent(
        {
          tenantId: TENANT_A,
          enrolmentId: "e1",
          toClassId: classId("class-2"),
          reason: "Academic placement",
          actorId: "admin-1",
        },
        enrolment,
        NOW,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.enrolment.classId).toBe(classId("class-2"));
        expect(result.enrolment.transferHistory).toHaveLength(1);
      }
    });

    it("rejects transfer without reason", () => {
      const enrolment: StudentEnrolment = {
        id: "e1",
        tenantId: TENANT_A,
        studentProfileId: studentProfileId("student-1"),
        classId: classId("class-1"),
        programmeId: programmeId("prog-1"),
        academicPeriodId: academicPeriodId("period-1"),
        enrolledAt: NOW,
        state: "active",
        transferHistory: [],
        createdAt: NOW,
        updatedAt: NOW,
      };

      const result = transferStudent(
        {
          tenantId: TENANT_A,
          enrolmentId: "e1",
          toClassId: classId("class-2"),
          reason: "",
          actorId: "admin-1",
        },
        enrolment,
        NOW,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("reason");
      }
    });

    it("detects conflicting enrolments (Section 170)", () => {
      const enrolments: StudentEnrolment[] = [
        {
          id: "e1",
          tenantId: TENANT_A,
          studentProfileId: studentProfileId("student-1"),
          classId: classId("class-1"),
          programmeId: programmeId("prog-1"),
          academicPeriodId: academicPeriodId("period-1"),
          enrolledAt: NOW,
          state: "active",
          transferHistory: [],
          createdAt: NOW,
          updatedAt: NOW,
        },
      ];

      expect(
        hasConflictingEnrolment(
          enrolments,
          studentProfileId("student-1"),
          academicPeriodId("period-1"),
        ),
      ).toBe(true);

      expect(
        hasConflictingEnrolment(
          enrolments,
          studentProfileId("student-2"),
          academicPeriodId("period-1"),
        ),
      ).toBe(false);
    });

    it("checks teacher assignment validity (Section 170)", () => {
      expect(isTeacherAssignmentActive({ validUntil: null }, NOW)).toBe(true);
      expect(isTeacherAssignmentActive({ validUntil: "2025-01-01" }, NOW)).toBe(false);
      expect(isTeacherAssignmentActive({ validUntil: "2027-01-01" }, NOW)).toBe(true);
    });
  });

  describe("Assessment engine (Sections 40–42)", () => {
    it("records a grade with audit event", () => {
      const result = recordGrade(
        {
          tenantId: TENANT_A,
          assessmentId: "assessment-1" as never,
          studentProfileId: studentProfileId("student-1"),
          score: 85,
          gradingSystem: makeGradingSystem(),
          recordedBy: "teacher-1",
          isAiGenerated: false,
        },
        NOW,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.grade).toBe("A");
        expect(result.auditEvent.type).toBe("GradeChanged");
      }
    });

    it("rejects AI-recorded grades (Section 117)", () => {
      const result = recordGrade(
        {
          tenantId: TENANT_A,
          assessmentId: "assessment-1" as never,
          studentProfileId: studentProfileId("student-1"),
          score: 85,
          gradingSystem: makeGradingSystem(),
          recordedBy: "ai-agent",
          isAiGenerated: true,
        },
        NOW,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("AI cannot record");
      }
    });

    it("rejects out-of-range scores", () => {
      const result = recordGrade(
        {
          tenantId: TENANT_A,
          assessmentId: "assessment-1" as never,
          studentProfileId: studentProfileId("student-1"),
          score: 150,
          gradingSystem: makeGradingSystem(),
          recordedBy: "teacher-1",
          isAiGenerated: false,
        },
        NOW,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("outside the grading range");
      }
    });

    it("makes a progression decision", () => {
      const result = makeProgressionDecision(
        {
          tenantId: TENANT_A,
          studentProfileId: studentProfileId("student-1"),
          fromLevelId: "level-1",
          toLevelId: "level-2",
          academicPeriodId: academicPeriodId("period-1"),
          decision: "promoted",
          reason: "Met all requirements",
          decidedBy: "admin-1",
        },
        NOW,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.record.decision).toBe("promoted");
        expect(result.auditEvent.type).toBe("PromotionDecision");
      }
    });

    it("rejects promotion without target level", () => {
      const result = makeProgressionDecision(
        {
          tenantId: TENANT_A,
          studentProfileId: studentProfileId("student-1"),
          fromLevelId: "level-1",
          toLevelId: null,
          academicPeriodId: academicPeriodId("period-1"),
          decision: "promoted",
          reason: "Test",
          decidedBy: "admin-1",
        },
        NOW,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("target level");
      }
    });

    it("validates grading system with no overlapping bands", () => {
      const result = validateGradingSystem(makeGradingSystem());
      expect(result.valid).toBe(true);
    });

    it("detects overlapping grade bands", () => {
      const system: GradingSystem = {
        id: "grading-2" as never,
        tenantId: TENANT_A,
        name: "Broken",
        bands: [
          { label: "A", minScore: 50, maxScore: 100, gradePoint: 4, remark: null },
          { label: "B", minScore: 40, maxScore: 60, gradePoint: 3, remark: null },
        ],
        isDefault: false,
        createdAt: NOW,
        updatedAt: NOW,
      };

      const result = validateGradingSystem(system);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("overlap"))).toBe(true);
    });
  });

  describe("Facilities engine (Sections 59–76)", () => {
    it("creates a facility", () => {
      const result = createFacility(
        {
          tenantId: TENANT_A,
          campusId: campusId("campus-1"),
          name: "Chemistry Lab",
          type: "laboratory",
          capacity: 30,
          capabilities: ["chemistry"],
          equipmentRefs: [],
        },
        [],
        NOW,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.facility.name).toBe("Chemistry Lab");
        expect(result.facility.state).toBe("operational");
      }
    });

    it("rejects duplicate facility names", () => {
      const result = createFacility(
        {
          tenantId: TENANT_A,
          campusId: campusId("campus-1"),
          name: "Chemistry Lab",
          type: "laboratory",
          capacity: 30,
          capabilities: [],
          equipmentRefs: [],
        },
        [{ name: "Chemistry Lab" }],
        NOW,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("already exists");
      }
    });

    it("marks a facility unavailable with reason", () => {
      const result = setFacilityAvailability(
        {
          tenantId: TENANT_A,
          facilityId: facilityId("facility-1"),
          state: "unavailable",
          reason: "Under renovation",
          effectiveFrom: NOW,
          effectiveUntil: null,
          requiresOverride: true,
          actorId: "admin-1",
        },
        NOW,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.availability.state).toBe("unavailable");
        expect(result.auditEvent.type).toBe("EducationalEntityUpdated");
      }
    });

    it("rejects marking unavailable without reason", () => {
      const result = setFacilityAvailability(
        {
          tenantId: TENANT_A,
          facilityId: facilityId("facility-1"),
          state: "unavailable",
          reason: null,
          effectiveFrom: NOW,
          effectiveUntil: null,
          requiresOverride: true,
          actorId: "admin-1",
        },
        NOW,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("reason");
      }
    });

    it("blocks scheduling unavailable facility without override (Section 170)", () => {
      const availability: FacilityAvailability = {
        id: "avail-1",
        tenantId: TENANT_A,
        facilityId: facilityId("facility-1"),
        state: "unavailable",
        reason: "Renovation",
        effectiveFrom: NOW,
        effectiveUntil: null,
        requiresOverride: true,
        createdAt: NOW,
        updatedAt: NOW,
      };

      expect(canScheduleFacility(availability, false).ok).toBe(false);
      expect(canScheduleFacility(availability, true).ok).toBe(true);
    });

    it("authorizes shared facility assignment (Section 92)", () => {
      const result = authorizeFacilityAssignment(
        {
          tenantId: TENANT_A,
          facilityId: facilityId("facility-1"),
          assignedToType: "programme",
          assignedToId: "prog-1",
          actorId: "admin-1",
        },
        NOW,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.assignment.authorized).toBe(true);
        expect(result.auditEvent.type).toBe("EducationalEntityCreated");
      }
    });
  });

  describe("Governance engine (Sections 81–85, 127–129, 164–168)", () => {
    it("creates a blueprint with audit event", () => {
      const result = createBlueprint(
        {
          tenantId: TENANT_A,
          version: 1,
          author: "admin-1",
          reason: "Initial configuration",
          configurationSnapshot: { campuses: [] },
          migrationImpact: null,
        },
        [],
        NOW,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.blueprint.version).toBe(1);
        expect(result.auditEvent.type).toBe("BlueprintVersioned");
      }
    });

    it("rejects duplicate blueprint versions", () => {
      const existing: SchoolBlueprint[] = [
        {
          id: "b1" as never,
          tenantId: TENANT_A,
          version: 1,
          author: "admin-1",
          reason: "Initial",
          validation: { valid: true, errors: [] },
          migrationImpact: null,
          configurationSnapshot: {},
          createdAt: NOW,
          updatedAt: NOW,
        },
      ];

      const result = createBlueprint(
        {
          tenantId: TENANT_A,
          version: 1,
          author: "admin-1",
          reason: "Duplicate",
          configurationSnapshot: {},
          migrationImpact: null,
        },
        existing,
        NOW,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("already exists");
      }
    });

    it("validates institutional configuration (Section 83)", () => {
      const result = validateInstitutionalConfiguration({
        campuses: [{ id: "campus-1", name: "Main", isActive: true }],
        buildings: [{ id: "building-1", campusId: "campus-1", name: "Block A" }],
        rooms: [{ id: "room-1", buildingId: "building-1", name: "R1", capacity: 30 }],
        classes: [
          {
            id: "class-1",
            name: "SS1A",
            campusId: "campus-1",
            roomId: "room-1",
            teacherAssignmentRefs: ["teacher-1"],
          },
        ],
        teachers: [{ id: "teacher-1", name: "Mr. Smith" }],
        subjects: [],
        policies: [],
      });

      expect(result.valid).toBe(true);
    });

    it("detects missing room references (Section 83)", () => {
      const result = validateInstitutionalConfiguration({
        campuses: [{ id: "campus-1", name: "Main", isActive: true }],
        buildings: [],
        rooms: [],
        classes: [
          {
            id: "class-1",
            name: "SS1A",
            campusId: "campus-1",
            roomId: "room-99",
            teacherAssignmentRefs: [],
          },
        ],
        teachers: [],
        subjects: [],
        policies: [],
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("missing room"))).toBe(true);
    });

    it("detects invalid room capacity (Section 83)", () => {
      const result = validateInstitutionalConfiguration({
        campuses: [{ id: "campus-1", name: "Main", isActive: true }],
        buildings: [{ id: "building-1", campusId: "campus-1", name: "Block A" }],
        rooms: [{ id: "room-1", buildingId: "building-1", name: "R1", capacity: 0 }],
        classes: [],
        teachers: [],
        subjects: [],
        policies: [],
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("invalid capacity"))).toBe(true);
    });

    it("detects missing teacher references (Section 83)", () => {
      const result = validateInstitutionalConfiguration({
        campuses: [{ id: "campus-1", name: "Main", isActive: true }],
        buildings: [],
        rooms: [],
        classes: [
          {
            id: "class-1",
            name: "SS1A",
            campusId: "campus-1",
            roomId: null,
            teacherAssignmentRefs: ["teacher-99"],
          },
        ],
        teachers: [],
        subjects: [],
        policies: [],
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("missing teacher"))).toBe(true);
    });

    it("creates a scenario (Section 84)", () => {
      const result = createScenario(
        {
          tenantId: TENANT_A,
          name: "Add second campus",
          type: "campus_addition",
          description: "What if we add another campus?",
          proposedChanges: { campuses: [{ name: "Campus B" }] },
          createdBy: "admin-1",
        },
        NOW,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.scenario.type).toBe("campus_addition");
        expect(result.scenario.isApproved).toBe(false);
      }
    });

    it("detects reality drift (Section 164)", () => {
      const drifts = detectRealityDrift(
        [
          { entityType: "facility", entityId: "lab-1", state: "available" },
          { entityType: "facility", entityId: "lab-2", state: "available" },
        ],
        [
          { entityType: "facility", entityId: "lab-1", state: "unavailable" },
          { entityType: "facility", entityId: "lab-2", state: "available" },
        ],
        NOW,
      );

      expect(drifts).toHaveLength(1);
      expect(drifts[0].entityId).toBe("lab-1");
      expect(drifts[0].configuredState).toBe("available");
      expect(drifts[0].operationalState).toBe("unavailable");
    });

    it("rolls back configuration (Section 129)", () => {
      const blueprints: SchoolBlueprint[] = [
        {
          id: "b1" as never,
          tenantId: TENANT_A,
          version: 1,
          author: "admin-1",
          reason: "Initial",
          validation: { valid: true, errors: [] },
          migrationImpact: null,
          configurationSnapshot: {},
          createdAt: NOW,
          updatedAt: NOW,
        },
        {
          id: "b2" as never,
          tenantId: TENANT_A,
          version: 2,
          author: "admin-1",
          reason: "Update",
          validation: { valid: true, errors: [] },
          migrationImpact: null,
          configurationSnapshot: {},
          createdAt: NOW,
          updatedAt: NOW,
        },
      ];

      const result = rollbackConfiguration(
        {
          tenantId: TENANT_A,
          blueprintId: "b2" as never,
          targetVersion: 1,
          actorId: "admin-1",
          reason: "Revert bad change",
        },
        blueprints,
        NOW,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.auditEvent.type).toBe("ConfigurationRolledBack");
      }
    });

    it("rejects rollback to non-existent version", () => {
      const result = rollbackConfiguration(
        {
          tenantId: TENANT_A,
          blueprintId: "b1" as never,
          targetVersion: 99,
          actorId: "admin-1",
          reason: "Test",
        },
        [],
        NOW,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("does not exist");
      }
    });

    it("creates a human override (Section 166)", () => {
      const result = createHumanOverride(
        {
          tenantId: TENANT_A,
          entityType: "facility",
          entityId: "lab-1",
          overrideType: "schedule_unavailable",
          reason: "Emergency practical session",
          authorizedBy: "principal-1",
          expiresAt: null,
        },
        NOW,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.override.authorizedBy).toBe("principal-1");
        expect(result.auditEvent.type).toBe("EducationalEntityCreated");
      }
    });

    it("rejects human override without reason", () => {
      const result = createHumanOverride(
        {
          tenantId: TENANT_A,
          entityType: "facility",
          entityId: "lab-1",
          overrideType: "schedule_unavailable",
          reason: "",
          authorizedBy: "principal-1",
          expiresAt: null,
        },
        NOW,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("reason");
      }
    });

    it("captures a reality snapshot (Section 127)", () => {
      const result = captureRealitySnapshot(
        {
          tenantId: TENANT_A,
          name: "Term 1 snapshot",
          configuration: { campuses: [{ name: "Main" }] },
          capturedBy: "admin-1",
        },
        NOW,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.snapshot.name).toBe("Term 1 snapshot");
        expect(result.snapshot.capturedBy).toBe("admin-1");
      }
    });
  });
});
