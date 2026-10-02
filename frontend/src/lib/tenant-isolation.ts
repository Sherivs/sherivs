/**
 * CoreGrid Tenant Isolation Engine (G6).
 *
 * Implements `architecture/phase-03-multi-tenancy.md`:
 * - Tenant isolation is a security boundary (J1).
 * - Tenant context must never be trusted merely because a client supplied it (Invariant 02).
 * - Cross-tenant operations must be explicit, authorized, and auditable (Invariants 07, 08).
 * - Tenant boundaries must survive API calls, events, queues, caches, workflows, and agent execution (Invariant 06).
 * - Cache keys must include tenant boundaries (J6).
 * - Events must be scoped correctly (J8).
 */

import type {
  CoreGridTenant,
  TenantContext,
  TenantId,
  TenantResource,
  TenantScope,
} from "./tenant-core";
import { isTenantUsable } from "./tenant-core";
import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/* ─────────────────────────────────────────────────────────────
 * Tenant context resolution (G4 + F1)
 * ────────────────────────────────────────────────────────────*/

export type TenantResolutionResult =
  { ok: true; context: TenantContext } | { ok: false; error: string };

/**
 * Resolve tenant context from a request.
 *
 * Invariant 02: Tenant context must never be trusted merely because a client supplied it.
 * The `clientSuppliedTenantId` is only a hint; it must be verified against
 * the authenticated actor's authorized tenants.
 */
export function resolveTenantContext(
  clientSuppliedTenantId: string | null,
  actorId: string | null,
  authorizedTenantIds: TenantId[],
  requestId: string | null = null,
  region: string | null = null,
  environment: string | null = null,
): TenantResolutionResult {
  // Platform scope: no tenant context required.
  if (clientSuppliedTenantId === null) {
    return {
      ok: true,
      context: {
        tenantId: null,
        actorId,
        requestId,
        region,
        environment,
        source: "platform",
      },
    };
  }

  // Verify the client-supplied tenant ID is in the actor's authorized set.
  const verified = authorizedTenantIds.some((t) => t === clientSuppliedTenantId);
  if (!verified) {
    return {
      ok: false,
      error: "Client-supplied tenant ID is not authorized for this actor",
    };
  }

  return {
    ok: true,
    context: {
      tenantId: clientSuppliedTenantId as TenantId,
      actorId,
      requestId,
      region,
      environment,
      source: "verified",
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Tenant isolation enforcement (G6)
 * ────────────────────────────────────────────────────────────*/

export type IsolationCheckResult = { ok: true; reason: string } | { ok: false; error: string };

/**
 * Verify that a resource belongs to the current tenant context.
 * Invariant 01: Every tenant-owned resource must have a determinable tenant boundary.
 */
export function assertResourceInTenant(
  resource: Pick<TenantResource, "tenantId">,
  context: TenantContext,
): IsolationCheckResult {
  if (context.tenantId === null) {
    return { ok: false, error: "No tenant context for tenant-owned resource" };
  }

  if (resource.tenantId !== context.tenantId) {
    return {
      ok: false,
      error: `Resource belongs to tenant '${resource.tenantId}', not '${context.tenantId}'`,
    };
  }

  return { ok: true, reason: "Resource is within tenant boundary" };
}

/**
 * Verify that a tenant is usable for operations.
 * Invariant 05: Tenant isolation applies to synchronous and asynchronous operations.
 */
export function assertTenantUsable(tenant: Pick<CoreGridTenant, "status">): IsolationCheckResult {
  if (!isTenantUsable(tenant)) {
    return {
      ok: false,
      error: `Tenant status '${tenant.status}' does not permit operations`,
    };
  }
  return { ok: true, reason: "Tenant is usable" };
}

/* ─────────────────────────────────────────────────────────────
 * Cross-tenant access (F7 + J5)
 * ────────────────────────────────────────────────────────────*/

export interface CrossTenantAccessRequest {
  actorId: string;
  sourceTenantId: TenantId;
  targetTenantId: TenantId;
  purpose: string;
  /** Explicit authorization reference (policy, contract, or grant). */
  authorizationRef: string;
  /** Optional expiry for time-bound access. */
  expiresAt: string | null;
}

export type CrossTenantAccessResult =
  { ok: true; scope: TenantScope } | { ok: false; error: string };

/**
 * Authorize cross-tenant access.
 * Invariant 07: Cross-tenant operations must be explicit.
 * Invariant 08: Cross-tenant access must be authorized and auditable.
 */
export function authorizeCrossTenantAccess(
  req: CrossTenantAccessRequest,
  now: string = timeAuthority.now().at,
): CrossTenantAccessResult {
  // Cross-tenant access must be explicit.
  if (req.sourceTenantId === req.targetTenantId) {
    return { ok: false, error: "Cross-tenant access requires different tenants" };
  }

  // Must have an explicit authorization reference.
  if (!req.authorizationRef.trim()) {
    return { ok: false, error: "Cross-tenant access requires an authorization reference" };
  }

  // Must have a purpose.
  if (!req.purpose.trim()) {
    return { ok: false, error: "Cross-tenant access requires a purpose" };
  }

  // Time-bound access must not be expired.
  if (req.expiresAt && req.expiresAt <= now) {
    return { ok: false, error: "Cross-tenant access authorization has expired" };
  }

  return {
    ok: true,
    scope: {
      kind: "cross_tenant_scope",
      tenantIds: [req.sourceTenantId, req.targetTenantId],
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Cache isolation (J6)
 * ────────────────────────────────────────────────────────────*/

/**
 * Build a tenant-scoped cache key.
 * Invariant 06: Tenant boundaries must survive caches.
 */
export function tenantCacheKey(tenantId: TenantId | null, key: string): string {
  return tenantId === null ? `platform:${key}` : `tenant:${tenantId}:${key}`;
}

/* ─────────────────────────────────────────────────────────────
 * Event isolation (J8)
 * ────────────────────────────────────────────────────────────*/

/**
 * Verify an event is scoped to the correct tenant.
 * Invariant 06: Tenant boundaries must survive events.
 */
export function isEventTenantScoped(
  eventTenantId: TenantId | null,
  context: TenantContext,
): boolean {
  if (eventTenantId === null) return true; // platform event
  if (context.tenantId === null) return false; // platform context cannot receive tenant event
  return eventTenantId === context.tenantId;
}

/* ─────────────────────────────────────────────────────────────
 * Queue isolation (J7)
 * ────────────────────────────────────────────────────────────*/

export interface TenantAwareJob {
  jobId: string;
  tenantId: TenantId | null;
  actorId: string | null;
  operation: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

/**
 * Verify a background job retains tenant context.
 * Invariant 06: Tenant boundaries must survive queues.
 */
export function assertJobTenantContext(
  job: TenantAwareJob,
  expectedTenantId: TenantId | null,
): IsolationCheckResult {
  if (job.tenantId !== expectedTenantId) {
    return {
      ok: false,
      error: `Job tenant context '${job.tenantId}' does not match expected '${expectedTenantId}'`,
    };
  }
  return { ok: true, reason: "Job retains tenant context" };
}

/* ─────────────────────────────────────────────────────────────
 * Header spoofing protection (J3)
 * ────────────────────────────────────────────────────────────*/

/**
 * Validate that a client-supplied tenant header is not trusted blindly.
 * Invariant 02: Tenant context must never be trusted merely because a client supplied it.
 */
export function validateTenantHeader(
  headerValue: string | null,
  authorizedTenantIds: TenantId[],
): { valid: boolean; reason: string } {
  if (headerValue === null) {
    return { valid: true, reason: "No tenant header supplied" };
  }

  if (!authorizedTenantIds.some((t) => t === headerValue)) {
    return {
      valid: false,
      reason: "Tenant header value is not authorized",
    };
  }

  return { valid: true, reason: "Tenant header is authorized" };
}

/* ─────────────────────────────────────────────────────────────
 * Tenant enumeration protection (J4)
 * ────────────────────────────────────────────────────────────*/

/**
 * Prevent tenant enumeration through API behavior.
 * Unauthorized users must not be able to discover tenant existence.
 */
export function isTenantEnumerationAttempt(
  requestedTenantId: string,
  authorizedTenantIds: TenantId[],
): boolean {
  return !authorizedTenantIds.some((t) => t === requestedTenantId);
}
