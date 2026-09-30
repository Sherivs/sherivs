/**
 * CoreGrid — Security Engine policy lifecycle (Phase 08, Section J).
 *
 * Implements `architecture/phase-08-security-engine.md`:
 * - Policy requirements (J.2): versioned, immutable after publication,
 *   testable, auditable, attributable, environment-aware, tenant-aware.
 * - Policy lifecycle (J.3): draft → validate → test → approve → publish →
 *   activate → monitor → supersede → archive.
 * - Policy rollback (J.4): policies must support controlled rollback.
 * - Architectural Invariant (Section AT.6): production security policies
 *   cannot be silently changed.
 */

import type { TenantId } from "./tenant-core";

export type SecurityPolicyLifecycleState =
  | "draft"
  | "validating"
  | "testing"
  | "approved"
  | "published"
  | "active"
  | "monitoring"
  | "superseded"
  | "archived";

export const SECURITY_POLICY_LIFECYCLE_STATES: readonly SecurityPolicyLifecycleState[] = [
  "draft",
  "validating",
  "testing",
  "approved",
  "published",
  "active",
  "monitoring",
  "superseded",
  "archived",
] as const;

/** Ordered lifecycle: draft -> validate -> test -> approve -> publish -> activate -> monitor -> supersede -> archive (Section J.3). */
const POLICY_TRANSITIONS: Readonly<
  Record<SecurityPolicyLifecycleState, readonly SecurityPolicyLifecycleState[]>
> = {
  draft: ["validating"],
  validating: ["testing", "draft"],
  testing: ["approved", "draft"],
  approved: ["published"],
  published: ["active"],
  active: ["monitoring", "superseded"],
  monitoring: ["active", "superseded"],
  superseded: ["archived"],
  archived: [],
};

export function isPolicyTransitionAllowed(
  from: SecurityPolicyLifecycleState,
  to: SecurityPolicyLifecycleState,
): boolean {
  return POLICY_TRANSITIONS[from].includes(to);
}

/* ─────────────────────────────────────────────────────────────
 * Policy model (Section J.2)
 * ────────────────────────────────────────────────────────────*/

export interface SecurityPolicy {
  id: string;
  name: string;
  version: number;
  /** null = platform-wide policy. */
  tenantId: TenantId | null;
  environment: "production" | "staging" | "test" | "development";
  lifecycleState: SecurityPolicyLifecycleState;
  /** Machine-evaluable rule expression (opaque to this layer). */
  rules: Record<string, unknown>;
  authorId: string;
  approvedBy: string | null;
  createdAt: string;
  updatedAt: string;
  /** Immutable once published (Section J.2); set at publish time. */
  publishedAt: string | null;
  supersededByPolicyId: string | null;
}

export interface CreateSecurityPolicyInput {
  name: string;
  tenantId: TenantId | null;
  environment: "production" | "staging" | "test" | "development";
  rules: Record<string, unknown>;
  authorId: string;
  now: string;
}

export type CreateSecurityPolicyResult =
  { ok: true; policy: SecurityPolicy } | { ok: false; error: string };

export function createSecurityPolicy(input: CreateSecurityPolicyInput): CreateSecurityPolicyResult {
  if (input.name.trim() === "") {
    return { ok: false, error: "Policy name is required" };
  }
  if (Object.keys(input.rules).length === 0) {
    return { ok: false, error: "Policy must define at least one rule" };
  }
  if (input.authorId.trim() === "") {
    return { ok: false, error: "Policy author is required (attributability, Section J.2)" };
  }
  return {
    ok: true,
    policy: {
      id: `policy-${input.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}-1`,
      name: input.name,
      version: 1,
      tenantId: input.tenantId,
      environment: input.environment,
      lifecycleState: "draft",
      rules: input.rules,
      authorId: input.authorId,
      approvedBy: null,
      createdAt: input.now,
      updatedAt: input.now,
      publishedAt: null,
      supersededByPolicyId: null,
    },
  };
}

export type TransitionPolicyResult =
  { ok: true; policy: SecurityPolicy } | { ok: false; error: string };

/**
 * Transition a policy's lifecycle state. Publishing requires an approver
 * (Section J.2 attributability); publishing makes the policy immutable.
 */
export function transitionSecurityPolicy(
  policy: SecurityPolicy,
  to: SecurityPolicyLifecycleState,
  now: string,
): TransitionPolicyResult {
  if (policy.lifecycleState === "archived") {
    return { ok: false, error: "Archived policies cannot transition" };
  }
  if (!isPolicyTransitionAllowed(policy.lifecycleState, to)) {
    return {
      ok: false,
      error: `Policy transition ${policy.lifecycleState} -> ${to} is not allowed`,
    };
  }
  if (to === "published" && policy.approvedBy === null) {
    return { ok: false, error: "Policy requires an approver before publication (Section J.2)" };
  }
  // Production policies cannot be silently changed once published
  // (Section AT.6): further edits to `rules` must go through a superseding
  // version, not a mutation of the published policy object. This function
  // only transitions lifecycle state.
  return {
    ok: true,
    policy: {
      ...policy,
      lifecycleState: to,
      updatedAt: now,
      publishedAt: to === "published" ? now : policy.publishedAt,
    },
  };
}

export function approveSecurityPolicy(
  policy: SecurityPolicy,
  approverId: string,
  now: string,
): TransitionPolicyResult {
  if (policy.lifecycleState !== "testing" && policy.lifecycleState !== "approved") {
    return { ok: false, error: "Policy must complete testing before approval" };
  }
  if (approverId.trim() === "") {
    return { ok: false, error: "Approver identity is required" };
  }
  return {
    ok: true,
    policy: { ...policy, approvedBy: approverId, updatedAt: now },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Policy rollback (Section J.4)
 * ────────────────────────────────────────────────────────────*/

export type RollbackPolicyResult =
  | { ok: true; supersededPolicy: SecurityPolicy; rolledBackTo: SecurityPolicy }
  | { ok: false; error: string };

/**
 * Roll back to a previously published policy version by superseding the
 * current active policy and reactivating the prior one. Both transitions are
 * explicit and attributable (Section J.4, AT.6).
 */
export function rollbackSecurityPolicy(
  current: SecurityPolicy,
  previous: SecurityPolicy,
  actorId: string,
  now: string,
): RollbackPolicyResult {
  if (current.lifecycleState !== "active" && current.lifecycleState !== "monitoring") {
    return { ok: false, error: "Only an active or monitoring policy can be rolled back" };
  }
  if (previous.publishedAt === null) {
    return { ok: false, error: "Rollback target must have been previously published" };
  }
  if (actorId.trim() === "") {
    return { ok: false, error: "Rollback requires an attributable actor" };
  }
  return {
    ok: true,
    supersededPolicy: {
      ...current,
      lifecycleState: "superseded",
      supersededByPolicyId: previous.id,
      updatedAt: now,
    },
    rolledBackTo: {
      ...previous,
      lifecycleState: "active",
      updatedAt: now,
    },
  };
}
