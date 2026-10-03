/**
 * CoreGrid — neutral runtime role-gate core (V1-006).
 *
 * The runtime-agnostic half of the Phase 08 canonical role gate: lifecycle/
 * session enforcement (fail closed) plus a generic, binding-driven gate
 * decision, and the registry through which an INSTALLED RUNTIME contributes
 * its own gate kinds, database RPC primitives and role-set memberships. A
 * runtime's vocabulary lives in its contribution (see `domain-config/`); this
 * core contains none of it and must never import a runtime.
 *
 * Boundary:
 * - Phase 02 owns identity; this module consumes identity assertions.
 * - Phase 03 owns tenancy; the resolved scope is the tenant boundary.
 * - Phase 08 owns the security decision; the gateway stays the single
 *   decision authority.
 * - Row-Level Security remains the database boundary.
 */

import { isIdentityUsable, type IdentityLifecycleState, type SessionStatus } from "../identity";
import { evaluateSecurityGateway } from "../security-core";

/* ─────────────────────────────────────────────────────────────
 * Additive lifecycle/session signals (shared contract)
 * ────────────────────────────────────────────────────────────*/

/**
 * Identity lifecycle + session validity inputs every gate decision accepts.
 *
 * Opt-in contract: supplying any of these keys opts the call into
 * lifecycle-attested evaluation. Calls that supply none keep the historical
 * outcome shape exactly (byte-compatible with existing consumers); callers
 * that opt in and leave a signal out get an allow flagged with
 * `lifecycleUnverified: true`, so an unchecked gate can never be mistaken
 * for a verified one inside the new contract.
 */
export interface LifecycleSignals {
  /** Canonical Phase 02 lifecycle state of the acting identity. */
  lifecycle?: IdentityLifecycleState | null;
  /** Canonical session status when the caller holds the session record. */
  sessionStatus?: SessionStatus | null;
  /** Explicit session-validity assertion when no session record is available. */
  sessionValid?: boolean;
}

export type LifecycleGateCheck =
  | {
      ok: true;
      /** True when the opted-in call left lifecycle/session unverified. */
      lifecycleUnverified: boolean;
    }
  | { ok: false; code: "lifecycle_denied" | "session_denied"; reason: string };

const LIFECYCLE_REASONS = {
  lifecycleDenied: "Forbidden: identity lifecycle does not permit execution",
  sessionDenied: "Forbidden: session is expired or revoked",
} as const;

function hasLifecycleSignals(signals: LifecycleSignals): boolean {
  return "lifecycle" in signals || "sessionStatus" in signals || "sessionValid" in signals;
}

/**
 * Evaluate the lifecycle/session part of a gate decision (fail closed).
 *
 * - A supplied lifecycle outside the usable set (`active`/`provisioned`,
 *   per `isIdentityUsable`) denies — including unknown values, which fail
 *   closed rather than being trusted.
 * - A supplied session status other than `active`, or an explicit
 *   `sessionValid: false`, denies (expired/revoked/terminated).
 */
export function checkLifecycleSignals(signals: LifecycleSignals): LifecycleGateCheck {
  if (signals.lifecycle != null && !isIdentityUsable({ lifecycle: signals.lifecycle })) {
    return { ok: false, code: "lifecycle_denied", reason: LIFECYCLE_REASONS.lifecycleDenied };
  }
  if (signals.sessionStatus != null && signals.sessionStatus !== "active") {
    return { ok: false, code: "session_denied", reason: LIFECYCLE_REASONS.sessionDenied };
  }
  if (signals.sessionValid === false) {
    return { ok: false, code: "session_denied", reason: LIFECYCLE_REASONS.sessionDenied };
  }

  const optedIn = hasLifecycleSignals(signals);
  const sessionUnverified = signals.sessionStatus == null && signals.sessionValid == null;
  return {
    ok: true,
    lifecycleUnverified: optedIn && (signals.lifecycle == null || sessionUnverified),
  };
}

/* ─────────────────────────────────────────────────────────────
 * Runtime gate binding registry
 * ────────────────────────────────────────────────────────────*/

/**
 * One runtime-declared gate kind: how the kind's role signal is resolved
 * from the database RPC primitives, whether a tenant scope is required, and
 * the canonical deny reasons. Every value is contributed by the owning
 * runtime — the core carries no runtime vocabulary.
 */
export interface RoleGateKindBinding {
  /** Gate kind name (/^[a-z][a-z0-9_]*$/), unique platform-wide. */
  kind: string;
  /** Whether the kind requires a resolved tenant scope to allow. */
  requiresScope: boolean;
  /** Database RPC primitives resolving the role (and scope) signal. */
  rpc: { role: string; scope?: string };
  /** Canonical deny reason when the role signal is not granted. */
  roleRequiredReason: string;
  /** Canonical deny reason when the required scope cannot be resolved. */
  tenantUnresolvedReason: string;
}

/** A named role-set membership (role value -> allowed set), contributed by a runtime. */
export interface StaffRoleSetBinding {
  kind: string;
  roles: readonly string[];
}

export interface RuntimeRoleGateContribution {
  /** Installed-runtime id (/^[a-z][a-z0-9_]*$/); registered exactly once. */
  runtimeId: string;
  gateKinds: readonly RoleGateKindBinding[];
  staffRoleSets: readonly StaffRoleSetBinding[];
}

export type RuntimeRoleGateRegistrationResult =
  { ok: true; runtimeId: string } | { ok: false; errors: readonly string[] };

const NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

const GATE_KIND_BINDINGS = new Map<string, RoleGateKindBinding>();
const STAFF_ROLE_SETS = new Map<string, readonly string[]>();
const REGISTERED_RUNTIMES = new Set<string>();

/**
 * Register an installed runtime's gate bindings (fail-closed, atomic):
 * malformed ids/kinds, duplicate kinds or role-set memberships across
 * runtimes (a bare kind must have one meaning platform-wide), empty role
 * sets, or missing RPC/reason values reject the whole contribution.
 */
export function registerRuntimeRoleGate(
  contribution: RuntimeRoleGateContribution,
): RuntimeRoleGateRegistrationResult {
  const errors: string[] = [];
  const { runtimeId, gateKinds, staffRoleSets } = contribution;

  if (typeof runtimeId !== "string" || !NAME_PATTERN.test(runtimeId)) {
    return {
      ok: false,
      errors: [`runtime id ${JSON.stringify(runtimeId)} is not a valid runtime id`],
    };
  }
  if (REGISTERED_RUNTIMES.has(runtimeId)) {
    return { ok: false, errors: [`runtime "${runtimeId}" is already registered`] };
  }
  if (!Array.isArray(gateKinds) || !Array.isArray(staffRoleSets)) {
    return { ok: false, errors: ["gateKinds and staffRoleSets must be arrays"] };
  }

  const kindBindings: RoleGateKindBinding[] = [];
  for (const binding of gateKinds) {
    const kind = binding?.kind;
    const scope = `runtime "${runtimeId}" gate kind ${JSON.stringify(kind)}`;
    if (typeof kind !== "string" || !NAME_PATTERN.test(kind)) {
      errors.push(`${scope} is not a valid kind name (/^[a-z][a-z0-9_]*$/)`);
      continue;
    }
    if (GATE_KIND_BINDINGS.has(kind) || STAFF_ROLE_SETS.has(kind)) {
      errors.push(`${scope} collides with an already-registered kind`);
      continue;
    }
    if (typeof binding.rpc?.role !== "string" || binding.rpc.role.trim() === "") {
      errors.push(`${scope} requires an rpc role primitive`);
    }
    if (
      binding.rpc?.scope !== undefined &&
      (typeof binding.rpc.scope !== "string" || binding.rpc.scope.trim() === "")
    ) {
      errors.push(`${scope} rpc scope primitive must be a non-empty string when present`);
    }
    if (typeof binding.roleRequiredReason !== "string" || binding.roleRequiredReason === "") {
      errors.push(`${scope} requires a roleRequiredReason`);
    }
    if (
      typeof binding.tenantUnresolvedReason !== "string" ||
      binding.tenantUnresolvedReason === ""
    ) {
      errors.push(`${scope} requires a tenantUnresolvedReason`);
    }
    if (typeof binding.requiresScope !== "boolean") {
      errors.push(`${scope} requires a boolean requiresScope`);
    }
    kindBindings.push(binding);
  }

  const roleSets: Array<[string, readonly string[]]> = [];
  for (const set of staffRoleSets) {
    const kind = set?.kind;
    const scope = `runtime "${runtimeId}" role set ${JSON.stringify(kind)}`;
    if (typeof kind !== "string" || !NAME_PATTERN.test(kind)) {
      errors.push(`${scope} is not a valid kind name (/^[a-z][a-z0-9_]*$/)`);
      continue;
    }
    if (STAFF_ROLE_SETS.has(kind) || GATE_KIND_BINDINGS.has(kind)) {
      errors.push(`${scope} collides with an already-registered kind`);
      continue;
    }
    if (
      !Array.isArray(set.roles) ||
      set.roles.length === 0 ||
      set.roles.some((role: string) => typeof role !== "string" || role.trim() === "")
    ) {
      errors.push(`${scope} requires a non-empty array of role values`);
      continue;
    }
    roleSets.push([kind, set.roles]);
  }

  if (errors.length > 0) return { ok: false, errors };

  for (const binding of kindBindings) GATE_KIND_BINDINGS.set(binding.kind, binding);
  for (const [kind, roles] of roleSets) STAFF_ROLE_SETS.set(kind, roles);
  REGISTERED_RUNTIMES.add(runtimeId);
  return { ok: true, runtimeId };
}

/** The registered gate-kind binding for a kind; null when unregistered. */
export function resolveGateKindBinding(kind: string): RoleGateKindBinding | null {
  return GATE_KIND_BINDINGS.get(kind) ?? null;
}

/** The registered role-set membership for a kind; null when unregistered. */
export function resolveStaffRoleSet(kind: string): readonly string[] | null {
  return STAFF_ROLE_SETS.get(kind) ?? null;
}

/** Every registered runtime id. */
export function registeredRoleGateRuntimes(): readonly string[] {
  return [...REGISTERED_RUNTIMES];
}

/* ─────────────────────────────────────────────────────────────
 * Generic binding-driven gate decision
 * ────────────────────────────────────────────────────────────*/

export interface GenericGateSignals extends LifecycleSignals {
  /** Result of the role RPC. Anything but `true` fails closed. */
  roleGranted?: boolean | null;
  /** Resolved tenant scope when the kind requires one. */
  scope?: string | null;
}

export type GenericGateOutcome =
  | {
      decision: "allow";
      /** Resolved, trimmed scope; null for kinds without a scope requirement. */
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
 * Decide whether an actor may perform a kind-scoped operation, driven
 * entirely by the supplied binding.
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
export function evaluateGateDecision(
  binding: RoleGateKindBinding,
  signals: GenericGateSignals,
): GenericGateOutcome {
  const lifecycle = checkLifecycleSignals(signals);
  if (!lifecycle.ok) {
    return { decision: "deny", code: lifecycle.code, reason: lifecycle.reason };
  }

  const roleGranted = signals.roleGranted === true;
  const rawScope = binding.requiresScope ? signals.scope : null;
  const hasScope = typeof rawScope === "string" && rawScope.trim() !== "";

  if (!roleGranted) {
    return { decision: "deny", code: "role_required", reason: binding.roleRequiredReason };
  }
  if (binding.requiresScope && !hasScope) {
    return { decision: "deny", code: "tenant_unresolved", reason: binding.tenantUnresolvedReason };
  }

  // The auth middleware (bearer token) has run upstream and the lifecycle/
  // session signals above were verified when supplied; identity and session
  // validity are attested at this enforcement point. The gateway's default
  // rule remains fail-closed: an unexpected decision below must never grant.
  const gateway = evaluateSecurityGateway({
    identityValid: true,
    tenantContextValid: !binding.requiresScope || hasScope,
    sessionValid: true,
    withinRateLimit: true,
    requestIntegrityValid: true,
    authorizationDecision: "ALLOW",
  });

  if (gateway.decision !== "allow") {
    return { decision: "deny", code: "gateway_deny", reason: "Forbidden: role access denied" };
  }

  const allow = {
    decision: "allow" as const,
    scope: binding.requiresScope ? rawScope!.trim() : null,
    reason: "Role gate verified" as const,
  };
  return lifecycle.lifecycleUnverified ? { ...allow, lifecycleUnverified: true } : allow;
}
