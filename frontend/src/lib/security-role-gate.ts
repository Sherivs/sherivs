/**
 * CoreGrid — Phase 08 Security Engine: canonical runtime role gate.
 *
 * Single enforcement module for role-scoped server functions. The supported
 * role kinds evaluate through the Phase 08 security gateway
 * (`security-core.evaluateSecurityGateway`), which remains the single
 * decision authority: fail-closed by default (§I.5), never a silent allow on
 * an unknown signal (AT.9).
 *
 * Neutrality (V1-006): the decision mechanics are the domain-neutral core in
 * `rbac/role-gate.ts` — lifecycle/session enforcement and a binding-driven
 * gate decision. An installed runtime contributes its gate kinds, database
 * RPC primitives and role-set memberships through
 * `registerRuntimeRoleGate`; resolution is registry-first. The constants
 * marked LEGACY below are the frozen contribution of the FIRST INSTALLED
 * RUNTIME (runtime-001), quarantined here so that consumers which import
 * only this module keep byte-identical behavior; they exist purely as the
 * fallback until every consumer resolves the runtime's own contribution (the
 * registered binding is value-identical — see the runtime's adapter under
 * `domain-config/`).
 *
 * Boundary:
 * - Phase 02 owns identity; this module consumes identity assertions.
 * - Phase 03 owns tenancy; the resolved scope is the tenant boundary.
 * - Phase 08 owns the security decision; this module owns no state.
 * - Row-Level Security remains the database boundary. This gate implements
 *   the application/database agreement (§19 phase-01). Neither layer is
 *   sufficient alone; both must agree.
 *
 * Lifecycle enforcement (AGENTS §27/§31): every decision accepts additive
 * lifecycle/session signals (`LifecycleSignals`). When supplied, a
 * non-usable identity lifecycle (anything outside active/provisioned) and a
 * non-active session (expired/revoked/terminated or an explicit false
 * validity assertion) DENY before the role is ever consulted. The pure
 * decision (`evaluateRoleGate`) is unit-testable without a database.
 */

import {
  evaluateGateDecision,
  resolveGateKindBinding,
  resolveStaffRoleSet,
} from "./rbac/role-gate";
import type { RoleGateKindBinding } from "./rbac/role-gate";
import { checkLifecycleSignals, type LifecycleSignals } from "./rbac/role-gate";
import { evaluateSecurityGateway } from "./security-core";

/* Re-exported from the neutral gate core: the shared lifecycle/session
 * contract every gate decision accepts. */
export { checkLifecycleSignals } from "./rbac/role-gate";
export type { LifecycleGateCheck, LifecycleSignals } from "./rbac/role-gate";

/* ─────────────────────────────────────────────────────────────
 * Pure decision contract
 * ────────────────────────────────────────────────────────────*/

export type RoleGateKind = "school_admin" | "platform_super_admin";

export interface RoleGateSignals extends LifecycleSignals {
  /** Result of the role RPC. Anything but `true` fails closed. */
  roleGranted?: boolean | null;
  /** Resolved scope for scope-requiring kinds; unused for platform roles. */
  scope?: string | null;
}

export type RoleGateOutcome =
  | {
      decision: "allow";
      /** Resolved, trimmed scope; null for platform roles. */
      scope: string | null;
      reason: "Role gate verified";
      /** Present (true) only on an opted-in allow that left lifecycle/session unverified. */
      lifecycleUnverified?: boolean;
    }
  | {
      decision: "deny";
      code:
        | "role_required"
        | "tenant_unresolved"
        | "gateway_deny"
        | "lifecycle_denied"
        | "session_denied";
      reason: string;
    };

/**
 * LEGACY (runtime-001 fallback, frozen): canonical deny reasons and kind
 * semantics. The registered runtime binding carries identical values; these
 * constants serve only consumers that load this module without any runtime
 * contribution registered.
 */
const REASONS = {
  institutionAdminRole: "Forbidden: school admin role required",
  platformSuperAdminRole: "Forbidden: platform super admin role required",
  tenantUnresolved: "No school in scope",
  gatewayDeny: "Forbidden: role access denied",
} as const;

const LEGACY_GATE_KINDS: Readonly<
  Record<
    RoleGateKind,
    Pick<RoleGateKindBinding, "requiresScope" | "roleRequiredReason" | "tenantUnresolvedReason">
  >
> = {
  school_admin: {
    requiresScope: true,
    roleRequiredReason: REASONS.institutionAdminRole,
    tenantUnresolvedReason: REASONS.tenantUnresolved,
  },
  platform_super_admin: {
    requiresScope: false,
    roleRequiredReason: REASONS.platformSuperAdminRole,
    tenantUnresolvedReason: REASONS.tenantUnresolved,
  },
};

// The Supabase client type is intentionally structural: only the RPC surface
// is used, matching the legacy helpers this gate replaces.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseRpcClient = any;

type GateKindRpc = { role: string; scope?: string };

/**
 * LEGACY (runtime-001 fallback, frozen): the RPC primitives resolving each
 * gate kind's role (and tenant-scope) signal. Registry-first: a registered
 * runtime binding supplies identical values; this table serves only
 * consumers that load this module without a contribution registered.
 */
const ROLE_RPC: Record<RoleGateKind, GateKindRpc> = {
  school_admin: { role: "is_school_admin", scope: "get_my_school_id" },
  platform_super_admin: { role: "is_super_admin" },
};

function gateKindRpc(kind: RoleGateKind): GateKindRpc {
  return resolveGateKindBinding(kind)?.rpc ?? ROLE_RPC[kind];
}

/**
 * Decide whether an actor may perform a role-scoped operation.
 *
 * Evaluation order:
 *   1. Lifecycle/session gate — fail closed on non-usable identity state or
 *      a non-active session (AGENTS §31: expired/revoked access fails).
 *   2. Role gate — the actor must hold the required role.
 *   3. Tenant gate — scope-requiring kinds must have a non-empty scope.
 *   4. Security gateway — fail-closed confirmation (default rule §I.5).
 *
 * Any missing/unknown signal is a DENY, never a silent allow (AT.9).
 */
export function evaluateRoleGate(kind: RoleGateKind, signals: RoleGateSignals): RoleGateOutcome {
  const binding: RoleGateKindBinding = resolveGateKindBinding(kind) ?? {
    kind,
    ...LEGACY_GATE_KINDS[kind],
    rpc: ROLE_RPC[kind],
  };
  return evaluateGateDecision(binding, signals);
}

/* ─────────────────────────────────────────────────────────────
 * Server adapters (consume the runtime-declared RPC primitives)
 * ────────────────────────────────────────────────────────────*/

/**
 * Resolve the role signal (and scope where applicable) from the database RPC
 * primitives and evaluate the role gate. The optional lifecycle signals are
 * threaded through to the decision whenever the call site holds the acting
 * identity's lifecycle/session state (additive param; existing call sites
 * unchanged). Does not throw on DENY — callers that need composite (any-of)
 * authorization resolve multiple kinds and combine the outcomes. Throws only
 * on an RPC-level error.
 */
export async function resolveRoleGate(
  supabase: SupabaseRpcClient,
  kind: RoleGateKind,
  lifecycle?: LifecycleSignals,
): Promise<RoleGateOutcome> {
  const rpc = gateKindRpc(kind);
  const roleRes = await supabase.rpc(rpc.role);
  if (roleRes.error) {
    throw new Error(roleRes.error?.message ?? "Failed to verify role access");
  }

  let scope: string | null = null;
  if (rpc.scope) {
    const scopeRes = await supabase.rpc(rpc.scope);
    if (scopeRes.error) {
      throw new Error(scopeRes.error?.message ?? "Failed to resolve scope");
    }
    scope = (scopeRes.data as string | null) ?? null;
  }

  return evaluateRoleGate(kind, {
    roleGranted: (roleRes.data as boolean | null) ?? false,
    scope,
    ...lifecycle,
  });
}

/** Assert a single role kind; throws a canonical reason on DENY. */
export async function assertRoleScope(
  supabase: SupabaseRpcClient,
  kind: RoleGateKind,
  lifecycle?: LifecycleSignals,
): Promise<string | null> {
  const gate = await resolveRoleGate(supabase, kind, lifecycle);
  if (gate.decision !== "allow") {
    throw new Error(gate.reason);
  }
  return gate.scope;
}

/** Assert the first installed runtime's institution-admin scope and return its tenant id. */
export async function requireSchoolAdminScope(
  supabase: SupabaseRpcClient,
  lifecycle?: LifecycleSignals,
): Promise<string> {
  const scope = await assertRoleScope(supabase, "school_admin", lifecycle);
  if (scope === null) {
    // Defensive: a null scope is a DENY in the gate above; this guards against
    // future divergence between the gate and this adapter.
    throw new Error(REASONS.tenantUnresolved);
  }
  return scope;
}

/** Assert a platform super-admin. */
export async function requirePlatformSuperAdmin(
  supabase: SupabaseRpcClient,
  lifecycle?: LifecycleSignals,
): Promise<void> {
  await assertRoleScope(supabase, "platform_super_admin", lifecycle);
}

/* ─────────────────────────────────────────────────────────────
 * Composite account-administration decision
 * (super-admin OR same-tenant institution admin)
 * ────────────────────────────────────────────────────────────*/

export interface AccountAdministrationSignals extends LifecycleSignals {
  /** Platform super-admin resolved. */
  platformSuper: boolean;
  /** Same-tenant institution-admin role resolved. */
  schoolAdmin: boolean;
  /** Tenant scope of the institution-admin actor (null when not resolved). */
  schoolScope: string | null;
  /** Tenant of the target record. Null/omitted when no target check applies. */
  targetSchoolId?: string | null;
}

export type AccountAdministrationOutcome =
  | {
      decision: "allow";
      actor: "platform_super";
      scope: null;
      /** Present (true) only on an opted-in allow that left lifecycle/session unverified. */
      lifecycleUnverified?: boolean;
    }
  | {
      decision: "allow";
      actor: "school_admin";
      scope: string;
      /** Present (true) only on an opted-in allow that left lifecycle/session unverified. */
      lifecycleUnverified?: boolean;
    }
  | {
      decision: "deny";
      code:
        | "role_required"
        | "tenant_unresolved"
        | "not_same_tenant"
        | "lifecycle_denied"
        | "session_denied";
      reason: string;
    };

/**
 * Decide composite account-administration access: platform super-admins may
 * act on any tenant; institution admins may act only inside their own tenant
 * and (when a target is supplied) only on records that belong to that same
 * tenant. Anything else fails closed — including a non-usable identity
 * lifecycle or a non-active session, which deny before any role is consulted
 * (AGENTS §31). Reason strings are frozen behavior.
 */
export function decideAccountAdministration(
  signals: AccountAdministrationSignals,
): AccountAdministrationOutcome {
  const lifecycle = checkLifecycleSignals(signals);
  if (!lifecycle.ok) {
    return { decision: "deny", code: lifecycle.code, reason: lifecycle.reason };
  }

  if (signals.platformSuper) {
    const allow = { decision: "allow" as const, actor: "platform_super" as const, scope: null };
    return lifecycle.lifecycleUnverified ? { ...allow, lifecycleUnverified: true } : allow;
  }

  if (!signals.schoolAdmin) {
    return {
      decision: "deny",
      code: "role_required",
      reason: "Forbidden: only school admins or platform super admins may administer accounts",
    };
  }

  const scope = signals.schoolScope?.trim() ?? "";
  if (scope === "") {
    return {
      decision: "deny",
      code: "tenant_unresolved",
      reason: "School admin is not linked to a school",
    };
  }

  if (signals.targetSchoolId != null && signals.targetSchoolId !== scope) {
    return {
      decision: "deny",
      code: "not_same_tenant",
      reason: "Not allowed: the target record is outside the actor's school scope",
    };
  }

  const allow = { decision: "allow" as const, actor: "school_admin" as const, scope };
  return lifecycle.lifecycleUnverified ? { ...allow, lifecycleUnverified: true } : allow;
}

/* ─────────────────────────────────────────────────────────────
 * Institution staff context (role sets beyond the admin kind)
 * ────────────────────────────────────────────────────────────*/

/**
 * LEGACY (runtime-001 fallback, frozen): staff roles as the first installed
 * runtime's own vocabulary (the legacy `public.users.role` column), resolved
 * through its `public.get_my_role()` RPC — the core imports no runtime's
 * role table and keeps role-set membership registry-driven
 * (`resolveStaffRoleSet`); a second runtime supplies its own role sets
 * through `registerRuntimeRoleGate`, never by editing this module. The
 * fallback below serves only consumers that load this module without the
 * runtime's contribution registered.
 */
export type SchoolStaffRole = "admin" | "principal" | "teacher" | "bursar";

/**
 * Role sets a server-function family may require. Membership mirrors the
 * database truth (migration 20260620122110) of the first installed runtime.
 * Anything outside these sets fails closed.
 */
export type SchoolStaffKind =
  "school_admin" | "school_teacher" | "teaching_staff" | "finance_staff";

export const SCHOOL_STAFF_ROLES: Record<SchoolStaffKind, readonly SchoolStaffRole[]> = {
  school_admin: ["admin", "principal"],
  school_teacher: ["teacher"],
  teaching_staff: ["admin", "principal", "teacher"],
  finance_staff: ["admin", "principal", "bursar"],
};

const STAFF_REASONS = {
  roleRequired: "Forbidden: role not authorized for this operation",
  tenantUnresolved: "No school in scope",
  gatewayDeny: "Forbidden: role access denied",
  lifecycleDenied: "Forbidden: identity lifecycle does not permit execution",
  sessionDenied: "Forbidden: session is expired or revoked",
} as const;

export interface StaffDecisionSignals extends LifecycleSignals {
  /** Actor role from the runtime's identity store (resolved via its RPC). */
  role?: string | null;
  /** Resolved tenant scope. */
  scope?: string | null;
}

export type StaffDecision =
  | {
      decision: "allow";
      role: SchoolStaffRole;
      scope: string;
      reason: "Staff role verified";
      /** Present (true) only on an opted-in allow that left lifecycle/session unverified. */
      lifecycleUnverified?: boolean;
    }
  | {
      decision: "deny";
      code:
        | "role_required"
        | "tenant_unresolved"
        | "gateway_deny"
        | "lifecycle_denied"
        | "session_denied";
      reason: string;
    };

/**
 * Pure decision for a runtime staff role set. Fails closed on any unknown,
 * missing or malformed signal (AT.9): a role outside the set, a null/blank
 * scope, a non-usable identity lifecycle, a non-active session, or a
 * non-allow security-gateway outcome is a DENY — never a silent grant.
 * Role-set membership is registry-first (`resolveStaffRoleSet`); the frozen
 * runtime-001 table above is the fallback.
 */
export function decideStaffRole(
  kind: SchoolStaffKind,
  signals: StaffDecisionSignals,
): StaffDecision {
  const lifecycle = checkLifecycleSignals(signals);
  if (!lifecycle.ok) {
    return { decision: "deny", code: lifecycle.code, reason: lifecycle.reason };
  }

  const allowed = (resolveStaffRoleSet(kind) ?? SCHOOL_STAFF_ROLES[kind]) as readonly string[];
  const rawRole = signals.role?.trim().toLowerCase() ?? "";
  if (!allowed.includes(rawRole)) {
    return { decision: "deny", code: "role_required", reason: STAFF_REASONS.roleRequired };
  }

  const scope = signals.scope?.trim() ?? "";
  if (scope === "") {
    return { decision: "deny", code: "tenant_unresolved", reason: STAFF_REASONS.tenantUnresolved };
  }

  const gateway = evaluateSecurityGateway({
    identityValid: true,
    tenantContextValid: true,
    sessionValid: true,
    withinRateLimit: true,
    requestIntegrityValid: true,
    authorizationDecision: "ALLOW",
  });
  if (gateway.decision !== "allow") {
    return { decision: "deny", code: "gateway_deny", reason: STAFF_REASONS.gatewayDeny };
  }

  const allow = {
    decision: "allow" as const,
    role: rawRole as SchoolStaffRole,
    scope,
    reason: "Staff role verified" as const,
  };
  return lifecycle.lifecycleUnverified ? { ...allow, lifecycleUnverified: true } : allow;
}

export interface SchoolStaffContext {
  role: SchoolStaffRole;
  schoolId: string;
}

/**
 * LEGACY (runtime-001 fallback, frozen): the RPC primitives resolving the
 * staff role and tenant-scope signals of the first installed runtime.
 */
const STAFF_SCOPE_RPC = "get_my_school_id";
const STAFF_ROLE_RPC = "get_my_role";

/**
 * Resolve the actor's staff role + tenant scope from the existing database
 * RPC primitives and evaluate the requested role set. The optional lifecycle
 * signals are threaded through to the decision whenever the call site holds
 * the acting identity's lifecycle/session state (additive param; existing
 * call sites unchanged). Does not throw on DENY (callers needing composite
 * any-of authorization may combine outcomes); throws only on an RPC-level
 * error.
 */
export async function resolveStaffContext(
  supabase: SupabaseRpcClient,
  kind: SchoolStaffKind,
  lifecycle?: LifecycleSignals,
): Promise<StaffDecision> {
  const roleRes = await supabase.rpc(STAFF_ROLE_RPC);
  if (roleRes.error) {
    throw new Error(roleRes.error?.message ?? "Failed to verify staff role");
  }
  const scopeRes = await supabase.rpc(STAFF_SCOPE_RPC);
  if (scopeRes.error) {
    throw new Error(scopeRes.error?.message ?? "Failed to resolve scope");
  }
  return decideStaffRole(kind, {
    role: (roleRes.data as string | null) ?? null,
    scope: (scopeRes.data as string | null) ?? null,
    ...lifecycle,
  });
}

/** Assert a staff role set; throws a canonical reason on DENY. */
export async function requireStaffContext(
  supabase: SupabaseRpcClient,
  kind: SchoolStaffKind,
  lifecycle?: LifecycleSignals,
): Promise<SchoolStaffContext> {
  const gate = await resolveStaffContext(supabase, kind, lifecycle);
  if (gate.decision !== "allow") {
    throw new Error(gate.reason);
  }
  return { role: gate.role, schoolId: gate.scope };
}
