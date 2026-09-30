/**
 * CoreGrid Scholar — Cluster N tests part 2 (§98–109, 158).
 * Documents, evidence, competency/mastery, portfolios, co-curricular, import.
 */
import { describe, expect, it } from "vitest";
import { validateDocuments } from "@/lib/scholar/documents";
import {
  evidenceForStudent,
  latestEvidencePerKind,
  validateEvidence,
  type EvidenceItem,
} from "@/lib/scholar/evidence";
import {
  latestMastery,
  validateCompetencies,
  validateMasteryRecords,
  type MasteryRecord,
} from "@/lib/scholar/competency";
import {
  PORTFOLIO_ITEM_KINDS_BY_OWNER,
  validatePortfolio,
  type Portfolio,
} from "@/lib/scholar/portfolio";
import {
  validateClubs,
  validateCommunityEngagements,
  validateHouseActivities,
  validateSchoolEvents,
} from "@/lib/scholar/co-curricular";
import { validateImportJobs, validateImportRows } from "@/lib/scholar/school-import";

describe("documents (§98–99)", () => {
  it("accepts documents that reference their educational context", () => {
    const issues = validateDocuments([
      {
        id: "doc-1",
        studentId: "l-1",
        kind: "report_card",
        periodCode: "T1",
        classCohortId: "cls-1a",
      },
      { id: "doc-2", studentId: "l-1", kind: "transcript", issuedAt: "2026-07-31T00:00:00.000Z" },
    ]);
    expect(issues).toEqual([]);
  });

  it("rejects documents without student context (§99)", () => {
    const issues = validateDocuments([{ id: "doc-x", studentId: "", kind: "certificate" }]);
    expect(issues.join(" ")).toContain("studentId (educational context) is required");
  });
});

describe("evidence (§100–101)", () => {
  it("validates evidence items and groups per learner", () => {
    const items: EvidenceItem[] = [
      {
        id: "ev-1",
        studentId: "l-1",
        kind: "assignment",
        capturedAt: "2026-09-02T10:00:00.000Z",
        subjectCode: "MATH",
      },
      { id: "ev-2", studentId: "l-1", kind: "practical", capturedAt: "2026-09-03T10:00:00.000Z" },
      { id: "ev-3", studentId: "l-2", kind: "exam", capturedAt: "2026-09-03T10:00:00.000Z" },
    ];
    expect(validateEvidence(items)).toEqual([]);
    expect(evidenceForStudent(items, "l-1")).toHaveLength(2);
    expect(latestEvidencePerKind(items, "l-1").get("assignment")?.id).toBe("ev-1");
  });

  it("rejects duplicates and unknown kinds", () => {
    const issues = validateEvidence([
      {
        id: "ev-x",
        studentId: "l-1",
        kind: "video" as never,
        capturedAt: "2026-09-03T10:00:00.000Z",
      },
    ]);
    expect(issues.join(" ")).toContain("kind must be one of");
  });
});

describe("competency/mastery (§102–103)", () => {
  it("accepts every competency domain and mastery state", () => {
    const competencies = validateCompetencies([
      { code: "C-ACAD", name: "Numeracy", domain: "academic" },
      { code: "C-VOC", name: "Welding", domain: "vocational" },
    ]);
    expect(competencies).toEqual([]);

    const masteryRecords: MasteryRecord[] = [
      {
        studentId: "l-1",
        competencyCode: "C-VOC",
        level: "proficient",
        assessedAt: "2026-09-03T10:00:00.000Z",
      },
      {
        studentId: "l-1",
        competencyCode: "C-VOC",
        level: "mastered",
        assessedAt: "2026-09-10T10:00:00.000Z",
      },
    ];
    const records = validateMasteryRecords(masteryRecords);
    expect(records).toEqual([]);
    expect(latestMastery(masteryRecords, "l-1", "C-VOC")).toBe("mastered");
  });

  it("rejects unknown domains and mastery levels", () => {
    const badDomain = validateCompetencies([
      { code: "C-X", name: "X", domain: "mystical" as never },
    ]);
    expect(badDomain.join(" ")).toContain("domain must be one of");
    const badLevel = validateMasteryRecords([
      {
        studentId: "l-1",
        competencyCode: "C-X",
        level: "ascended" as never,
        assessedAt: "2026-09-03T10:00:00.000Z",
      },
    ]);
    expect(badLevel.join(" ")).toContain("level must be one of");
  });
});

describe("portfolios (§104–105)", () => {
  it("accepts student and teacher portfolios with owner-appropriate kinds", () => {
    const studentPortfolio: Portfolio = {
      ownerId: "l-1",
      ownerKind: "student",
      items: [
        { id: "pi-1", kind: "project", capturedAt: "2026-09-01T00:00:00.000Z" },
        { id: "pi-2", kind: "practical_evidence", capturedAt: "2026-09-02T00:00:00.000Z" },
      ],
    };
    expect(validatePortfolio(studentPortfolio)).toEqual([]);

    const teacherPortfolio: Portfolio = {
      ownerId: "ident-t1",
      ownerKind: "teacher",
      items: [
        { id: "tp-1", kind: "qualification", capturedAt: "2020-05-01T00:00:00.000Z" },
        { id: "tp-2", kind: "professional_development", capturedAt: "2026-08-01T00:00:00.000Z" },
      ],
    };
    expect(validatePortfolio(teacherPortfolio)).toEqual([]);
    expect(PORTFOLIO_ITEM_KINDS_BY_OWNER.teacher).toContain("qualification");
  });

  it("rejects kinds that do not fit the owner", () => {
    const wrongKind: Portfolio = {
      ownerId: "l-1",
      ownerKind: "student",
      items: [{ id: "pi-x", kind: "qualification", capturedAt: "2026-09-01T00:00:00.000Z" }],
    };
    const issues = validatePortfolio(wrongKind);
    expect(issues.join(" ")).toContain("not valid for a student portfolio");
  });
});

describe("co-curricular (§106–109)", () => {
  it("accepts events, clubs, houses and community engagement", () => {
    expect(
      validateSchoolEvents([
        { id: "evt-1", kind: "sports", name: "Inter-house sports day", date: "2026-11-20" },
        { id: "evt-2", kind: "religious", name: "Eid assembly" },
      ]),
    ).toEqual([]);
    expect(
      validateClubs([
        { id: "club-1", name: "Debating Society", kind: "academic" },
        { id: "club-2", name: "Robotics", kind: "technology" },
      ]),
    ).toEqual([]);
    expect(
      validateHouseActivities([{ id: "ha-1", houseId: "house-eagle", activityRef: "football" }]),
    ).toEqual([]);
    expect(
      validateCommunityEngagements([
        { id: "ce-1", kind: "service_learning", name: "Market cleanup", partner: "Local council" },
      ]),
    ).toEqual([]);
  });

  it("rejects unknown club kinds and events", () => {
    expect(
      validateClubs([{ id: "club-x", name: "X", kind: "gambling" as never }]).join(" "),
    ).toContain("kind must be one of");
  });
});

describe("school-import (§158)", () => {
  it("validates import jobs from every source type", () => {
    const issues = validateImportJobs([
      {
        id: "imp-1",
        source: "csv",
        scope: "levels",
        payloadRef: "file:levels.csv",
        status: "queued",
      },
      {
        id: "imp-2",
        source: "government",
        scope: "students",
        payloadRef: "api:gov-export",
        status: "queued",
      },
      {
        id: "imp-3",
        source: "manual",
        scope: "classes",
        payloadRef: "form:builder",
        status: "queued",
      },
    ]);
    expect(issues).toEqual([]);
  });

  it("rejects rows outside the job scope instead of dropping them", () => {
    const issues = validateImportRows(
      [
        { scope: "levels", values: { code: "L1", name: "Lower Primary" } },
        { scope: "programmes", values: { code: "P1" } },
      ],
      "levels",
    );
    expect(issues.join(" ")).toContain("does not match job scope");
  });

  it("flags duplicate identities across import rows", () => {
    const issues = validateImportRows(
      [
        { scope: "subjects", values: { code: "MATH" } },
        { scope: "subjects", values: { code: "MATH" } },
      ],
      "subjects",
    );
    expect(issues.join(" ")).toContain("duplicate identity");
  });
});
