/**
 * CoreGrid Institutional Onboarding, Administration & Workforce Identity Platform —
 * Invitation and onboarding journey domain.
 *
 * Implements `architecture/phase-25-institutional-onboarding-administration-workforce-identity-platform.md`:
 * - Invitation engine (Section AN): Create Identity → Assign Role → Assign Context
 *   → Assign Policies → Provision Workspace → Generate Invitation → Send →
 *   Activate → Start Onboarding.
 * - Invitation security (Section AP): tokens expire, are single-use, cryptographically
 *   secure, revocable, auditable. Avoid static/guessable tokens.
 * - Invitation email (Section AQ): institution, inviter, assigned role, activation
 *   instructions, expiration, security guidance; never expose unnecessary permissions.
 * - Account activation (Section AR): invitation verification, identity verification,
 *   password/PIN/device auth, required institutional information.
 * - Novice experience (AS) + novice journey (AT): WELCOME → IDENTITY → ROLE →
 *   CONTEXT → WORKSPACE → KEY CAPABILITIES → FIRST TASK → GUIDED ACTION →
 *   CONFIRMATION → NEXT RECOMMENDATION.
 * - Guided onboarding (AU), progressive complexity (AV), role-specific (AW),
 *   context-specific (AX), policy-aware onboarding (AY) — never teach a user to
 *   perform an action they cannot legitimately perform (Property FI).
 * - First-task system (AZ), onboarding progress (BA), onboarding resume (BB).
 * - Onboarding recommendation engine (CU) — advisory unless explicitly automated.
 * - Staff training (DY), policy acknowledgement (DZ) — acknowledgements are versioned.
 * - Onboarding versioning (ED) — a user who started an older journey should not
 *   silently receive an incompatible version.
 *
 * Phase 25 consumes Phase 10 communication for delivery and Phase 06 workspace
 * provisioning; this domain defines the orchestration contracts only.
 */

import type { TenantId } from "./tenant-core";
import type { InstitutionId } from "./institution-core";
import type { WorkforceRoleId } from "./workforce-core";
import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/* ─────────────────────────────────────────────────────────────
 * Branded IDs
 * ────────────────────────────────────────────────────────────*/

export type StaffInvitationId = string & { readonly __brand: "StaffInvitationId" };
export type OnboardingJourneyId = string & { readonly __brand: "OnboardingJourneyId" };
export type OnboardingStepId = string & { readonly __brand: "OnboardingStepId" };
export type OnboardingProgressId = string & { readonly __brand: "OnboardingProgressId" };
export type PolicyAcknowledgementId = string & { readonly __brand: "PolicyAcknowledgementId" };
export type TrainingModuleId = string & { readonly __brand: "TrainingModuleId" };

export function staffInvitationId(raw: string): StaffInvitationId {
  return raw as StaffInvitationId;
}
export function onboardingJourneyId(raw: string): OnboardingJourneyId {
  return raw as OnboardingJourneyId;
}
export function onboardingStepId(raw: string): OnboardingStepId {
  return raw as OnboardingStepId;
}
export function onboardingProgressId(raw: string): OnboardingProgressId {
  return raw as OnboardingProgressId;
}
export function policyAcknowledgementId(raw: string): PolicyAcknowledgementId {
  return raw as PolicyAcknowledgementId;
}
export function trainingModuleId(raw: string): TrainingModuleId {
  return raw as TrainingModuleId;
}

/* ─────────────────────────────────────────────────────────────
 * Invitation engine (Sections AN, AP)
 * ────────────────────────────────────────────────────────────*/

export type InvitationStatus = "pending" | "sent" | "accepted" | "revoked" | "expired";

export const INVITATION_STATUSES: readonly InvitationStatus[] = [
  "pending",
  "sent",
  "accepted",
  "revoked",
  "expired",
] as const;

export interface StaffInvitation {
  id: StaffInvitationId;
  tenantId: TenantId;
  institutionId: InstitutionId;
  /** Inviting administrator identity. */
  inviterRef: string;
  /** Invitee email. */
  email: string;
  /** Assigned role (Section AN). */
  roleId: WorkforceRoleId;
  /** Assigned context ref. */
  contextRef: string | null;
  /** Assigned policy refs. */
  policyRefs: string[];
  /** Workspace ref to provision on activation. */
  workspaceRef: string | null;
  /** Token digest only — never the raw token in this record. */
  tokenFingerprint: string;
  status: InvitationStatus;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}

export function createStaffInvitation(input: {
  id: StaffInvitationId;
  tenantId: TenantId;
  institutionId: InstitutionId;
  inviterRef: string;
  email: string;
  roleId: WorkforceRoleId;
  contextRef?: string | null;
  policyRefs?: string[];
  workspaceRef?: string | null;
  tokenFingerprint: string;
  expiresAt: string;
  now?: string;
}): { ok: true; invitation: StaffInvitation } | { ok: false; error: string } {
  const now = input.now ?? timeAuthority.now().at;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email)) {
    return { ok: false, error: "Invalid invitation email address" };
  }
  if (!input.tokenFingerprint.trim()) {
    return { ok: false, error: "Invitation token fingerprint is required (Section AP)" };
  }
  if (input.expiresAt <= now) {
    return { ok: false, error: "Invitation expiry must be in the future" };
  }
  return {
    ok: true,
    invitation: {
      id: input.id,
      tenantId: input.tenantId,
      institutionId: input.institutionId,
      inviterRef: input.inviterRef,
      email: input.email.toLowerCase().trim(),
      roleId: input.roleId,
      contextRef: input.contextRef ?? null,
      policyRefs: input.policyRefs ?? [],
      workspaceRef: input.workspaceRef ?? null,
      tokenFingerprint: input.tokenFingerprint,
      status: "pending",
      expiresAt: input.expiresAt,
      acceptedAt: null,
      createdAt: now,
    },
  };
}

/** Invitations are single-use and expiring (Section AP). */
export function redeemInvitation(
  invitation: StaffInvitation,
  tokenFingerprint: string,
  now: string = timeAuthority.now().at,
):
  | {
      ok: true;
      invitation: StaffInvitation;
    }
  | { ok: false; error: string } {
  if (invitation.status === "revoked") {
    return { ok: false, error: "Invitation has been revoked" };
  }
  if (invitation.status === "accepted") {
    return { ok: false, error: "Invitation has already been used (single-use)" };
  }
  if (invitation.tokenFingerprint !== tokenFingerprint) {
    return { ok: false, error: "Invalid invitation token" };
  }
  if (invitation.expiresAt <= now) {
    return { ok: false, error: "Invitation has expired" };
  }
  return { ok: true, invitation: { ...invitation, status: "accepted", acceptedAt: now } };
}

export function revokeInvitation(
  invitation: StaffInvitation,
  now: string = timeAuthority.now().at,
): StaffInvitation {
  return { ...invitation, status: "revoked" };
}

/** Mark an invitation as expired when its expiry passes. */
export function expireInvitation(
  invitation: StaffInvitation,
  now: string = timeAuthority.now().at,
): StaffInvitation {
  if (invitation.status !== "accepted" && invitation.expiresAt <= now) {
    return { ...invitation, status: "expired" };
  }
  return invitation;
}

/* ─────────────────────────────────────────────────────────────
 * Onboarding journey (Sections AS, AT, AU, AV)
 * ────────────────────────────────────────────────────────────*/

export type OnboardingStepKey =
  | "welcome"
  | "identity"
  | "role"
  | "context"
  | "workspace"
  | "key_capabilities"
  | "first_task"
  | "guided_action"
  | "confirmation"
  | "next_recommendation";

export const ONBOARDING_STEP_KEYS: readonly OnboardingStepKey[] = [
  "welcome",
  "identity",
  "role",
  "context",
  "workspace",
  "key_capabilities",
  "first_task",
  "guided_action",
  "confirmation",
  "next_recommendation",
] as const;

export interface OnboardingStep {
  id: OnboardingStepId;
  journeyId: OnboardingJourneyId;
  key: OnboardingStepKey;
  /** Required capability — step is only shown if the user is authorized (Section AY). */
  requiredCapability: string | null;
  /** Required policy — step is hidden if the policy forbids it (Section AY). */
  forbiddenPolicy: string | null;
  /** Progressive complexity level required to see this step (Section AV). */
  minExperienceLevel: "beginner" | "intermediate" | "advanced";
}

export interface OnboardingJourney {
  id: OnboardingJourneyId;
  tenantId: TenantId;
  institutionId: InstitutionId;
  version: number;
  name: string;
  /** Role keys this journey applies to (Section AW). */
  roleKeys: string[];
  /** Context matcher — applied per context (Section AX). */
  contextMatcher: { departmentRefs?: string[]; campusRefs?: string[] } | null;
  steps: OnboardingStep[];
  isActive: boolean;
  createdAt: string;
}

export function createOnboardingJourney(input: {
  id: OnboardingJourneyId;
  tenantId: TenantId;
  institutionId: InstitutionId;
  name: string;
  version?: number;
  roleKeys?: string[];
  contextMatcher?: OnboardingJourney["contextMatcher"];
  steps?: Omit<OnboardingStep, "id" | "journeyId">[];
  isActive?: boolean;
  now?: string;
}): { ok: true; journey: OnboardingJourney } | { ok: false; error: string } {
  if (!input.name.trim()) {
    return { ok: false, error: "Onboarding journey name is required" };
  }
  if (input.steps && input.steps.length === 0) {
    return { ok: false, error: "Onboarding journey must contain at least one step" };
  }
  const journey: OnboardingJourney = {
    id: input.id,
    tenantId: input.tenantId,
    institutionId: input.institutionId,
    version: input.version ?? 1,
    name: input.name.trim(),
    roleKeys: input.roleKeys ?? [],
    contextMatcher: input.contextMatcher ?? null,
    steps: (input.steps ?? []).map((s, i) => ({
      id: onboardingStepId(`step-${input.id}-${i}`),
      journeyId: input.id,
      ...s,
    })),
    isActive: input.isActive ?? true,
    createdAt: input.now ?? timeAuthority.now().at,
  };
  return { ok: true, journey };
}

/**
 * Policy-aware onboarding (Section AY) + Property FI:
 * a user must never be taught to perform an action they cannot perform.
 * A step is permitted only if the user's capabilities cover its requirement
 * and the user's policy set does not forbid it.
 */
export function isOnboardingStepPermitted(
  step: OnboardingStep,
  userCapabilities: string[],
  userPolicyRefs: string[],
): boolean {
  if (step.requiredCapability && !userCapabilities.includes(step.requiredCapability)) return false;
  if (step.forbiddenPolicy && userPolicyRefs.includes(step.forbiddenPolicy)) return false;
  return true;
}

/* ─────────────────────────────────────────────────────────────
 * Onboarding progress (Sections BA, BB, ED)
 * States: started, completed, skipped, deferred, failed, retried.
 * Progress must support resume after logout / device change / interruption.
 * ────────────────────────────────────────────────────────────*/

export type OnboardingStepState =
  "started" | "completed" | "skipped" | "deferred" | "failed" | "retried";

export const ONBOARDING_STEP_STATES: readonly OnboardingStepState[] = [
  "started",
  "completed",
  "skipped",
  "deferred",
  "failed",
  "retried",
] as const;

export interface OnboardingProgress {
  id: OnboardingProgressId;
  tenantId: TenantId;
  institutionId: InstitutionId;
  /** Phase 02 identity reference. */
  identityRef: string;
  /** The journey version the user started (Section ED — no silent swap). */
  journeyId: OnboardingJourneyId;
  journeyVersion: number;
  stepStates: Record<string, OnboardingStepState>;
  currentStepKey: string | null;
  updatedAt: string;
}

export function startOnboarding(input: {
  id: OnboardingProgressId;
  tenantId: TenantId;
  institutionId: InstitutionId;
  identityRef: string;
  journeyId: OnboardingJourneyId;
  journeyVersion: number;
  steps: OnboardingStep[];
  now?: string;
}): OnboardingProgress {
  const stepStates: Record<string, OnboardingStepState> = {};
  for (const step of input.steps) {
    stepStates[step.key] = "started";
  }
  return {
    id: input.id,
    tenantId: input.tenantId,
    institutionId: input.institutionId,
    identityRef: input.identityRef,
    journeyId: input.journeyId,
    journeyVersion: input.journeyVersion,
    stepStates,
    currentStepKey: input.steps[0]?.key ?? null,
    updatedAt: input.now ?? timeAuthority.now().at,
  };
}

export function updateOnboardingStep(
  progress: OnboardingProgress,
  stepKey: string,
  state: OnboardingStepState,
  now: string = timeAuthority.now().at,
): OnboardingProgress {
  return {
    ...progress,
    stepStates: { ...progress.stepStates, [stepKey]: state },
    currentStepKey: state === "completed" ? nextIncompleteStep(progress, stepKey) : stepKey,
    updatedAt: now,
  };
}

function nextIncompleteStep(progress: OnboardingProgress, justCompleted: string): string | null {
  const order = [
    "welcome",
    "identity",
    "role",
    "context",
    "workspace",
    "key_capabilities",
    "first_task",
    "guided_action",
    "confirmation",
    "next_recommendation",
  ];
  const start = order.indexOf(justCompleted) + 1;
  for (let i = start; i < order.length; i++) {
    const key = order[i];
    const state = progress.stepStates[key];
    if (
      state === undefined ||
      state === "started" ||
      state === "deferred" ||
      state === "failed" ||
      state === "retried"
    ) {
      return key;
    }
  }
  return null;
}

/** Is the entire journey complete? */
export function isOnboardingComplete(progress: OnboardingProgress): boolean {
  const values = Object.values(progress.stepStates);
  if (values.length === 0) return false;
  return values.every((s) => s === "completed" || s === "skipped");
}

/* ─────────────────────────────────────────────────────────────
 * First-task system (Section AZ)
 * New users receive one or more safe initial tasks appropriate to their role.
 * ────────────────────────────────────────────────────────────*/

export interface FirstTask {
  key: string;
  label: string;
  /** Required capability — task is only offered to authorized users. */
  requiredCapability: string;
  /** Is the task safe to auto-execute (advisory otherwise)? */
  autoExecutable: boolean;
}

export function selectFirstTasks(candidates: FirstTask[], userCapabilities: string[]): FirstTask[] {
  return candidates.filter((t) => userCapabilities.includes(t.requiredCapability));
}

/* ─────────────────────────────────────────────────────────────
 * Onboarding recommendation engine (Section CU)
 * Recommendations remain advisory unless explicitly automated.
 * ────────────────────────────────────────────────────────────*/

export interface OnboardingRecommendation {
  key: string;
  kind:
    | "first_action"
    | "missing_configuration"
    | "training"
    | "security_setup"
    | "workspace_configuration"
    | "required_policy";
  label: string;
  /** Advisory by default — automation requires explicit authorization. */
  autoActionable: boolean;
}

export function recommendMissingConfiguration(
  configured: string[],
  required: string[],
): OnboardingRecommendation[] {
  const missing = required.filter((r) => !configured.includes(r));
  return missing.map((r) => ({
    key: `config-${r}`,
    kind: "missing_configuration" as const,
    label: `Configure: ${r}`,
    autoActionable: false,
  }));
}

/* ─────────────────────────────────────────────────────────────
 * Staff training + policy acknowledgement (Sections DY, DZ)
 * Acknowledgements must be versioned.
 * ────────────────────────────────────────────────────────────*/

export interface TrainingModule {
  id: TrainingModuleId;
  tenantId: TenantId;
  institutionId: InstitutionId;
  key: string;
  title: string;
  /** Training category: required, policy, security, ai, workflow. */
  category: "required" | "policy" | "security" | "ai" | "workflow";
  requiredForRoles: string[];
  isRequired: boolean;
}

export interface PolicyAcknowledgement {
  id: PolicyAcknowledgementId;
  tenantId: TenantId;
  institutionId: InstitutionId;
  identityRef: string;
  /** Policy reference (Phase 08 security-policy). */
  policyRef: string;
  /** Version of the policy text acknowledged. */
  policyVersion: number;
  acknowledgedAt: string;
}

export function acknowledgePolicy(input: {
  id: PolicyAcknowledgementId;
  tenantId: TenantId;
  institutionId: InstitutionId;
  identityRef: string;
  policyRef: string;
  policyVersion: number;
  now?: string;
}): PolicyAcknowledgement {
  return {
    id: input.id,
    tenantId: input.tenantId,
    institutionId: input.institutionId,
    identityRef: input.identityRef,
    policyRef: input.policyRef,
    policyVersion: input.policyVersion,
    acknowledgedAt: input.now ?? timeAuthority.now().at,
  };
}

/**
 * A user's acknowledgement is only valid for the exact policy version they
 * acknowledged (Section DZ). A newer version requires re-acknowledgement.
 */
export function hasAcknowledgedPolicyVersion(
  acknowledgements: PolicyAcknowledgement[],
  policyRef: string,
  policyVersion: number,
): boolean {
  return acknowledgements.some(
    (a) => a.policyRef === policyRef && a.policyVersion === policyVersion,
  );
}
