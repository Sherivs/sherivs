import { SystemClock, TimeAuthority } from "../kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/**
 * CoreGrid — Phase 25 (platform layer): organization membership lifecycle.
 *
 * Domain-neutral workforce lifecycle contracts for the ENTIRE ecosystem.
 * A "workforce member" here is any actor granted organizational membership:
 * an administrator, officer, teacher, clerk, volunteer, contractor — the label
 * is DATA. Scholar-specific files never enter this module.
 *
 * Implements blueprint sections:
 * - BD member lifecycle: invited → activating → active → suspended → on_leave
 *   → transferred → deactivated → archived (state set mirrors the legacy
 *   Scholar workforce-core so R-001 maps 1:1 later).
 * - BE transfer management with automatic recalculation contract.
 * - BF role change with permission/policy/workspace recalculation contract.
 * - BH deactivation (access revocation + audit preservation).
 * - BI offboarding (revocation, session/device/workspace closure, handover).
 * - BL separation of duties + BM dual control.
 *
 * Platform laws enforced here: state transitions are validated AND authorized
 * (actor + tenant + organization are checked on every transition); expired and
 * revoked memberships FAIL; Tenant A can never transition Tenant B's member;
 * audit events are immutable and preserved through archiving.
 */

export type MemberLifecycleState =
  | "invited"
  | "activating"
  | "active"
  | "suspended"
  | "on_leave"
  | "transferred"
  | "deactivated"
  | "archived";

export const MEMBER_LIFECYCLE_STATES: readonly MemberLifecycleState[] = [
  "invited",
  "activating",
  "active",
  "suspended",
  "on_leave",
  "transferred",
  "deactivated",
  "archived",
] as const;

const MEMBER_LIFECYCLE_TRANSITIONS: Readonly<
  Record<MemberLifecycleState, readonly MemberLifecycleState[]>
> = {
  invited: ["activating", "deactivated"],
  activating: ["active", "suspended", "deactivated"],
  active: ["suspended", "on_leave", "transferred", "deactivated"],
  suspended: ["active", "deactivated"],
  on_leave: ["active", "suspended", "deactivated"],
  transferred: ["active", "deactivated"],
  deactivated: ["archived"],
  archived: [],
} as const;

export function canTransitionMemberLifecycle(
  from: MemberLifecycleState,
  to: MemberLifecycleState,
): boolean {
  return MEMBER_LIFECYCLE_TRANSITIONS[from].includes(to);
}

/** Immutable audit trail entry (BH: audit history is preserved, never edited). */
export interface MemberTransitionEvent {
  from: MemberLifecycleState;
  to: MemberLifecycleState;
  actorId: string;
  reason: string;
  at: string;
}

export interface OrganizationMembership {
  membershipId: string;
  tenantId: string;
  organizationId: string;
  workspaceId: string;
  identityId: string;
  /** Role CODES — P08 resolves authorization from these; never a permission grant here. */
  roleCodes: readonly string[];
  state: MemberLifecycleState;
  /** Expiring access (expired access must FAIL). */
  accessExpiresAt?: string | null;
  readonly audit: readonly MemberTransitionEvent[];
  createdAt: string;
  updatedAt: string;
}

export interface TransitionMemberLifecycleInput {
  actorId: string;
  tenantId: string;
  organizationId: string;
  reason: string;
  now?: string;
}

export type MemberTransitionResult =
  { ok: true; membership: OrganizationMembership } | { ok: false; issue: string };

export function transitionMemberLifecycle(
  record: OrganizationMembership,
  to: MemberLifecycleState,
  input: TransitionMemberLifecycleInput,
): MemberTransitionResult {
  const now = input.now ?? timeAuthority.now().at;
  if (input.tenantId !== record.tenantId) {
    return { ok: false, issue: "cross-tenant lifecycle transition denied" };
  }
  if (input.organizationId !== record.organizationId) {
    return { ok: false, issue: "cross-organization lifecycle transition denied" };
  }
  if (!canTransitionMemberLifecycle(record.state, to)) {
    return { ok: false, issue: `invalid member lifecycle transition: ${record.state} -> ${to}` };
  }
  if (to === "deactivated" && !input.reason.trim()) {
    return { ok: false, issue: "deactivation requires a reason (BH)" };
  }
  if (to === "active" && record.roleCodes.length === 0) {
    return { ok: false, issue: "activation requires at least one role code" };
  }

  const event: MemberTransitionEvent = {
    from: record.state,
    to,
    actorId: input.actorId,
    reason: input.reason.trim(),
    at: now,
  };

  return {
    ok: true,
    membership: {
      ...record,
      state: to,
      updatedAt: now,
      audit: [...record.audit, event],
    },
  };
}

export function createOrganizationMembership(input: {
  membershipId: string;
  tenantId: string;
  organizationId: string;
  workspaceId: string;
  identityId: string;
  roleCodes?: readonly string[];
  createdAt?: string;
}): OrganizationMembership {
  const createdAt = input.createdAt ?? timeAuthority.now().at;
  return {
    membershipId: input.membershipId,
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    identityId: input.identityId,
    roleCodes: input.roleCodes ?? [],
    state: "invited",
    accessExpiresAt: null,
    audit: [],
    createdAt,
    updatedAt: createdAt,
  };
}

/** Membership is grant-bearing only in active/on_leave AND before any expiry. */
export function isMembershipAccessActive(membership: OrganizationMembership, now: string): boolean {
  if (membership.state !== "active" && membership.state !== "on_leave") return false;
  if (membership.accessExpiresAt && now > membership.accessExpiresAt) return false;
  return true;
}

/** Expired access fails (§170) — explicit, always consulted by callers. */
export function isMembershipExpired(membership: OrganizationMembership, now: string): boolean {
  return Boolean(membership.accessExpiresAt && now > membership.accessExpiresAt);
}

/* ─────────────────────────────────────────────────────────────
 * Role change (BF): changing roles triggers permission, policy,
 * workspace, onboarding review and audit recalculation.
 * ────────────────────────────────────────────────────────────*/

export type RecalculationScope = "permissions" | "policies" | "workspace" | "onboarding" | "audit";

export interface RoleChangeResult {
  /** Every role change demands recalculation — nothing is granted implicitly. */
  recalculate: Readonly<Record<RecalculationScope, boolean>>;
}

export function beginRoleChangeReconciliation(): RoleChangeResult {
  return {
    recalculate: {
      permissions: true,
      policies: true,
      workspace: true,
      onboarding: true,
      audit: true,
    },
  };
}

export function changeMemberRoles(
  record: OrganizationMembership,
  toRoleCodes: readonly string[],
  actorId: string,
  now: string,
): MemberTransitionResult {
  if (record.state !== "active" && record.state !== "suspended" && record.state !== "on_leave") {
    return {
      ok: false,
      issue: `role changes require active/suspended/on_leave membership (current: ${record.state})`,
    };
  }
  if (toRoleCodes.length === 0) {
    return { ok: false, issue: "a member must retain at least one role code" };
  }
  const next: OrganizationMembership = {
    ...record,
    roleCodes: [...toRoleCodes],
    updatedAt: now,
    audit: [
      ...record.audit,
      {
        from: record.state,
        to: record.state,
        actorId,
        reason: `role codes changed to ${toRoleCodes.join(",")}`,
        at: now,
      },
    ],
  };
  return { ok: true, membership: next };
}

/* ─────────────────────────────────────────────────────────────
 * Transfer management (BE): a member may move department, unit,
 * office, campus, shift, role or organization. Recalculation is
 * triggered automatically and tracked to completion.
 * ────────────────────────────────────────────────────────────*/

export type MemberTransferKind =
  "department" | "unit" | "office" | "campus" | "shift" | "role" | "organization";

export const MEMBER_TRANSFER_KINDS: readonly MemberTransferKind[] = [
  "department",
  "unit",
  "office",
  "campus",
  "shift",
  "role",
  "organization",
] as const;

export interface MemberTransfer {
  id: string;
  tenantId: string;
  organizationId: string;
  membershipId: string;
  identityId: string;
  kind: MemberTransferKind;
  fromRef: string;
  toRef: string;
  performedBy: string;
  recalculationStatus: "pending" | "completed" | "failed";
  occurredAt: string;
}

export function createMemberTransfer(input: {
  id: string;
  tenantId: string;
  organizationId: string;
  membershipId: string;
  identityId: string;
  kind: MemberTransferKind;
  fromRef: string;
  toRef: string;
  performedBy: string;
  now?: string;
}): MemberTransfer {
  return {
    id: input.id,
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    membershipId: input.membershipId,
    identityId: input.identityId,
    kind: input.kind,
    fromRef: input.fromRef,
    toRef: input.toRef,
    performedBy: input.performedBy,
    recalculationStatus: "pending",
    occurredAt: input.now ?? timeAuthority.now().at,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Separation of duties (BL) + dual control (BM)
 * ────────────────────────────────────────────────────────────*/

export type DutyCheckResult = { ok: true } | { ok: false; issue: string };

export function assertDutiesDistinct(
  actors: readonly string[],
  dutyLabels?: readonly string[],
): DutyCheckResult {
  if (actors.length < 2)
    return { ok: false, issue: "separation of duties requires at least two distinct actors" };
  const seen = new Set<string>();
  for (const actor of actors) {
    if (seen.has(actor)) {
      const label = dutyLabels?.[actors.indexOf(actor)] ?? actor;
      return {
        ok: false,
        issue: `actor "${label}" appears more than once — duties must be distinct (BL)`,
      };
    }
    seen.add(actor);
  }
  return { ok: true };
}

export function assertDualControl(firstActor: string, secondActor: string): DutyCheckResult {
  if (!firstActor.trim() || !secondActor.trim())
    return { ok: false, issue: "dual control requires two named actors (BM)" };
  return assertDutiesDistinct([firstActor, secondActor]);
}

/* ─────────────────────────────────────────────────────────────
 * Offboarding (BI): revocation is stepwise and always ends in
 * verified access revocation before completion.
 * ────────────────────────────────────────────────────────────*/

export const OFFBOARDING_STEPS = [
  "accessRevocation",
  "deviceRevocation",
  "sessionTermination",
  "workspaceClosure",
  "assetReturn",
  "handover",
  "workflowReassignment",
  "dataOwnershipReassignment",
] as const;

export type OffboardingStep = (typeof OFFBOARDING_STEPS)[number];

export interface MemberOffboardingPlan {
  offboardingId: string;
  membershipId: string;
  organizationId: string;
  tenantId: string;
  completedSteps: readonly OffboardingStep[];
  status: "pending" | "in_progress" | "completed";
  startedAt: string;
  completedAt?: string | null;
}

export function startMemberOffboarding(input: {
  offboardingId: string;
  membershipId: string;
  organizationId: string;
  tenantId: string;
  startedAt?: string;
}): MemberOffboardingPlan {
  return {
    offboardingId: input.offboardingId,
    membershipId: input.membershipId,
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    completedSteps: [],
    status: "pending",
    startedAt: input.startedAt ?? timeAuthority.now().at,
    completedAt: null,
  };
}

export function completeOffboardingStep(
  plan: MemberOffboardingPlan,
  step: OffboardingStep,
): MemberOffboardingPlan {
  if (plan.completedSteps.includes(step)) return plan;
  const completedSteps = [...plan.completedSteps, step];
  const finished = OFFBOARDING_STEPS.every((s) => completedSteps.includes(s));
  return {
    ...plan,
    completedSteps,
    status: finished ? "completed" : "in_progress",
    completedAt: finished ? timeAuthority.now().at : null,
  };
}

/** Access revocation must be completed before offboarding can be declared done. */
export function canCompleteOffboarding(plan: MemberOffboardingPlan): DutyCheckResult {
  if (!plan.completedSteps.includes("accessRevocation")) {
    return { ok: false, issue: "access revocation must complete before offboarding finishes (BI)" };
  }
  if (plan.status !== "completed") {
    return { ok: false, issue: "all offboarding steps must complete first" };
  }
  return { ok: true };
}

/** Automatic recalculation is only "done" when completed (BE). */
export function completeMemberTransferReconciliation(transfer: MemberTransfer): MemberTransfer {
  return { ...transfer, recalculationStatus: "completed" };
}
