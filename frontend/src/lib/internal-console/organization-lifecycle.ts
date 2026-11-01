/**
 * Organization Lifecycle Engine — pure contract.
 *
 * Control-plane cases live in `platform_organization`. The live Scholar
 * tenant remains `public.schools`. A case may exist before a tenant exists;
 * `schoolId` is set only after idempotent provisioning. Workspace membership
 * and organization assignment never grant tenant data access.
 */
import { z } from "zod";

export const ORGANIZATION_LIFECYCLE_STATES = [
  "draft",
  "submitted",
  "under_review",
  "provisioning",
  "provisioning_failed",
  "ready_for_activation",
  "active",
  "suspended",
  "deactivated",
] as const;
export type OrganizationLifecycleState = (typeof ORGANIZATION_LIFECYCLE_STATES)[number];

export const ORGANIZATION_LIFECYCLE_LABELS: Record<OrganizationLifecycleState, string> = {
  draft: "Draft",
  submitted: "Submitted",
  under_review: "Under review",
  provisioning: "Provisioning",
  provisioning_failed: "Provisioning failed",
  ready_for_activation: "Ready for activation",
  active: "Active",
  suspended: "Suspended",
  deactivated: "Deactivated",
};

export const ORGANIZATION_TRANSITIONS: Record<
  OrganizationLifecycleState,
  readonly OrganizationLifecycleState[]
> = {
  draft: ["submitted"],
  submitted: ["under_review"],
  under_review: ["submitted", "provisioning"],
  provisioning: ["provisioning_failed", "ready_for_activation"],
  provisioning_failed: ["provisioning"],
  ready_for_activation: ["active", "provisioning"],
  active: ["suspended", "deactivated"],
  suspended: ["active", "deactivated"],
  deactivated: [],
};

export function isOrganizationLifecycleState(value: string): value is OrganizationLifecycleState {
  return (ORGANIZATION_LIFECYCLE_STATES as readonly string[]).includes(value);
}

export function canTransitionOrganization(
  from: OrganizationLifecycleState,
  to: OrganizationLifecycleState,
): boolean {
  return ORGANIZATION_TRANSITIONS[from].includes(to);
}

export const ONBOARDING_PIPELINE_STATES: readonly OrganizationLifecycleState[] = [
  "draft",
  "submitted",
  "under_review",
  "provisioning",
  "provisioning_failed",
  "ready_for_activation",
];

export function isOnboardingPipelineState(state: OrganizationLifecycleState): boolean {
  return ONBOARDING_PIPELINE_STATES.includes(state);
}

export const ORGANIZATION_ASSIGNMENT_TYPES = ["onboarding_owner", "support", "operations"] as const;
export type OrganizationAssignmentType = (typeof ORGANIZATION_ASSIGNMENT_TYPES)[number];

export const ORGANIZATION_ASSIGNMENT_LABELS: Record<OrganizationAssignmentType, string> = {
  onboarding_owner: "Onboarding owner",
  support: "Support",
  operations: "Operations",
};

export const ORGANIZATION_ONBOARDING_STEPS = [
  "identity",
  "contact",
  "intended_use",
  "configuration",
  "review",
] as const;
export type OrganizationOnboardingStep = (typeof ORGANIZATION_ONBOARDING_STEPS)[number];

export const ORGANIZATION_ORG_TYPES = ["school"] as const;
export type OrganizationOrgType = (typeof ORGANIZATION_ORG_TYPES)[number];

export const ORGANIZATION_SCALES = ["small", "medium", "large", "unspecified"] as const;
export const ORGANIZATION_LAUNCH_WINDOWS = [
  "immediate",
  "this_term",
  "next_term",
  "unspecified",
] as const;
export const ORGANIZATION_CONTACT_METHODS = ["email", "phone"] as const;
export const ORGANIZATION_WORKFLOWS = ["people", "academics", "finance", "communication"] as const;
export const ORGANIZATION_EDUCATION_LEVELS = [
  "nursery",
  "primary",
  "junior_secondary",
  "senior_secondary",
] as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : undefined));

export const organizationIdentitySchema = z.object({
  displayName: z.string().trim().min(2).max(120),
  legalName: optionalText(160),
  orgType: z.enum(ORGANIZATION_ORG_TYPES).default("school"),
  country: z.string().trim().min(2).max(80),
  region: optionalText(80),
  city: optionalText(80),
  officialEmail: z
    .string()
    .trim()
    .email()
    .max(254)
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : undefined)),
});

export const organizationContactSchema = z.object({
  contactName: z.string().trim().min(2).max(120),
  contactEmail: z.string().trim().email().max(254),
  contactPhone: optionalText(40),
  contactTitle: optionalText(80),
  contactMethod: z.enum(ORGANIZATION_CONTACT_METHODS).default("email"),
});

export const organizationIntendedUseSchema = z.object({
  intendedRuntime: z.literal("scholar"),
  expectedScale: z.enum(ORGANIZATION_SCALES).default("unspecified"),
  workflows: z.array(z.enum(ORGANIZATION_WORKFLOWS)).max(ORGANIZATION_WORKFLOWS.length).default([]),
  launchTimeframe: z.enum(ORGANIZATION_LAUNCH_WINDOWS).default("unspecified"),
});

export const organizationConfigurationSchema = z.object({
  schoolStructure: optionalText(400),
  academicCalendar: optionalText(400),
  educationLevels: z
    .array(z.enum(ORGANIZATION_EDUCATION_LEVELS))
    .max(ORGANIZATION_EDUCATION_LEVELS.length)
    .default([]),
});

export const organizationQuestionnaireSchema = organizationIdentitySchema
  .merge(organizationContactSchema)
  .merge(organizationIntendedUseSchema)
  .merge(organizationConfigurationSchema);

export type OrganizationQuestionnaire = z.infer<typeof organizationQuestionnaireSchema>;
export type OrganizationDraft = Partial<OrganizationQuestionnaire> & {
  questionnaireStep?: OrganizationOnboardingStep;
};

export function stepCompleted(step: OrganizationOnboardingStep, draft: OrganizationDraft): boolean {
  switch (step) {
    case "identity":
      return organizationIdentitySchema.safeParse(draft).success;
    case "contact":
      return organizationContactSchema.safeParse(draft).success;
    case "intended_use":
      return organizationIntendedUseSchema.safeParse(draft).success;
    case "configuration":
      return organizationConfigurationSchema.safeParse(draft).success;
    case "review":
      return false;
  }
}

export function currentOnboardingStep(draft: OrganizationDraft): OrganizationOnboardingStep {
  for (const step of ORGANIZATION_ONBOARDING_STEPS) {
    if (!stepCompleted(step, draft)) return step;
  }
  return "review";
}

export function questionnaireReady(draft: OrganizationDraft): boolean {
  return organizationQuestionnaireSchema.safeParse(draft).success;
}

const RESERVED_SLUGS = new Set(["www", "app", "api", "admin", "dashboard", "console", "internal"]);

export function slugifyOrganizationName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  if (slug.length < 3 || RESERVED_SLUGS.has(slug)) {
    const fallback = `org-${slug}`.replace(/[^a-z0-9-]/g, "").slice(0, 50);
    return fallback.length >= 3 ? fallback : "org-school";
  }
  if (!/^[a-z0-9]/.test(slug) || !/[a-z0-9]$/.test(slug)) return `org-${slug}`.slice(0, 50);
  return slug;
}

export function uniqueOrganizationSlug(base: string, taken: ReadonlySet<string>): string {
  const root = slugifyOrganizationName(base);
  if (!taken.has(root)) return root;
  for (let index = 2; index < 1000; index += 1) {
    const suffix = `-${index}`;
    const candidate = `${root.slice(0, Math.max(3, 50 - suffix.length))}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${root.slice(0, 42)}-org`;
}

export const ORGANIZATION_ACCESS_EFFECTS = {
  provision: {
    sessions: "No Scholar sessions are created. The tenant is not yet authorized.",
    api: "Tenant APIs remain unauthorized until activation.",
    runtime:
      "Sherivs Scholar eligibility is recorded on the case; the runtime is not launched for the organization.",
    data: "A schools row is created with is_active = false. No student or academic records are created.",
    audit: "Provisioning outcome is appended. Prior questionnaire history is kept.",
  },
  activate: {
    sessions:
      "Existing staff sessions are unchanged. Organization administrators sign in separately.",
    api: "Authorized Scholar requests for this tenant may proceed.",
    runtime: "Sherivs Scholar authorization applies to this organization.",
    data: "Existing records are retained. Activation does not complete academic configuration.",
    audit: "Activation is appended.",
  },
  suspend: {
    sessions:
      "Sherivs does not globally revoke every browser session. The next authorized Scholar request re-evaluates schools.is_active.",
    api: "Tenant API access is denied while the school row is inactive and subscription_status is suspended.",
    runtime: "Sherivs Scholar stays registered, but this organization is not authorized to use it.",
    data: "Records are retained. Suspension does not delete the organization, members, or questionnaire.",
    audit: "History is retained.",
  },
  restore: {
    sessions: "Restored access is evaluated on the next authorized request.",
    api: "Tenant API access may proceed again for authorized members.",
    runtime: "Sherivs Scholar authorization applies to this organization again.",
    data: "Records remain. Restoration does not recreate deleted data because suspension never deleted it.",
    audit: "Restoration is appended.",
  },
  deactivate: {
    sessions: "Subsequent Scholar authorization for this organization is denied.",
    api: "Tenant API access is denied. The schools row remains with is_active = false.",
    runtime: "Runtime eligibility is withdrawn. The runtime product itself is unchanged.",
    data: "Records are retained. Deactivation is not deletion.",
    audit: "History is retained. Deactivation is terminal in V1.",
  },
} as const;

export type OrganizationDirectoryRow = {
  id: string;
  displayName: string;
  orgType: OrganizationOrgType;
  lifecycleState: OrganizationLifecycleState;
  country: string | null;
  region: string | null;
  city: string | null;
  intendedRuntime: "scholar";
  enabledRuntime: "scholar" | null;
  schoolId: string | null;
  slug: string | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  provisionedAt: string | null;
  activatedAt: string | null;
  onboardingOwnerName: string | null;
  assignmentCount: number;
};

export type OrganizationAssignmentRecord = {
  id: string;
  organizationId: string;
  staffId: string;
  staffName: string | null;
  assignmentType: OrganizationAssignmentType;
  status: "active" | "released";
  assignedBy: string | null;
  assignedAt: string;
  releasedAt: string | null;
};

export function isSupportScopedViewer(input: {
  isSuperAdmin?: boolean;
  hasSupportCapability: boolean;
  hasTenantManagementCapability: boolean;
}): boolean {
  return !input.isSuperAdmin && input.hasSupportCapability && !input.hasTenantManagementCapability;
}

export function isOrganizationAssignedToStaff(
  assignments: readonly Pick<OrganizationAssignmentRecord, "staffId" | "status">[],
  staffId: string,
): boolean {
  return assignments.some(
    (assignment) => assignment.staffId === staffId && assignment.status === "active",
  );
}

export function organizationsAssignedToStaff<T extends { id: string }>(
  organizations: readonly T[],
  assignments: readonly Pick<
    OrganizationAssignmentRecord,
    "organizationId" | "staffId" | "status"
  >[],
  staffId: string,
): T[] {
  const assignedIds = new Set(
    assignments
      .filter((assignment) => assignment.staffId === staffId && assignment.status === "active")
      .map((assignment) => assignment.organizationId),
  );
  return organizations.filter((organization) => assignedIds.has(organization.id));
}

export type OrganizationDetail = OrganizationDirectoryRow & {
  legalName: string | null;
  questionnaire: OrganizationDraft;
  questionnaireStep: OrganizationOnboardingStep;
  provisioningError: string | null;
  outstandingRequirements: string[];
  createdBy: string | null;
  submittedBy: string | null;
  reviewedBy: string | null;
  activatedBy: string | null;
  contact: {
    name: string | null;
    email: string | null;
    phone: string | null;
    title: string | null;
    method: string | null;
  } | null;
  assignments: OrganizationAssignmentRecord[];
  transitions: Array<{
    id: string;
    fromState: OrganizationLifecycleState | null;
    toState: OrganizationLifecycleState;
    actorId: string | null;
    reason: string | null;
    at: string;
  }>;
  accessEffects:
    (typeof ORGANIZATION_ACCESS_EFFECTS)[keyof typeof ORGANIZATION_ACCESS_EFFECTS] | null;
};

export type OrganizationMetricsSnapshot = {
  available: boolean;
  source: string;
  total: number | null;
  active: number | null;
  onboarding: number | null;
  suspended: number | null;
  failedProvisioning: number | null;
  submitted: number | null;
  conversionRate: number | null;
  medianOnboardingHours: number | null;
};

export function summarizeOrganizationStates(states: readonly OrganizationLifecycleState[]): {
  total: number;
  active: number;
  onboarding: number;
  suspended: number;
  failedProvisioning: number;
  submitted: number;
  conversionRate: number | null;
} {
  const total = states.length;
  const active = states.filter((state) => state === "active").length;
  const onboarding = states.filter((state) => isOnboardingPipelineState(state)).length;
  const suspended = states.filter((state) => state === "suspended").length;
  const failedProvisioning = states.filter((state) => state === "provisioning_failed").length;
  const submitted = states.filter((state) => state !== "draft").length;
  const conversionRate = submitted === 0 ? null : active / submitted;
  return {
    total,
    active,
    onboarding,
    suspended,
    failedProvisioning,
    submitted,
    conversionRate,
  };
}

export function medianHours(durationsHours: readonly number[]): number | null {
  if (!durationsHours.length) return null;
  const sorted = [...durationsHours].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
