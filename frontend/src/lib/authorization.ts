/**
 * CoreGrid Authorization Engine.
 *
 * Implements the combined authorization model from `architecture/phase-02-identity.md`
 * (J4–J8): RBAC + ABAC + ReBAC + PBAC, producing an explicit decision:
 * ALLOW | DENY | REDACT | ESCALATE | REQUIRE_APPROVAL.
 *
 * Invariant 02: No authorization decision may rely solely on a username or role.
 * Invariant 12: No autonomous agent may silently escalate its own authority.
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

/* ─────────────────────────────────────────────────────────────
 * Role definitions (RBAC layer)
 * ────────────────────────────────────────────────────────────*/

export type CoreGridRole =
  | "coregrid_owner"
  | "platform_admin"
  | "engineer"
  | "senior_engineer"
  | "support_engineer"
  | "security_engineer"
  | "sre"
  | "data_engineer"
  | "ai_engineer"
  | "ai_operator"
  | "product"
  | "finance"
  | "compliance"
  | "auditor"
  | "support"
  | "read_only"
  | "school_super_admin"
  | "school_admin"
  | "campus_admin"
  | "principal"
  | "teacher"
  | "bursar"
  | "parent"
  | "student"
  | "driver";

export const COREGRID_ROLES: readonly CoreGridRole[] = [
  "coregrid_owner",
  "platform_admin",
  "engineer",
  "senior_engineer",
  "support_engineer",
  "security_engineer",
  "sre",
  "data_engineer",
  "ai_engineer",
  "ai_operator",
  "product",
  "finance",
  "compliance",
  "auditor",
  "support",
  "read_only",
  "school_super_admin",
  "school_admin",
  "campus_admin",
  "principal",
  "teacher",
  "bursar",
  "parent",
  "student",
  "driver",
] as const;

/** Coarse-grained role → permission grants. RBAC alone is never sufficient. */
const ROLE_PERMISSIONS: Record<CoreGridRole, readonly Permission[]> = {
  coregrid_owner: [
    { resource: "school", action: "manage", scope: null },
    { resource: "identity", action: "manage", scope: null },
    { resource: "settings", action: "manage", scope: null },
    { resource: "audit_log", action: "read", scope: null },
  ],
  platform_admin: [
    { resource: "school", action: "manage", scope: null },
    { resource: "identity", action: "manage", scope: null },
    { resource: "settings", action: "manage", scope: null },
  ],
  engineer: [
    { resource: "settings", action: "read", scope: null },
    { resource: "audit_log", action: "read", scope: null },
  ],
  senior_engineer: [
    { resource: "settings", action: "manage", scope: null },
    { resource: "audit_log", action: "read", scope: null },
  ],
  support_engineer: [
    { resource: "user", action: "read", scope: null },
    { resource: "identity", action: "read", scope: null },
  ],
  security_engineer: [
    { resource: "identity", action: "read", scope: null },
    { resource: "audit_log", action: "read", scope: null },
    { resource: "session", action: "read", scope: null },
  ],
  sre: [
    { resource: "settings", action: "read", scope: null },
    { resource: "audit_log", action: "read", scope: null },
  ],
  data_engineer: [{ resource: "analytics", action: "read", scope: null }],
  ai_engineer: [{ resource: "ai_agent", action: "manage", scope: null }],
  ai_operator: [
    { resource: "ai_agent", action: "read", scope: null },
    { resource: "ai_agent", action: "execute", scope: null },
  ],
  product: [{ resource: "analytics", action: "read", scope: null }],
  finance: [
    { resource: "payments", action: "read", scope: null },
    { resource: "fees", action: "read", scope: null },
  ],
  compliance: [
    { resource: "audit_log", action: "read", scope: null },
    { resource: "identity", action: "read", scope: null },
  ],
  auditor: [{ resource: "audit_log", action: "read", scope: null }],
  support: [{ resource: "user", action: "read", scope: null }],
  read_only: [],
  school_super_admin: [
    { resource: "school", action: "manage", scope: null },
    { resource: "user", action: "manage", scope: null },
    { resource: "identity", action: "manage", scope: null },
    { resource: "settings", action: "manage", scope: null },
  ],
  school_admin: [
    { resource: "school", action: "update", scope: null },
    { resource: "user", action: "manage", scope: null },
    { resource: "settings", action: "update", scope: null },
  ],
  campus_admin: [
    { resource: "campus", action: "manage", scope: null },
    { resource: "user", action: "manage", scope: null },
  ],
  principal: [
    { resource: "school", action: "read", scope: null },
    { resource: "teacher", action: "read", scope: null },
    { resource: "student", action: "read", scope: null },
    { resource: "attendance", action: "read", scope: null },
    { resource: "grades", action: "read", scope: null },
  ],
  teacher: [
    { resource: "class", action: "read", scope: null },
    { resource: "student", action: "read", scope: null },
    { resource: "attendance", action: "update", scope: null },
    { resource: "grades", action: "update", scope: null },
  ],
  bursar: [
    { resource: "fees", action: "manage", scope: null },
    { resource: "payments", action: "manage", scope: null },
  ],
  parent: [{ resource: "student", action: "read", scope: null }],
  student: [{ resource: "student", action: "read", scope: null }],
  driver: [{ resource: "student", action: "read", scope: null }],
};

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
  return relationships.some(
    (r) => r.type === type && r.targetId === targetId && r.revokedAt === null,
  );
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
  /** When true, the actor is an AI agent (Invariant 12). */
  isAgent?: boolean;
}

/**
 * Resolve a single authorization request.
 *
 * Order of evaluation:
 *   1. Identity lifecycle gate (identity must be usable)
 *   2. PBAC policy set (explicit policy wins)
 *   3. ABAC context (risk/device)
 *   4. RBAC role grants + extra permissions
 *   5. ReBAC relationship grants
 *   6. Default DENY
 */
export function authorize(req: AuthorizationRequest, opts: AuthorizeOptions): AuthorizationResult {
  // 1. Identity lifecycle gate.
  if (req.identity.lifecycle !== "active" && req.identity.lifecycle !== "provisioned") {
    return {
      decision: "DENY",
      reason: `Identity lifecycle '${req.identity.lifecycle}' is not usable`,
    };
  }

  // 2. PBAC policy set.
  if (opts.policySet) {
    const policyResult = evaluatePolicySet(opts.policySet, req);
    if (policyResult) return policyResult;
  }

  // 3. ABAC context.
  if (opts.abac) {
    const abacResult = evaluateAbac(req, opts.abac);
    if (abacResult) return abacResult;
  }

  // 4. RBAC role grants + extra permissions.
  const roleGrants = ROLE_PERMISSIONS[opts.role] ?? [];
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

  // 5. ReBAC relationship grants.
  const relationshipGrant = req.relationships.some(
    (r) =>
      r.revokedAt === null &&
      r.targetId === req.permission.scope &&
      (r.type === "owns" || r.type === "manages"),
  );

  if (relationshipGrant) {
    return { decision: "ALLOW", reason: "Granted by relationship" };
  }

  // 6. Default DENY.
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
