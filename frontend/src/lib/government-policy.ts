import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

// ─── CoreGrid Phase 20 — Government Education Cloud ──────────────────
// government-policy.ts — Policy lifecycle, programmes, funding, workflow
// ──────────────────────────────────────────────────────────────────────

export type PolicyId = string & { __brand: "PolicyId" };
export type ProgrammeId = string & { __brand: "ProgrammeId" };
export type FundingId = string & { __brand: "FundingId" };

// ─── L–M. Policy Distribution & Lifecycle ────────────────────────────
export type PolicyStatus =
  "draft" | "review" | "approved" | "active" | "suspended" | "replaced" | "archived";

export interface GovernmentPolicy {
  readonly id: PolicyId;
  readonly title: string;
  readonly jurisdiction: string;
  readonly status: PolicyStatus;
  readonly version: number;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly replaces: PolicyId | null;
  readonly supersededBy: PolicyId | null;
  readonly requiresAcknowledgement: boolean;
  readonly acknowledgements: string[];
}

// ─── O. Traceability // P. Acknowledgement ──────────────────────────
export interface PolicyAcknowledgement {
  readonly policyId: PolicyId;
  readonly entityId: string;
  readonly acknowledgedAt: string;
  readonly acknowledgedBy: string;
}

// ─── R–S. Government Programmes & Lifecycle ──────────────────────────
export type ProgrammeStatus =
  "proposed" | "approved" | "active" | "paused" | "completed" | "cancelled";

export interface GovernmentProgramme {
  readonly id: ProgrammeId;
  readonly name: string;
  readonly jurisdiction: string;
  readonly status: ProgrammeStatus;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly budget: number | null;
  readonly objectives: string[];
  readonly participatingInstitutions: string[];
}
// ─── T. Programme Participation ──────────────────────────────────────
export interface ProgrammeParticipation {
  readonly programmeId: ProgrammeId;
  readonly institutionId: string;
  readonly enrolledAt: string;
  readonly status: "active" | "withdrawn" | "completed";
  readonly fundingReceived: number | null;
}

// ─── U–W. Government Funding ──────────────────────────────────────────
export type FundingAllocationMethod = "formula" | "needs_based" | "performance" | "application";

export interface FundingProgramme {
  readonly id: FundingId;
  readonly programmeId: ProgrammeId;
  readonly totalBudget: number;
  readonly allocationMethod: FundingAllocationMethod;
  readonly disbursementSchedule: "annual" | "semi_annual" | "quarterly" | "monthly";
  readonly restrictions: string[];
}

// ─── BU–BW. Government Workflow & Automation Boundary ────────────────
export type GovernmentWorkflowStatus =
  "pending" | "in_review" | "approved" | "rejected" | "escalated";

export interface GovernmentApprovalWorkflow {
  readonly id: string;
  readonly type: "policy" | "programme" | "funding" | "exception" | "procurement";
  readonly referenceId: string;
  readonly status: GovernmentWorkflowStatus;
  readonly submittedBy: string;
  readonly reviewedBy: string | null;
  readonly submittedAt: string;
  readonly reviewedAt: string | null;
  readonly comments: string[];
}

// ─── BX–CB. Government Emergency Response ────────────────────────────
export type EmergencyStatus = "normal" | "watch" | "warning" | "emergency" | "recovery";

export interface GovernmentEmergencyStatus {
  readonly jurisdiction: string;
  readonly status: EmergencyStatus;
  readonly declaredAt: string;
  readonly declaredBy: string;
  readonly affectedRegions: string[];
  readonly educationContinuityPlan: boolean;
}

// ─── DB–DE. Teacher, Infrastructure Programmes ───────────────────────
export interface TeacherProgramme {
  readonly id: string;
  readonly name: string;
  readonly programmeType: "training" | "recruitment" | "licensing" | "professional_development";
  readonly jurisdiction: string;
  readonly participants: number;
  readonly status: ProgrammeStatus;
}

export interface InfrastructureProgramme {
  readonly id: string;
  readonly name: string;
  readonly infrastructureType: "connectivity" | "facilities" | "devices" | "power" | "transport";
  readonly jurisdiction: string;
  readonly status: ProgrammeStatus;
  readonly budget: number | null;
}
// ─── Functions ────────────────────────────────────────────────────────

export function createPolicy(params: {
  id: PolicyId;
  title: string;
  jurisdiction: string;
  effectiveFrom: string;
  effectiveTo?: string;
  requiresAcknowledgement?: boolean;
}): GovernmentPolicy {
  if (!params.id || !params.title) throw new Error("Policy requires id and title");
  return {
    id: params.id,
    title: params.title,
    jurisdiction: params.jurisdiction,
    status: "draft" as const,
    version: 1,
    effectiveFrom: params.effectiveFrom,
    effectiveTo: params.effectiveTo ?? null,
    replaces: null,
    supersededBy: null,
    requiresAcknowledgement: params.requiresAcknowledgement ?? false,
    acknowledgements: [],
  };
}

export function transitionPolicy(
  policy: GovernmentPolicy,
  newStatus: PolicyStatus,
): GovernmentPolicy {
  const allowed: Record<PolicyStatus, PolicyStatus[]> = {
    draft: ["review"],
    review: ["approved", "draft"],
    approved: ["active", "draft"],
    active: ["suspended", "replaced", "archived"],
    suspended: ["active", "archived"],
    replaced: ["archived"],
    archived: [],
  };
  if (!allowed[policy.status].includes(newStatus)) {
    throw new Error(`Cannot transition policy from ${policy.status} to ${newStatus}`);
  }
  return { ...policy, status: newStatus };
}

export function acknowledgePolicy(
  policy: GovernmentPolicy,
  entityId: string,
  acknowledgedBy: string,
): PolicyAcknowledgement {
  if (policy.requiresAcknowledgement && policy.status !== "active") {
    throw new Error("Policy must be active before acknowledging");
  }
  return {
    policyId: policy.id,
    entityId,
    acknowledgedAt: timeAuthority.now().at,
    acknowledgedBy,
  };
}

export function createProgramme(params: {
  id: ProgrammeId;
  name: string;
  jurisdiction: string;
  startDate: string;
  endDate?: string;
  budget?: number;
  objectives?: string[];
}): GovernmentProgramme {
  if (!params.id || !params.name) throw new Error("Programme requires id and name");
  return {
    id: params.id,
    name: params.name,
    jurisdiction: params.jurisdiction,
    status: "proposed" as const,
    startDate: params.startDate,
    endDate: params.endDate ?? null,
    budget: params.budget ?? null,
    objectives: params.objectives ?? [],
    participatingInstitutions: [],
  };
}

export function transitionProgramme(
  programme: GovernmentProgramme,
  newStatus: ProgrammeStatus,
): GovernmentProgramme {
  const allowed: Record<ProgrammeStatus, ProgrammeStatus[]> = {
    proposed: ["approved", "cancelled"],
    approved: ["active", "cancelled"],
    active: ["paused", "completed", "cancelled"],
    paused: ["active", "cancelled"],
    completed: [],
    cancelled: [],
  };
  if (!allowed[programme.status].includes(newStatus)) {
    throw new Error(`Cannot transition programme from ${programme.status} to ${newStatus}`);
  }
  return { ...programme, status: newStatus };
}

export function createFundingProgramme(params: {
  id: FundingId;
  programmeId: ProgrammeId;
  totalBudget: number;
  allocationMethod: FundingAllocationMethod;
  disbursementSchedule: FundingProgramme["disbursementSchedule"];
  restrictions?: string[];
}): FundingProgramme {
  if (params.totalBudget <= 0) throw new Error("Funding budget must be positive");
  return {
    id: params.id,
    programmeId: params.programmeId,
    totalBudget: params.totalBudget,
    allocationMethod: params.allocationMethod,
    disbursementSchedule: params.disbursementSchedule,
    restrictions: params.restrictions ?? [],
  };
}

export function submitApprovalWorkflow(params: {
  id: string;
  type: GovernmentApprovalWorkflow["type"];
  referenceId: string;
  submittedBy: string;
}): GovernmentApprovalWorkflow {
  if (!params.id || !params.referenceId) throw new Error("Workflow requires id and reference");
  return {
    id: params.id,
    type: params.type,
    referenceId: params.referenceId,
    status: "pending" as const,
    submittedBy: params.submittedBy,
    reviewedBy: null,
    submittedAt: timeAuthority.now().at,
    reviewedAt: null,
    comments: [],
  };
}

export function reviewWorkflow(
  workflow: GovernmentApprovalWorkflow,
  reviewer: string,
  decision: "approved" | "rejected",
  comment?: string,
): GovernmentApprovalWorkflow {
  const allowedStatuses: GovernmentWorkflowStatus[] = ["pending", "in_review", "escalated"];
  if (!allowedStatuses.includes(workflow.status)) {
    throw new Error(`Cannot review workflow in ${workflow.status} status`);
  }
  const comments = comment ? [...workflow.comments, comment] : workflow.comments;
  return {
    ...workflow,
    status: decision,
    reviewedBy: reviewer,
    reviewedAt: timeAuthority.now().at,
    comments,
  };
}

export function declareEmergency(params: {
  jurisdiction: string;
  declaredBy: string;
  status: EmergencyStatus;
  affectedRegions: string[];
  educationContinuityPlan?: boolean;
}): GovernmentEmergencyStatus {
  if (!params.jurisdiction || !params.declaredBy) {
    throw new Error("Emergency requires jurisdiction and declarer");
  }
  if (params.status === "normal" && params.affectedRegions.length > 0) {
    throw new Error("Normal status must not have affected regions");
  }
  return {
    jurisdiction: params.jurisdiction,
    status: params.status,
    declaredAt: timeAuthority.now().at,
    declaredBy: params.declaredBy,
    affectedRegions: params.affectedRegions,
    educationContinuityPlan: params.educationContinuityPlan ?? false,
  };
}
