/**
 * Copy and structure for the public School Reality Intelligence Map.
 *
 * An explanatory marketing illustration. It is not a claim that every
 * depicted activity, workflow, or assistance capability is deployed.
 *
 * The generational subject is "The Sherivs Scholar direction" so the
 * platform narration guard stays clean.
 */

export interface SchoolRealityBranch {
  id: string;
  index: string;
  heading: string;
  /** Two visual lines that join, with a space, back to `heading`. */
  headingLines: readonly [string, string];
  side: "left" | "right";
  labels: readonly string[];
  /** Three to five labels drawn on the organism before a branch is opened. */
  previewLabels: readonly string[];
  microcopy: string;
  /** Short boundary note. Does not replace the exact microcopy. */
  boundary?: string;
  /** The one cross-domain path drawn when this branch is selected. */
  tracePathId: string;
}

export interface SchoolRealityAnchor {
  branchId: string;
  label: string;
}

export interface SchoolRealityPath {
  id: string;
  title: string;
  body: string;
  branchIds: readonly string[];
  /** Activity nodes the drawn arc actually connects, in order. */
  anchors: readonly SchoolRealityAnchor[];
}

export interface SchoolRealityCapability {
  id: string;
  title: string;
  body: string;
  /** Product direction. Must not be presented as a shipped feature. */
  inDevelopment: boolean;
}

export interface SchoolRealityFlowStep {
  index: string;
  label: string;
  inDevelopment: boolean;
}

export interface SchoolRealityGeneration {
  id: string;
  kicker: string;
  subject: string;
  body: string;
  examples: readonly string[];
}

export const SCHOOL_REALITY_MAP = {
  introTitle: "A school is more than a database.",
  introBody:
    "People, learning, operations, places, events, and decisions form one living institution. Sherivs Scholar brings that reality into a connected digital operating environment.",
  centreTitle: "SCHOOL REALITY",
  centreBody: "One living institution. Thousands of connected activities.",
  caption: "From isolated records to connected institutional reality.",
  honesty:
    "This is a diagram, not a live product screen, and it does not show a separate application for every role.",
  description:
    "Explanatory diagram of a school as one living institution. Eight operational domains branch into activities and converge in one connected environment. Not a live product screen.",
  pathwaysTitle: "Cross-domain paths",
  pathwaysLead: "A few real paths. Not every domain connects to every other.",
  digitalTitle: "ONE INSTITUTIONAL REALITY. ONE CONNECTED DIGITAL ENVIRONMENT.",
  digitalDirection:
    "Role-aware intelligence and coordinated execution are the product direction and are in development.",
  productName: "SHERIVS SCHOLAR",
  productTagline: "Reality intelligence for school operations.",
  progression: "From recording what happened to helping coordinate what happens next.",
  positioning:
    "Sherivs positioning, not an industry standard. The distinction is the primary operating model.",
} as const;

export const SCHOOL_REALITY_BRANCHES: readonly SchoolRealityBranch[] = [
  {
    id: "people",
    index: "01",
    heading: "PEOPLE & RELATIONSHIPS",
    headingLines: ["PEOPLE &", "RELATIONSHIPS"],
    side: "left",
    tracePathId: "attendance",
    previewLabels: ["School leadership", "Teachers", "Students", "Parents & guardians"],
    microcopy:
      "Every person has a role, relationships, responsibilities, and a place within the institution.",
    boundary: "Not every school employs every role.",
    labels: [
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
    ],
  },
  {
    id: "teaching",
    index: "02",
    heading: "TEACHING & LEARNING",
    headingLines: ["TEACHING &", "LEARNING"],
    side: "left",
    tracePathId: "examination",
    previewLabels: [
      "Classroom teaching",
      "Assignments & assessments",
      "Student progress",
      "Targeted interventions",
    ],
    microcopy: "Learning connects teaching, progress, individual needs, and timely intervention.",
    labels: [
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
    ],
  },
  {
    id: "operations",
    index: "03",
    heading: "DAILY OPERATIONS & WORKFLOWS",
    headingLines: ["DAILY OPERATIONS", "& WORKFLOWS"],
    side: "left",
    tracePathId: "attendance",
    previewLabels: [
      "Admissions & enrolment",
      "Attendance & punctuality",
      "Staff assignments",
      "Scheduling",
    ],
    microcopy: "Work moves through people, decisions, deadlines, and responsibilities.",
    labels: [
      "Admissions & enrolment",
      "Attendance & punctuality",
      "Staff assignments",
      "Approvals & authorizations",
      "Internal requests",
      "Task handoffs",
      "Scheduling",
      "Incident escalation",
      "Daily operational coordination",
    ],
  },
  {
    id: "health",
    index: "04",
    heading: "HEALTH, SAFETY & WELLBEING",
    headingLines: ["HEALTH, SAFETY", "& WELLBEING"],
    side: "left",
    tracePathId: "health-incident",
    previewLabels: [
      "Nurse assessments",
      "Incident reports",
      "Safeguarding workflows",
      "Intervention follow-ups",
    ],
    microcopy:
      "Care depends on context, responsible people, timely action, and appropriate access.",
    boundary: "Health and safeguarding stay within strict access boundaries.",
    labels: [
      "School health services",
      "Nurse assessments",
      "Student wellbeing",
      "Safeguarding workflows",
      "Incident reports",
      "Emergency responses",
      "Authorized health notifications",
      "Intervention follow-ups",
    ],
  },
  {
    id: "finance",
    index: "05",
    heading: "FINANCE & RESOURCES",
    headingLines: ["FINANCE &", "RESOURCES"],
    side: "right",
    tracePathId: "campus",
    previewLabels: [
      "School fees",
      "Payments & reconciliation",
      "Budgets & expenditure",
      "Resource allocation",
    ],
    microcopy:
      "Financial activity connects obligations, resources, transactions, and accountability.",
    labels: [
      "School fees",
      "Payments & reconciliation",
      "Budgets & expenditure",
      "Staff payroll workflows",
      "Procurement",
      "Inventory",
      "Equipment & supplies",
      "Resource allocation",
    ],
  },
  {
    id: "places",
    index: "06",
    heading: "PLACES & ENVIRONMENTS",
    headingLines: ["PLACES &", "ENVIRONMENTS"],
    side: "right",
    tracePathId: "campus",
    previewLabels: ["Classrooms", "Boarding houses", "School buses", "Campuses & premises"],
    microcopy:
      "A school operates across physical spaces, facilities, assets, and changing conditions.",
    boundary: "One campus or several can belong to the same institution.",
    labels: [
      "Classrooms",
      "Laboratories",
      "Libraries",
      "Offices",
      "Sports facilities",
      "Boarding houses",
      "School buses",
      "Campuses & premises",
      "Equipment & physical assets",
    ],
  },
  {
    id: "events",
    index: "07",
    heading: "EVENTS, TIME & CHANGE",
    headingLines: ["EVENTS, TIME", "& CHANGE"],
    side: "right",
    tracePathId: "examination",
    previewLabels: ["Academic calendars", "Examinations", "School trips", "Deadlines"],
    microcopy: "Institutions evolve through events, schedules, transitions, and decisions.",
    labels: [
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
    ],
  },
  {
    id: "governance",
    index: "08",
    heading: "GOVERNANCE, RECORDS & DECISIONS",
    headingLines: ["GOVERNANCE,", "RECORDS & DECISIONS"],
    side: "right",
    tracePathId: "examination",
    previewLabels: [
      "Policies & permissions",
      "Student records",
      "Academic results",
      "Communications",
      "Institutional reports",
    ],
    microcopy:
      "Reliable decisions depend on accurate records, authority, context, and traceable actions.",
    boundary: "Records support the institution. They are not the whole institution.",
    labels: [
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
    ],
  },
];

export const SCHOOL_REALITY_PATHS: readonly SchoolRealityPath[] = [
  {
    id: "attendance",
    title: "Attendance",
    body: "Attendance leads to teacher follow-up, parent notification, and intervention.",
    branchIds: ["operations", "teaching", "people"],
    anchors: [
      { branchId: "operations", label: "Attendance & punctuality" },
      { branchId: "teaching", label: "Student progress" },
      { branchId: "teaching", label: "Targeted interventions" },
      { branchId: "people", label: "Parents & guardians" },
    ],
  },
  {
    id: "examination",
    title: "Examination",
    body: "An examination connects teaching, progress, scheduling, records, and reporting.",
    branchIds: ["events", "teaching", "operations", "governance"],
    anchors: [
      { branchId: "events", label: "Examinations" },
      { branchId: "teaching", label: "Student progress" },
      { branchId: "operations", label: "Scheduling" },
      { branchId: "governance", label: "Academic results" },
      { branchId: "governance", label: "Institutional reports" },
    ],
  },
  {
    id: "trip",
    title: "School trip",
    body: "A school trip connects events, transport, staff assignments, permissions, safety, and communication.",
    branchIds: ["events", "places", "operations", "people", "health", "governance"],
    anchors: [
      { branchId: "events", label: "School trips" },
      { branchId: "places", label: "School buses" },
      { branchId: "operations", label: "Staff assignments" },
      { branchId: "governance", label: "Policies & permissions" },
      { branchId: "health", label: "Safeguarding workflows" },
      { branchId: "governance", label: "Communications" },
    ],
  },
  {
    id: "health-incident",
    title: "Health incident",
    body: "A health incident connects the student, authorized health personnel, safeguarding, and follow-up.",
    branchIds: ["health", "people", "governance"],
    anchors: [
      { branchId: "health", label: "Incident reports" },
      { branchId: "health", label: "Nurse assessments" },
      { branchId: "people", label: "Students" },
      { branchId: "health", label: "Safeguarding workflows" },
      { branchId: "governance", label: "Policies & permissions" },
    ],
  },
  {
    id: "campus",
    title: "New campus",
    body: "A new campus connects premises, people, schedules, resources, and administration.",
    branchIds: ["places", "people", "events", "finance", "operations"],
    anchors: [
      { branchId: "places", label: "Campuses & premises" },
      { branchId: "people", label: "School leadership" },
      { branchId: "events", label: "Academic calendars" },
      { branchId: "finance", label: "Resource allocation" },
      { branchId: "operations", label: "Admissions & enrolment" },
    ],
  },
];

export const SCHOOL_REALITY_FLOW: readonly SchoolRealityFlowStep[] = [
  { index: "01", label: "Real school operations", inDevelopment: false },
  { index: "02", label: "Connected institutional context", inDevelopment: false },
  { index: "03", label: "Role-aware intelligence", inDevelopment: true },
  { index: "04", label: "Governed digital action", inDevelopment: false },
];

export const SCHOOL_REALITY_CAPABILITIES: readonly SchoolRealityCapability[] = [
  {
    id: "shared-context",
    title: "Shared context",
    body: "People, activities, responsibilities, and records remain meaningfully connected.",
    inDevelopment: false,
  },
  {
    id: "role-aware",
    title: "Role-aware intelligence",
    body: "Assistance adapts to the person's responsibilities, authorized information, and current task.",
    inDevelopment: true,
  },
  {
    id: "coordinated",
    title: "Coordinated execution",
    body: "Supported workflows connect actions, handoffs, and follow-up.",
    inDevelopment: true,
  },
  {
    id: "governed",
    title: "Governed operations",
    body: "Access, decisions, and sensitive actions remain subject to appropriate permissions and oversight.",
    inDevelopment: false,
  },
];

export const SCHOOL_REALITY_GENERATIONS: readonly SchoolRealityGeneration[] = [
  {
    id: "record",
    kicker: "GENERATION 01 — SYSTEMS OF RECORD",
    subject: "School management systems",
    body: "Digitize administrative records and predefined workflows.",
    examples: [
      "Student databases",
      "Attendance records",
      "Fees and results",
      "Administrative reports",
    ],
  },
  {
    id: "reality",
    kicker: "GENERATION 04 — REALITY INTELLIGENCE",
    subject: "The Sherivs Scholar direction",
    body: "Connect institutional context, people, processes, events, and governed intelligence in one operating environment.",
    examples: [
      "Connected school operations",
      "Role-aware assistance",
      "Contextual recommendations",
      "Coordinated workflows",
      "Institution-wide visibility within authorized boundaries",
    ],
  },
];

export function branchById(id: string): SchoolRealityBranch | undefined {
  return SCHOOL_REALITY_BRANCHES.find((branch) => branch.id === id);
}

export function pathById(id: string): SchoolRealityPath | undefined {
  return SCHOOL_REALITY_PATHS.find((path) => path.id === id);
}

/** The single path highlighted on the map for this branch. Always includes the branch. */
export function tracedPathForBranch(branchId: string): SchoolRealityPath | undefined {
  const branch = branchById(branchId);
  if (!branch) return undefined;
  return pathById(branch.tracePathId);
}

/** Other domains on the traced path. Does not union every path that mentions the branch. */
export function relatedBranchIds(branchId: string): readonly string[] {
  const path = tracedPathForBranch(branchId);
  if (!path) return [];
  return path.branchIds.filter((id) => id !== branchId);
}

export function pathsTouchingBranch(branchId: string): readonly SchoolRealityPath[] {
  return SCHOOL_REALITY_PATHS.filter((path) => path.branchIds.includes(branchId));
}
