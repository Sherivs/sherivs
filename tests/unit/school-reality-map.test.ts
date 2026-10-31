/**
 * School Reality Intelligence Map — exact public copy, eight branches,
 * and the hero illustration it replaces.
 *
 * The generational subject is "The Sherivs Scholar direction" because the
 * platform narration guard rejects the specified possessive form.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  SCHOOL_REALITY_BRANCHES,
  SCHOOL_REALITY_CAPABILITIES,
  SCHOOL_REALITY_FLOW,
  SCHOOL_REALITY_GENERATIONS,
  SCHOOL_REALITY_MAP,
  SCHOOL_REALITY_PATHS,
  relatedBranchIds,
  tracedPathForBranch,
} from "@/lib/public-site/school-reality-map";
import {
  labelOverlaps,
  organismLayout,
  strokeHits,
} from "@/lib/public-site/school-reality-organism";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (ref: string) => readFileSync(join(ROOT, ref), "utf8");

const NARRATION =
  /CoreGrid Scholar|Scholar's|Scholar is|Scholar consumes|Scholar binds|Scholar resolves|Scholar remains|Scholar-only|Scholar-flavored|Scholar catalog|Scholar runtime \(runtime-001\)/;

describe("School Reality Intelligence Map copy", () => {
  it("uses the exact intro, centre, caption, and honesty line", () => {
    expect(SCHOOL_REALITY_MAP.introTitle).toBe("A school is more than a database.");
    expect(SCHOOL_REALITY_MAP.introBody).toBe(
      "People, learning, operations, places, events, and decisions form one living institution. Sherivs Scholar brings that reality into a connected digital operating environment.",
    );
    expect(SCHOOL_REALITY_MAP.centreTitle).toBe("SCHOOL REALITY");
    expect(SCHOOL_REALITY_MAP.centreBody).toBe(
      "One living institution. Thousands of connected activities.",
    );
    expect(SCHOOL_REALITY_MAP.caption).toBe(
      "From isolated records to connected institutional reality.",
    );
    expect(SCHOOL_REALITY_MAP.honesty).toBe(
      "This is a diagram, not a live product screen, and it does not show a separate application for every role.",
    );
  });

  it("publishes eight branches with the specified headings, labels, and microcopy", () => {
    expect(SCHOOL_REALITY_BRANCHES.map((branch) => `${branch.index} ${branch.heading}`)).toEqual([
      "01 PEOPLE & RELATIONSHIPS",
      "02 TEACHING & LEARNING",
      "03 DAILY OPERATIONS & WORKFLOWS",
      "04 HEALTH, SAFETY & WELLBEING",
      "05 FINANCE & RESOURCES",
      "06 PLACES & ENVIRONMENTS",
      "07 EVENTS, TIME & CHANGE",
      "08 GOVERNANCE, RECORDS & DECISIONS",
    ]);
    expect(SCHOOL_REALITY_BRANCHES.find((branch) => branch.id === "people")?.labels).toEqual([
      "School leadership",
      "Administrators",
      "Teachers",
      "Students",
      "Parents & guardians",
      "Nurses & health staff",
      "Drivers & transport staff",
      "Boarding & hostel staff",
      "Bursars & finance staff",
      "Librarians & support staff",
    ]);
    expect(SCHOOL_REALITY_BRANCHES.find((branch) => branch.id === "teaching")?.labels).toEqual([
      "Lesson planning",
      "Timetables & class allocation",
      "Classroom teaching",
      "Assignments & assessments",
      "Student progress",
      "Learning difficulties",
      "Targeted interventions",
      "Tutoring & revision",
      "Academic guidance",
      "Career development",
    ]);
    expect(SCHOOL_REALITY_BRANCHES.find((branch) => branch.id === "operations")?.labels).toEqual([
      "Admissions & enrolment",
      "Attendance & punctuality",
      "Staff assignments",
      "Approvals & authorizations",
      "Internal requests",
      "Task handoffs",
      "Scheduling",
      "Incident escalation",
      "Daily operational coordination",
    ]);
    expect(SCHOOL_REALITY_BRANCHES.find((branch) => branch.id === "health")?.labels).toEqual([
      "School health services",
      "Nurse assessments",
      "Student wellbeing",
      "Safeguarding workflows",
      "Incident reports",
      "Emergency responses",
      "Authorized health notifications",
      "Intervention follow-ups",
    ]);
    expect(SCHOOL_REALITY_BRANCHES.find((branch) => branch.id === "finance")?.labels).toEqual([
      "School fees",
      "Payments & reconciliation",
      "Budgets & expenditure",
      "Staff payroll workflows",
      "Procurement",
      "Inventory",
      "Equipment & supplies",
      "Resource allocation",
    ]);
    expect(SCHOOL_REALITY_BRANCHES.find((branch) => branch.id === "places")?.labels).toEqual([
      "Classrooms",
      "Laboratories",
      "Libraries",
      "Offices",
      "Sports facilities",
      "Boarding houses",
      "School buses",
      "Campuses & premises",
      "Equipment & physical assets",
    ]);
    expect(SCHOOL_REALITY_BRANCHES.find((branch) => branch.id === "events")?.labels).toEqual([
      "Academic calendars",
      "Examinations",
      "School assemblies",
      "Meetings",
      "School trips",
      "Parent\u2013teacher conferences",
      "Deadlines",
      "Emergencies",
      "Term transitions",
      "Academic session changes",
    ]);
    expect(SCHOOL_REALITY_BRANCHES.find((branch) => branch.id === "governance")?.labels).toEqual([
      "Policies & permissions",
      "Student records",
      "Staff records",
      "Academic results",
      "Approvals & decisions",
      "Communications",
      "Audit trails",
      "Institutional reports",
      "Compliance workflows",
      "Historical context",
    ]);
    expect(SCHOOL_REALITY_BRANCHES.map((branch) => branch.microcopy)).toEqual([
      "Every person has a role, relationships, responsibilities, and a place within the institution.",
      "Learning connects teaching, progress, individual needs, and timely intervention.",
      "Work moves through people, decisions, deadlines, and responsibilities.",
      "Care depends on context, responsible people, timely action, and appropriate access.",
      "Financial activity connects obligations, resources, transactions, and accountability.",
      "A school operates across physical spaces, facilities, assets, and changing conditions.",
      "Institutions evolve through events, schedules, transitions, and decisions.",
      "Reliable decisions depend on accurate records, authority, context, and traceable actions.",
    ]);
  });

  it("keeps boundary notes for people, health, places, and records", () => {
    expect(SCHOOL_REALITY_BRANCHES.find((branch) => branch.id === "people")?.boundary).toMatch(
      /Not every school employs every role/,
    );
    expect(SCHOOL_REALITY_BRANCHES.find((branch) => branch.id === "health")?.boundary).toMatch(
      /strict access boundaries/,
    );
    expect(SCHOOL_REALITY_BRANCHES.find((branch) => branch.id === "places")?.boundary).toMatch(
      /One campus or several/,
    );
    expect(SCHOOL_REALITY_BRANCHES.find((branch) => branch.id === "governance")?.boundary).toMatch(
      /not the whole institution/,
    );
  });

  it("draws five paths between preview activity nodes and keeps strokes off the labels", () => {
    for (const branch of SCHOOL_REALITY_BRANCHES) {
      expect(branch.headingLines.join(" ")).toBe(branch.heading);
      expect(branch.previewLabels.length).toBeGreaterThanOrEqual(3);
      expect(branch.previewLabels.length).toBeLessThanOrEqual(5);
      for (const label of branch.previewLabels) expect(branch.labels).toContain(label);
    }
    const attendance = SCHOOL_REALITY_PATHS.find((path) => path.id === "attendance");
    expect(attendance?.anchors.map((anchor) => anchor.label)).toEqual([
      "Attendance & punctuality",
      "Student progress",
      "Targeted interventions",
      "Parents & guardians",
    ]);
    expect(SCHOOL_REALITY_PATHS).toHaveLength(5);
    for (const path of SCHOOL_REALITY_PATHS) {
      expect(path.anchors.length).toBeGreaterThanOrEqual(3);
      for (const anchor of path.anchors) {
        const branch = SCHOOL_REALITY_BRANCHES.find((item) => item.id === anchor.branchId);
        expect(branch?.previewLabels, `${path.id} ${anchor.label}`).toContain(anchor.label);
      }
    }
    const layout = organismLayout();
    expect(layout.curves.filter((curve) => curve.kind === "arc")).toHaveLength(5);
    expect(layout.curves.filter((curve) => curve.kind === "trunk")).toHaveLength(8);
    expect(labelOverlaps(layout)).toEqual([]);
    expect(strokeHits(layout)).toEqual([]);
    expect(layout.clearOfLabels).toBe(true);
  });

  it("traces a small set of meaningful paths instead of a complete mesh", () => {
    expect(SCHOOL_REALITY_PATHS).toHaveLength(5);
    expect([...relatedBranchIds("people")].sort()).toEqual(["operations", "teaching"]);
    expect([...relatedBranchIds("health")].sort()).toEqual(["governance", "people"]);
    expect(tracedPathForBranch("events")?.id).toBe("examination");
    expect(tracedPathForBranch("places")?.branchIds).toContain("places");
    for (const branch of SCHOOL_REALITY_BRANCHES) {
      expect(tracedPathForBranch(branch.id)?.branchIds).toContain(branch.id);
      expect(relatedBranchIds(branch.id)).not.toContain(branch.id);
      expect(relatedBranchIds(branch.id).length).toBeLessThan(SCHOOL_REALITY_BRANCHES.length - 1);
    }
  });

  it("states the digital layer, product label, and in-development direction", () => {
    expect(SCHOOL_REALITY_MAP.digitalTitle).toBe(
      "ONE INSTITUTIONAL REALITY. ONE CONNECTED DIGITAL ENVIRONMENT.",
    );
    expect(SCHOOL_REALITY_FLOW.map((step) => step.label)).toEqual([
      "Real school operations",
      "Connected institutional context",
      "Role-aware intelligence",
      "Governed digital action",
    ]);
    expect(
      SCHOOL_REALITY_FLOW.find((step) => step.label === "Role-aware intelligence")?.inDevelopment,
    ).toBe(true);
    expect(SCHOOL_REALITY_CAPABILITIES.map((item) => [item.title, item.body])).toEqual([
      [
        "Shared context",
        "People, activities, responsibilities, and records remain meaningfully connected.",
      ],
      [
        "Role-aware intelligence",
        "Assistance adapts to the person's responsibilities, authorized information, and current task.",
      ],
      ["Coordinated execution", "Supported workflows connect actions, handoffs, and follow-up."],
      [
        "Governed operations",
        "Access, decisions, and sensitive actions remain subject to appropriate permissions and oversight.",
      ],
    ]);
    expect(
      SCHOOL_REALITY_CAPABILITIES.filter((item) => item.inDevelopment).map((item) => item.id),
    ).toEqual(["role-aware", "coordinated"]);
    expect(SCHOOL_REALITY_MAP.productName).toBe("SHERIVS SCHOLAR");
    expect(SCHOOL_REALITY_MAP.productTagline).toBe("Reality intelligence for school operations.");
    expect(SCHOOL_REALITY_MAP.digitalDirection).toMatch(/in development/);
  });

  it("places the generational shift as Sherivs positioning, without a forbidden possessive", () => {
    expect(SCHOOL_REALITY_GENERATIONS.map((generation) => generation.kicker)).toEqual([
      "GENERATION 01 — SYSTEMS OF RECORD",
      "GENERATION 04 — REALITY INTELLIGENCE",
    ]);
    expect(SCHOOL_REALITY_GENERATIONS[0]?.subject).toBe("School management systems");
    expect(SCHOOL_REALITY_GENERATIONS[0]?.body).toBe(
      "Digitize administrative records and predefined workflows.",
    );
    expect(SCHOOL_REALITY_GENERATIONS[0]?.examples).toEqual([
      "Student databases",
      "Attendance records",
      "Fees and results",
      "Administrative reports",
    ]);
    expect(SCHOOL_REALITY_GENERATIONS[1]?.subject).toBe("The Sherivs Scholar direction");
    expect(SCHOOL_REALITY_GENERATIONS[1]?.body).toBe(
      "Connect institutional context, people, processes, events, and governed intelligence in one operating environment.",
    );
    expect(SCHOOL_REALITY_GENERATIONS[1]?.examples).toEqual([
      "Connected school operations",
      "Role-aware assistance",
      "Contextual recommendations",
      "Coordinated workflows",
      "Institution-wide visibility within authorized boundaries",
    ]);
    expect(SCHOOL_REALITY_MAP.progression).toBe(
      "From recording what happened to helping coordinate what happens next.",
    );
    expect(SCHOOL_REALITY_MAP.positioning).toMatch(/Sherivs positioning, not an industry standard/);
    expect(SCHOOL_REALITY_GENERATIONS[1]?.subject).not.toMatch(/Scholar's/);
  });

  it("keeps the narration guard clean in the public map sources", () => {
    for (const ref of [
      "frontend/src/lib/public-site/school-reality-map.ts",
      "frontend/src/components/public/school-reality-intelligence-map.tsx",
      "frontend/src/components/public/sherivs-home.tsx",
    ]) {
      expect(read(ref), ref).not.toMatch(NARRATION);
    }
  });
});

describe("Homepage placement", () => {
  const home = read("frontend/src/components/public/sherivs-home.tsx");
  const hero = home.slice(
    home.indexOf("function HeroSection"),
    home.indexOf("function OrganizationSection"),
  );

  it("removes the hero institutional diagram and renders the map directly after the hero", () => {
    expect(hero).not.toContain("InstitutionFigure");
    expect(hero).toContain("SCHOLAR_HERO.primaryHref");
    expect(hero).toContain("SCHOLAR_HERO.secondaryHref");
    expect(home.indexOf("<SchoolRealityIntelligenceMap />")).toBeGreaterThan(
      home.indexOf("<HeroSection />"),
    );
    expect(home.indexOf("<SchoolRealityIntelligenceMap />")).toBeLessThan(
      home.indexOf("<OrganizationSection />"),
    );
  });

  it("leaves the workspace section's own diagram in place", () => {
    const workspace = home.slice(
      home.indexOf("function WorkspaceSection"),
      home.indexOf("function GovernanceSection"),
    );
    expect(workspace).toContain("<InstitutionFigure />");
  });
});
