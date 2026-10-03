/**
 * CoreGrid Authorization Engine.
 *
 * Implements the combined authorization model from `architecture/phase-02-identity.md`
 * (J4–J8): RBAC + ABAC + ReBAC + PBAC, producing an explicit decision:
 * ALLOW | DENY | REDACT | ESCALATE | REQUIRE_APPROVAL.
 *
 * Invariant 02: No authorization decision may rely solely on a username or role.
 * Invariant 12: No autonomous agent may silently escalate its own authority.
 *
 * Contract (decision inputs and precedence):
 *
 * Tenant boundary (AGENTS §13/§16/§26): when the acting identity carries a
 * `tenantId` and the requested permission scope carries a tenant (the
 * substring before the first ":" in the scope string), the two must match.
 * A mismatch can never produce ALLOW: the request is DENIED at the tenant
 * gate before PBAC, ABAC, RBAC, or ReBAC are consulted. Scope-null grants
 * therefore cannot authorize another tenant's objects, and a relationship
 * recorded against a foreign tenant's target cannot authorize either. An
 * identity without a `tenantId` (platform-level) and a scope that carries
 * no tenant segment are not constrained by this gate. The tenant identity
 * used for the comparison is resolved server-side from the request; it is
 * never accepted from callers as an override.
 *
 * Relationship activity: a relationship grants authority only while
 * `revokedAt === null` AND (`expiresAt === null` or `expiresAt` is in the
 * future relative to the request time). Expiry is identical to revocation:
 * an expired grant no longer exists, and any decision path it would have
 * enabled falls back to the deny path. The request time is `abac.now`
 * (RFC 3339) when provided, otherwise `timeAuthority.now().atMs`.
 *
 * Agent authority (`AuthorizeOptions.isAgent`, Invariant 12): role
 * membership is never a source of agent authority. An agent identity
 * receives ALLOW only through explicit delegation — `extraPermissions`
 * granted to it or an explicit `owns`/`manages` relationship — never
 * through role-derived grants. Undelegated agent requests deny with an
 * agent-specific reason so the enforcement point is observable.
 */

import type {
  AuthorizationDecision,
  AuthorizationRequest,
  AuthorizationResult,
  CoreGridIdentity,
  IdentityRelationship,
  Permission,
  PermissionAction,
  PermissionResource,
} from "./identity";
import { SystemClock, TimeAuthority } from "./kernel/time-authority";
import { resolveRoleGrants, type DomainRegisteredRole } from "./rbac/domain-contribution";
import { NEUTRAL_CORE_ROLES, type NeutralCoreRole } from "./rbac/neutral-roles";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/* ─────────────────────────────────────────────────────────────
 * Role definitions (RBAC layer)
 *
 * The platform core defines ONLY the neutral role vocabulary
 * (`rbac/neutral-roles.ts`). A domain contributes its own roles — with their
 * neutral-role semantics and capability grants — through the domain
 * contribution registry (`rbac/domain-contribution.ts`); the engine resolves
 * both vocabularies uniformly at decision time. Domain role names never
 * appear in this file (RULING-4 direction: domain -> neutral only).
 * ────────────────────────────────────────────────────────────*/

export type CoreGridRole = NeutralCoreRole | DomainRegisteredRole;

/** The platform's own role set: neutral core roles only. */
export const COREGRID_ROLES: readonly CoreGridRole[] = NEUTRAL_CORE_ROLES;

/* ─────────────────────────────────────────────────────────────
 * Policy engine (PBAC layer)
 * ────────────────────────────────────────────────────────────*/

export interface PolicyRule {
  id: string;
  /** When true, this rule applies to the request. */
  applies: (req: AuthorizationRequest) => boolean;
  /** Decision to emit when the rule applies. */
  decision: AuthorizationDecision;
  reason: string;
}

export interface PolicySet {
  rules: PolicyRule[];
}

/** Evaluate a policy set in order; first matching rule wins. */
export function evaluatePolicySet(
  policySet: PolicySet,
  req: AuthorizationRequest,
): AuthorizationResult | null {
  for (const rule of policySet.rules) {
    if (rule.applies(req)) {
      return { decision: rule.decision, reason: rule.reason };
    }
  }
  return null;
}

/* ─────────────────────────────────────────────────────────────
 * Relationship-based access (ReBAC layer)
 * ────────────────────────────────────────────────────────────*/

export function hasRelationship(
  relationships: IdentityRelationship[],
  type: IdentityRelationship["type"],
  targetId: string,
): boolean {
  // Expiry is evaluated against wall-clock time: this helper has no request
  // context, so there is no `abac.now` to honor (see contract above).
  return relationships.some(
    (r) =>
      r.type === type &&
      r.targetId === targetId &&
      isRelationshipActive(r, timeAuthority.now().atMs),
  );
}

/** A relationship is active only while unrevoked and unexpired. */
function isRelationshipActive(r: IdentityRelationship, nowMs: number): boolean {
  if (r.revokedAt !== null) return false;
  if (r.expiresAt !== null) {
    const expiryMs = Date.parse(r.expiresAt);
    // An unparseable expiry fails closed.
    if (Number.isNaN(expiryMs) || expiryMs <= nowMs) return false;
  }
  return true;
}

/** Resolve the request time: ABAC `now` when provided (RFC 3339), else wall clock. */
function resolveNowMs(abac?: AbacContext): number {
  if (abac?.now !== undefined) {
    const parsed = Date.parse(abac.now);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return timeAuthority.now().atMs;
}

/**
 * Extract the tenant segment of a scope string: the substring before the
 * first ":". A scope with no ":" carries no tenant and is not checked.
 */
function scopeTenant(scope: string | null): string | null {
  if (scope === null) return null;
  const separator = scope.indexOf(":");
  return separator === -1 ? null : scope.slice(0, separator);
}

/* ─────────────────────────────────────────────────────────────
 * Attribute-based access (ABAC layer)
 * ────────────────────────────────────────────────────────────*/

export interface AbacContext {
  /** e.g. "production" | "staging" | "test" */
  environment?: string;
  /** RFC 3339 timestamp of the request. */
  now?: string;
  /** Device trust score 0..1. */
  deviceTrust?: number;
  /** Risk score 0..1. */
  risk?: number;
}

export function evaluateAbac(
  req: AuthorizationRequest,
  ctx: AbacContext,
): AuthorizationResult | null {
  // High-risk requests require escalation.
  if (ctx.risk !== undefined && ctx.risk > 0.8) {
    return {
      decision: "ESCALATE",
      reason: "High-risk request requires escalation",
    };
  }

  // Low device trust blocks sensitive operations.
  if (
    ctx.deviceTrust !== undefined &&
    ctx.deviceTrust < 0.3 &&
    (req.permission.action === "delete" || req.permission.action === "manage")
  ) {
    return {
      decision: "DENY",
      reason: "Untrusted device cannot perform destructive operations",
    };
  }

  return null;
}

/* ─────────────────────────────────────────────────────────────
 * Combined authorization decision
 * ────────────────────────────────────────────────────────────*/

export interface AuthorizeOptions {
  role: CoreGridRole;
  /** Additional explicit grants beyond the role's RBAC grants. */
  extraPermissions?: Permission[];
  /** Policy set to evaluate (PBAC). */
  policySet?: PolicySet;
  /** ABAC context. */
  abac?: AbacContext;
  /**
   * When true, the actor is an AI agent (Invariant 12): role grants are not
   * a source of agent authority. The agent receives ALLOW only through
   * explicit delegation (extraPermissions or an owns/manages relationship);
   * every other path denies with an agent-specific reason.
   */
  isAgent?: boolean;
}

/**
 * Resolve a single authorization request.
 *
 * Order of evaluation:
 *   1. Identity lifecycle gate (identity must be usable)
 *   2. Tenant boundary gate (identity tenant must match scope tenant)
 *   3. PBAC policy set (explicit policy wins)
 *   4. ABAC context (risk/device)
 *   5. RBAC role grants + extra permissions (agents: explicit delegation only)
 *   6. ReBAC relationship grants (active relationships only)
 *   7. Default DENY
 */
export function authorize(req: AuthorizationRequest, opts: AuthorizeOptions): AuthorizationResult {
  // 1. Identity lifecycle gate.
  if (req.identity.lifecycle !== "active" && req.identity.lifecycle !== "provisioned") {
    return {
      decision: "DENY",
      reason: `Identity lifecycle '${req.identity.lifecycle}' is not usable`,
    };
  }

  // 2. Tenant boundary gate. Tenant context is mandatory (AGENTS §13) and
  // resolved server-side — never trusted from callers. A scope carrying a
  // tenant different from the acting identity's can never be ALLOW; the
  // request denies before any grant or policy layer is consulted.
  const identityTenant = req.identity.tenantId;
  const requestedTenant = scopeTenant(req.permission.scope);
  if (identityTenant !== null && requestedTenant !== null && requestedTenant !== identityTenant) {
    return {
      decision: "DENY",
      reason: "Tenant boundary violation: requested scope belongs to a different tenant",
    };
  }

  // 3. PBAC policy set.
  if (opts.policySet) {
    const policyResult = evaluatePolicySet(opts.policySet, req);
    if (policyResult) return policyResult;
  }

  // 4. ABAC context.
  if (opts.abac) {
    const abacResult = evaluateAbac(req, opts.abac);
    if (abacResult) return abacResult;
  }

  // 5. RBAC role grants + extra permissions.
  // Invariant 12: role membership is never a source of agent authority.
  // An agent acting under `isAgent` must hold every role-equivalent grant
  // through explicit delegation (extraPermissions) or an explicit
  // relationship grant below. Role grants resolve uniformly across the
  // neutral core vocabulary and every registered domain contribution.
  const roleGrants: readonly Permission[] = opts.isAgent ? [] : resolveRoleGrants(opts.role);
  const allGrants = [...roleGrants, ...(opts.extraPermissions ?? [])];

  const hasGrant = allGrants.some(
    (g) =>
      g.resource === req.permission.resource &&
      g.action === req.permission.action &&
      (g.scope === null || g.scope === req.permission.scope),
  );

  if (hasGrant) {
    return { decision: "ALLOW", reason: "Granted by role or explicit permission" };
  }

  // 6. ReBAC relationship grants. Expired relationships are treated exactly
  // like revoked ones: the grant no longer exists (see contract above).
  const nowMs = resolveNowMs(opts.abac);
  const relationshipGrant = req.relationships.some(
    (r) =>
      isRelationshipActive(r, nowMs) &&
      r.targetId === req.permission.scope &&
      (r.type === "owns" || r.type === "manages"),
  );

  if (relationshipGrant) {
    return { decision: "ALLOW", reason: "Granted by relationship" };
  }

  // 7. Default DENY.
  if (opts.isAgent) {
    return {
      decision: "DENY",
      reason: "Agent authority requires explicit delegation (Invariant 12)",
    };
  }
  return {
    decision: "DENY",
    reason: "No matching grant or policy",
  };
}

/* ─────────────────────────────────────────────────────────────
 * Redaction helper (per F5 REDACT decision)
 * ────────────────────────────────────────────────────────────*/

export function redact<T extends Record<string, unknown>>(
  record: T,
  allowedFields: string[],
): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (field in record) out[field] = record[field];
  }
  return out as Partial<T>;
}

/* ─────────────────────────────────────────────────────────────
 * Convenience builders
 * ────────────────────────────────────────────────────────────*/

export function permission(
  resource: PermissionResource,
  action: PermissionAction,
  scope: string | null = null,
): Permission {
  return { resource, action, scope };
}

export function makeAuthorizationRequest(
  identity: Pick<CoreGridIdentity, "id" | "kind" | "lifecycle" | "tenantId">,
  resource: PermissionResource,
  action: PermissionAction,
  scope: string | null = null,
  relationships: IdentityRelationship[] = [],
  attributes: Record<string, string | number | boolean | null> = {},
): AuthorizationRequest {
  return {
    identity,
    permission: { resource, action, scope },
    relationships,
    attributes,
  };
}
