/**
 * Public marketing content for Sherivs Scholar.
 *
 * Capability labels follow a repository audit (Mission 002):
 * - Membership and role exist on organization_memberships. The signed-in
 *   workspace is a generic shell at /home/s/$section. There are no dedicated
 *   teacher, parent, or bursar routes.
 * - /home/ai is static copy. The AI gateway is not wired to that screen.
 * - Public onboarding (onboarding-request.ts) only builds a mailto.
 * - Campus and section records exist in the data model. There is no campus UI.
 * - RLS is enabled widely. CI flags several tables as not FORCE RLS.
 * - Authentication (Supabase, Google, Turnstile, WebAuthn) exists in code.
 * - lib/authorization.ts implements RBAC, ABAC, ReBAC, and PBAC, and no
 *   application route imports that engine.
 *
 * AI assistants, multi-campus management, and supported automated actions
 * are therefore labelled In development. They are not described as operational.
 */
import type { CapabilityStatus } from "@/lib/public-site/capabilities";
import { PRODUCT_DESCRIPTOR } from "@/lib/public-site/company";

export interface ScholarCapability {
  id: string;
  title: string;
  body: string;
  href: string;
}

export interface ScholarAudience {
  id: string;
  title: string;
  body: string;
}

export interface HomepageCard {
  id: string;
  eyebrow?: string;
  title: string;
  body: string;
  status?: CapabilityStatus;
}

export interface HomepageStep {
  step: string;
  title: string;
  body: string;
}

export const SCHOLAR_CAPABILITIES: readonly ScholarCapability[] = [
  {
    id: "administration",
    title: "School administration",
    body: "Keep organization settings, membership, and administrative records together in the signed-in workspace.",
    href: "/solutions/education#administration",
  },
  {
    id: "academic",
    title: "Academic operations",
    body: "Work with the academic records the product supports — classes, subjects, attendance, and assessment information — inside the same organization.",
    href: "/solutions/education#academic",
  },
  {
    id: "classroom",
    title: "Teacher and student work",
    body: "Teachers and students sign in to the same workspace shell. What they can open follows membership and role. There is no separate teacher or student application.",
    href: "/solutions/education#academic",
  },
  {
    id: "families",
    title: "Parent and guardian access",
    body: "Parents and guardians can be invited into the organization. They use the same workspace shell. There is no separate parent application.",
    href: "/solutions/education#academic",
  },
];

export const SCHOLAR_AUDIENCES: readonly ScholarAudience[] = [
  {
    id: "administrators",
    title: "School administrators",
    body: "Request the organization, manage membership, and work with the records the signed-in workspace provides. This is a shared shell, not a separate leadership application.",
  },
  {
    id: "teachers",
    title: "Teachers",
    body: "Teachers use the same signed-in workspace. Lesson preparation and classroom assistance are designed for this role and are in development.",
  },
  {
    id: "students",
    title: "Students",
    body: "Students use the same signed-in workspace. Personal learning support is designed for this role and is in development.",
  },
  {
    id: "parents",
    title: "Parents and guardians",
    body: "Parents and guardians can be invited into the organization. Access follows membership and role. A separate parent workspace is not part of the product.",
  },
];

export const SCHOLAR_HERO = {
  eyebrow: "SHERIVS SCHOLAR",
  descriptor: PRODUCT_DESCRIPTOR,
  headline: "Your school. One intelligent operating environment.",
  supporting:
    "Bring your school's people, responsibilities, operations, and institutional knowledge into one connected digital environment—designed around how your organization actually works.",
  secondary:
    "From administrators and teachers to students, parents, and operational staff, Sherivs Scholar brings the school community into a shared, role-aware environment.",
  primaryCta: "Explore Sherivs Scholar",
  primaryHref: "/solutions/education",
  secondaryCta: "Get started",
  secondaryHref: "/onboarding",
} as const;

export const SCHOLAR_ORGANIZATION = {
  id: "school-operations",
  eyebrow: "THE SHERIVS APPROACH",
  headline: "Your school is more than its records.",
  description:
    "A school is a living organization of people, responsibilities, relationships, places, and daily operations. Sherivs Scholar brings these realities together in one digital environment, giving each person a more coherent way to work within the organization.",
  cards: [
    {
      id: "one-reality",
      title: "One organizational reality",
      body: "Bring the people, structures, responsibilities, records, and relationships that define your school into a shared operating environment.",
    },
    {
      id: "connected-work",
      title: "Work connected by context",
      body: "Connect relevant information and workflows so that work reflects the people, responsibilities, and organizational relationships behind it.",
    },
    {
      id: "shaped-workspace",
      title: "A workspace shaped around your school",
      body: "Represent the way your institution is organized, from individual responsibilities to the broader structure of your school community.",
    },
  ] as const satisfies readonly HomepageCard[],
};

export const SCHOLAR_COMMUNITY = {
  id: "community",
  eyebrow: "THE SCHOOL COMMUNITY",
  headline: "Every role matters. Every workflow has context.",
  description:
    "Sherivs Scholar brings the people who make a school work into one organizational environment, with access and responsibilities shaped around their roles.",
  note: "People share one workspace shell. A role does not imply a separate application.",
  cards: [
    {
      id: "leadership",
      title: "School leadership and administration",
      body: "Coordinate institutional responsibilities, review relevant information, oversee operations, and make better-informed decisions within your authorized scope.",
    },
    {
      id: "teachers",
      title: "Teachers and academic staff",
      body: "Prepare lessons, organize academic work, review student progress, and identify students who may need additional attention.",
    },
    {
      id: "students",
      title: "Students",
      body: "Access relevant learning information, receive learning support where available, follow educational goals, and work toward academic and personal development.",
    },
    {
      id: "parents",
      title: "Parents and guardians",
      body: "Stay connected to your children's educational journey through relevant school information, progress updates, and supported parent workflows.",
    },
    {
      id: "health",
      title: "School nurses and health personnel",
      body: "Support student welfare through authorized health information, relevant records, and appropriate follow-up workflows.",
    },
    {
      id: "operations-staff",
      title: "Transport and operational staff",
      body: "Coordinate assigned operational responsibilities, schedules, resources, and relevant organizational information.",
    },
    {
      id: "other-roles",
      title: "Every other authorized role",
      body: "Accommodate the additional responsibilities that make each school unique, from library and laboratory personnel to maintenance teams, security staff, boarding-house personnel, and other operational roles.",
    },
  ] as const satisfies readonly HomepageCard[],
};

export const SCHOLAR_INTELLIGENCE = {
  id: "intelligence",
  eyebrow: "ROLE-AWARE INTELLIGENCE",
  headline: "Intelligence that understands your role.",
  description:
    "The right assistance depends on the person, the work, and the context. Sherivs Scholar aims to bring AI assistance closer to the responsibilities of each member of the school community.",
  status: "in_development" as const satisfies CapabilityStatus,
  note: "The signed-in AI page is static copy. These assistants are not operational.",
  featured: ["teachers", "students"] as const,
  cards: [
    {
      id: "administrators",
      eyebrow: "For administrators",
      title: "Administrative intelligence",
      body: "Surface relevant information, organize administrative work, prepare supported reports, and receive recommendations that help administrators coordinate their responsibilities.",
      status: "in_development",
    },
    {
      id: "teachers",
      eyebrow: "For teachers",
      title: "Teaching intelligence",
      body: "Assist with lesson preparation, generate teaching materials, organize classroom work, and identify students who may benefit from additional support.",
      status: "in_development",
    },
    {
      id: "students",
      eyebrow: "For students",
      title: "Personal learning support",
      body: "Provide learning explanations, practice activities, study guidance, and educational recommendations suited to the student's learning journey.",
      status: "in_development",
    },
    {
      id: "parents",
      eyebrow: "For parents and guardians",
      title: "Parent guidance",
      body: "Help parents understand relevant school information, follow their children's progress, and identify appropriate next steps within their available parent workflows.",
      status: "in_development",
    },
    {
      id: "operations",
      eyebrow: "For operational staff",
      title: "Operational assistance",
      body: "Help staff understand assigned responsibilities, organize routine work, retrieve relevant information, and complete supported operational tasks.",
      status: "in_development",
    },
    {
      id: "leadership",
      eyebrow: "For school leadership",
      title: "Institutional insight",
      body: "Bring together authorized operational information to support oversight, identify issues requiring attention, and inform institutional decisions.",
      status: "in_development",
    },
  ] as const satisfies readonly HomepageCard[],
};

export const SCHOLAR_ACTION = {
  id: "coordinated-work",
  eyebrow: "WORK, COORDINATED",
  headline: "Move from figuring out the work to getting it done.",
  description:
    "Sherivs Scholar aims to help people understand their responsibilities, prepare work, receive useful recommendations, and complete supported tasks within the boundaries of their roles.",
  status: "in_development" as const satisfies CapabilityStatus,
  note: "An interaction model. Supported actions are not automated execution.",
  steps: [
    {
      step: "01",
      title: "Understand",
      body: "Bring relevant information and responsibilities into view so people can understand the work that needs attention.",
    },
    {
      step: "02",
      title: "Prepare",
      body: "Use contextual assistance to draft materials, organize information, and prepare the next steps in a workflow.",
    },
    {
      step: "03",
      title: "Act",
      body: "Complete supported tasks through the appropriate workflow, with permissions and review requirements applied where necessary.",
    },
    {
      step: "04",
      title: "Follow through",
      body: "Keep track of relevant outcomes, outstanding responsibilities, and the next steps that help work move forward.",
    },
  ] as const satisfies readonly HomepageStep[],
};

export const SCHOLAR_FLEXIBILITY = {
  id: "flexibility",
  eyebrow: "ORGANIZATIONAL FLEXIBILITY",
  headline: "Your institution sets the structure. Sherivs works within it.",
  description:
    "Schools differ in how they organize people, facilities, academic activities, and responsibilities. Sherivs Scholar aims to represent those differences instead of assuming that every institution operates the same way.",
  cards: [
    {
      id: "campuses",
      title: "Multiple schools and campuses",
      body: "Support the organizational structure of school groups and multi-campus institutions, with visibility and responsibilities appropriate to each level.",
      status: "in_development",
    },
    {
      id: "premises",
      title: "Multiple premises and environments",
      body: "Represent the different locations and operational environments that form part of an institution, according to its actual organizational structure.",
      status: "in_development",
    },
    {
      id: "relationships",
      title: "Connected organizational relationships",
      body: "Keep people, responsibilities, and relevant records connected to the organizational units they belong to.",
    },
    {
      id: "specific-operations",
      title: "School-specific operations",
      body: "Accommodate the workflows and responsibilities that make your institution distinct, rather than forcing every school into an identical operating model.",
    },
  ] as const satisfies readonly HomepageCard[],
};

export const SCHOLAR_WORKSPACE = {
  id: "operating-environment",
  eyebrow: "THE OPERATING ENVIRONMENT",
  headline: "The workspace is the interface. Your organization is the reality behind it.",
  description:
    "A school workspace should do more than display disconnected records. It should provide an organized way to work with the people, relationships, responsibilities, and processes that define the institution.",
  cards: [
    {
      id: "context",
      title: "Context that connects",
      body: "Help people navigate information through its relationship to their roles, responsibilities, and organizational environment.",
    },
    {
      id: "reality",
      title: "Work that reflects reality",
      body: "Organize workflows around the actual responsibilities and relationships that exist within the school.",
    },
    {
      id: "coherent",
      title: "A coherent institutional experience",
      body: "Bring relevant activities into a shared workspace so people can work within the same organizational context without losing the boundaries that separate their responsibilities.",
    },
  ] as const satisfies readonly HomepageCard[],
};

export const SCHOLAR_GOVERNANCE = {
  id: "security",
  eyebrow: "SECURITY AND RESPONSIBILITY",
  headline: "Connected by design. Governed by responsibility.",
  description:
    "An organization-wide environment must preserve the boundaries between people, roles, records, and actions. Sherivs Scholar follows controlled access and institutional responsibility.",
  cards: [
    {
      id: "rbac",
      title: "Role-based access",
      body: "Define what people can access and do according to their assigned roles and permissions.",
    },
    {
      id: "rebac",
      title: "Relationship-aware access",
      body: "Account for relevant organizational relationships when determining which information or actions are appropriate for a person.",
      status: "in_development",
    },
    {
      id: "pbac",
      title: "Policy-governed decisions",
      body: "Apply institutional rules to access and actions where supported by the configured policy system.",
      status: "in_development",
    },
    {
      id: "rls",
      title: "Data-level protection",
      body: "Apply access restrictions at the data layer for tenant-sensitive records, as well as in the application. Row-level security is enabled widely. It is not forced on every table, so coverage is not uniform.",
    },
    {
      id: "abac",
      title: "Attribute-aware decisions",
      body: "Use relevant attributes, such as organizational context or resource characteristics, when supported by the authorization model.",
      status: "in_development",
    },
    {
      id: "responsible-ai",
      title: "Responsible AI actions",
      body: "Keep AI assistance within defined responsibilities, permissions, and required review boundaries.",
      status: "in_development",
    },
  ] as const satisfies readonly HomepageCard[],
};

export const SCHOLAR_START = {
  id: "getting-started",
  eyebrow: "YOUR SCHOOL, CONNECTED",
  headline: "Start with your institution. Build from there.",
  description:
    "Bring your school into Sherivs Scholar through an onboarding process that reflects your institution's structure and operational needs.",
  note: "Get started opens an account request in your email client. It does not create the organization, migrate records, or provision accounts by itself.",
  steps: [
    {
      step: "01",
      title: "Establish your institution",
      body: "Create or request access to your organization's Sherivs Scholar environment through the supported onboarding process.",
    },
    {
      step: "02",
      title: "Represent your school",
      body: "Configure the organizational structure, people, roles, and operational information supported by the platform.",
    },
    {
      step: "03",
      title: "Connect your community",
      body: "Provide administrators, teachers, students, parents, and relevant staff with the access appropriate to their responsibilities.",
    },
    {
      step: "04",
      title: "Begin operating",
      body: "Use the available workflows and assistance to support the everyday activities of your institution.",
    },
  ] as const satisfies readonly HomepageStep[],
};

export const SCHOLAR_FINAL_CTA = {
  headline: "Bring your school's reality into one connected environment.",
  supporting:
    "Discover a more coherent way to organize your institution, support its people, and coordinate everyday school operations with Sherivs Scholar.",
  primaryCta: "Get started",
  primaryHref: "/onboarding",
  secondaryCta: "Contact Sherivs",
  secondaryHref: "/contact",
} as const;
