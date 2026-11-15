/**
 * Sherivs Entity Engine — compiler, isolation rules and provisioning plan
 * (ENGINE-01, ADR-077 and ADR-078).
 *
 * One person has ONE twin (the Person Passport). Each membership the person
 * holds is an isolated CONTEXT of that twin, compiled from a Role Pack. Acting
 * in one context exposes only that context and the person's own core; nothing
 * from another tenant is reachable, and nothing flows from a context into the
 * person's core unless the tenant's policy allows it AND the person consented.
 *
 * `planProvisioning` is the pure decision the database trigger and the
 * reconcile job both implement: it answers "what must exist for this
 * membership event", idempotently and without any I/O.
 *
 * Pure module: no I/O, no clock, no vendor imports.
 */
import {
  type MemorySensitivity,
  type PackAutonomyMode,
  type RolePack,
  type RolePackTier,
} from "./role-pack";
import {
  effectiveAutonomy,
  initialTrust,
  type EffectiveAutonomy,
  type TrustRecord,
} from "./autonomy-ladder";

/** A membership fact, resolved server-side. Never supplied by a client. */
export interface MembershipFact {
  readonly identityId: string;
  readonly tenantId: string;
  readonly membershipId: string;
  readonly roleCode: string;
  readonly active: boolean;
}

export type MembershipEvent =
  | { readonly type: "activated"; readonly membership: MembershipFact }
  | { readonly type: "deactivated"; readonly membership: MembershipFact }
  | {
      readonly type: "role_changed";
      readonly membership: MembershipFact;
      readonly previousRoleCode: string;
    };

/** Structurally compatible with the personal-twin `LensSpec` (pinned by a test). */
export interface CompiledLensSpec {
  readonly lensId: string;
  readonly persona: string;
  readonly requestedPermissions: readonly string[];
  readonly tools: readonly { readonly toolId: string; readonly requiresPermission: string }[];
}

export interface AgentCapabilitySpec {
  readonly id: string;
  readonly tier: RolePackTier;
  readonly packAutonomy: PackAutonomyMode;
  readonly effective: EffectiveAutonomy;
  readonly requiresPermission: string;
  readonly connector: string | null;
}

export type ContextStatus = "active" | "pending_pack" | "suspended";

export interface ContextPlan {
  readonly contextKey: string;
  readonly identityId: string;
  readonly tenantId: string;
  readonly membershipId: string;
  readonly roleCode: string;
  readonly packCode: string | null;
  readonly packVersion: string | null;
  readonly status: ContextStatus;
  readonly memoryScopeId: string;
  readonly lens: CompiledLensSpec | null;
  readonly agent: {
    readonly capabilities: readonly AgentCapabilitySpec[];
    readonly trust: readonly TrustRecord[];
    readonly wakeEvents: readonly string[];
    readonly budget: RolePack["budget"];
    readonly memory: {
      readonly domains: readonly string[];
      readonly maxSensitivity: MemorySensitivity;
    };
  } | null;
}

export const personMemoryScopeId = (identityId: string): string => `twin-person:${identityId}`;
export const personMemoryTenant = (identityId: string): string => `person:${identityId}`;
export const contextKeyOf = (identityId: string, tenantId: string, roleCode: string): string =>
  `${identityId}:${tenantId}:${roleCode}`;
export const contextMemoryScopeId = (key: string): string => `twin-context:${key}`;

/** Compile one membership and its pack into a context plan. A missing pack
 * yields a `pending_pack` context with no agent: the person still has a twin
 * and a context, and the agent appears the moment a pack is published. */
export function compileContext(
  membership: MembershipFact,
  pack: RolePack | undefined,
): ContextPlan {
  const contextKey = contextKeyOf(membership.identityId, membership.tenantId, membership.roleCode);
  const base = {
    contextKey,
    identityId: membership.identityId,
    tenantId: membership.tenantId,
    membershipId: membership.membershipId,
    roleCode: membership.roleCode,
    memoryScopeId: contextMemoryScopeId(contextKey),
  };
  if (!membership.active) {
    return {
      ...base,
      packCode: pack?.code ?? null,
      packVersion: pack?.version ?? null,
      status: "suspended",
      lens: null,
      agent: null,
    };
  }
  if (!pack) {
    return {
      ...base,
      packCode: null,
      packVersion: null,
      status: "pending_pack",
      lens: null,
      agent: null,
    };
  }
  const trust = initialTrust(pack.capabilities.map((c) => c.id));
  const trustById = new Map(trust.map((t) => [t.capabilityId, t] as const));
  const wake = [...new Set(pack.playbooks.flatMap((p) => p.wakeOn))].sort();
  return {
    ...base,
    packCode: pack.code,
    packVersion: pack.version,
    status: "active",
    lens: {
      lensId: `${pack.code}@${pack.version}`,
      persona: pack.code,
      requestedPermissions: [...pack.permissions],
      tools: pack.capabilities.map((c) => ({
        toolId: c.id,
        requiresPermission: c.requiresPermission,
      })),
    },
    agent: {
      capabilities: pack.capabilities.map((c) => ({
        id: c.id,
        tier: c.tier,
        packAutonomy: c.autonomy,
        effective: effectiveAutonomy(c, trustById.get(c.id)),
        requiresPermission: c.requiresPermission,
        connector: c.connector ?? null,
      })),
      trust,
      wakeEvents: wake,
      budget: pack.budget,
      memory: { domains: [...pack.memory.domains], maxSensitivity: pack.memory.maxSensitivity },
    },
  };
}

export type ProvisionAction =
  | { readonly kind: "ensure_person"; readonly identityId: string; readonly memoryScopeId: string }
  | { readonly kind: "ensure_context"; readonly plan: ContextPlan }
  | { readonly kind: "suspend_context"; readonly contextKey: string; readonly reason: string }
  | { readonly kind: "noop"; readonly reason: string };

export type PackLookup = (roleCode: string) => RolePack | undefined;

/**
 * What must exist for this membership event. Idempotent by construction: the
 * same event always yields the same actions, and applying them twice changes
 * nothing. Provisioning is driven by an ACTIVE, server-resolved membership,
 * never by an invitation that has not been accepted.
 */
export function planProvisioning(
  event: MembershipEvent,
  lookup: PackLookup,
): readonly ProvisionAction[] {
  const m = event.membership;
  if (!m.identityId || !m.tenantId || !m.roleCode)
    return [{ kind: "noop", reason: "incomplete_membership" }];
  const key = contextKeyOf(m.identityId, m.tenantId, m.roleCode);

  if (event.type === "deactivated" || !m.active) {
    return [{ kind: "suspend_context", contextKey: key, reason: "membership_inactive" }];
  }
  const person: ProvisionAction = {
    kind: "ensure_person",
    identityId: m.identityId,
    memoryScopeId: personMemoryScopeId(m.identityId),
  };
  const ensure: ProvisionAction = {
    kind: "ensure_context",
    plan: compileContext(m, lookup(m.roleCode)),
  };
  if (event.type === "role_changed") {
    return [
      {
        kind: "suspend_context",
        contextKey: contextKeyOf(m.identityId, m.tenantId, event.previousRoleCode),
        reason: "role_changed",
      },
      person,
      ensure,
    ];
  }
  return [person, ensure];
}

/* ── Isolation ─────────────────────────────────────────────────────────── */

export interface PassportView {
  readonly identityId: string;
  readonly contexts: readonly Pick<
    ContextPlan,
    "contextKey" | "tenantId" | "status" | "memoryScopeId"
  >[];
}

/** The memory scopes readable while acting in one context: the person's core
 * plus that single active context. An unknown or suspended context yields the
 * core only, never another tenant's scope. */
export function visibleMemoryScopes(
  passport: PassportView,
  activeContextKey: string,
): readonly string[] {
  const core = personMemoryScopeId(passport.identityId);
  const ctx = passport.contexts.find(
    (c) => c.contextKey === activeContextKey && c.status === "active",
  );
  return ctx ? [core, ctx.memoryScopeId] : [core];
}

/** The context to act in, or null. Only an active context of this person. */
export function resolveActingContext(passport: PassportView, requestedKey: string) {
  return (
    passport.contexts.find((c) => c.contextKey === requestedKey && c.status === "active") ?? null
  );
}

export interface CoreFlowRequest {
  readonly originTenantId: string;
  readonly sensitivity: MemorySensitivity;
  /** The originating tenant's policy explicitly permits export to the person. */
  readonly tenantPolicyAllowsExport: boolean;
  /** The person consented to this item entering their own core. */
  readonly personConsented: boolean;
}

/** Context data enters the person's core only with BOTH the tenant's policy
 * and the person's consent, and restricted data never moves. */
export function canFlowToCore(req: CoreFlowRequest): boolean {
  return req.tenantPolicyAllowsExport && req.personConsented && req.sensitivity !== "restricted";
}
