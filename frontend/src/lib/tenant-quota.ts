/**
 * CoreGrid Tenant Quota & Entitlement Engine (H4 + H5 + O + P).
 *
 * Implements `architecture/phase-03-multi-tenancy.md`:
 * - Entitlement evaluation: Tenant + Capability + Policy + Contract = Entitlement Decision (O2).
 * - Entitlements may expire (O3) and revocation must be auditable (O4).
 * - Quotas support soft/hard limits (P2, P3), burst capacity (P4), and fairness (P5).
 * - One tenant must not consume unlimited shared resources at the expense of others (P5).
 */

import type {
  QuotaResource,
  TenantCapability,
  TenantEntitlement,
  TenantId,
  TenantQuota,
} from "./tenant-core";
import { QUOTA_RESOURCES, TENANT_CAPABILITIES } from "./tenant-core";
import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/* ─────────────────────────────────────────────────────────────
 * Entitlement engine (O)
 * ────────────────────────────────────────────────────────────*/

export interface EntitlementEvaluationRequest {
  tenantId: TenantId;
  capability: TenantCapability;
  /** Policy reference that governs this capability. */
  policyRef: string;
  /** Contract reference that grants this capability. */
  contractRef: string;
}

export type EntitlementDecision =
  | { decision: "GRANTED"; entitlement: TenantEntitlement }
  | { decision: "DENIED"; reason: string }
  | { decision: "REQUIRES_APPROVAL"; reason: string };

/**
 * Evaluate whether a tenant is entitled to a capability.
 * O2: Tenant + Capability + Policy + Contract = Entitlement Decision.
 */
export function evaluateEntitlement(
  req: EntitlementEvaluationRequest,
  now: string = timeAuthority.now().at,
): EntitlementDecision {
  // Validate capability is known.
  if (!TENANT_CAPABILITIES.includes(req.capability)) {
    return { decision: "DENIED", reason: `Unknown capability: ${req.capability}` };
  }

  // Policy and contract references are required.
  if (!req.policyRef.trim()) {
    return { decision: "DENIED", reason: "Entitlement requires a policy reference" };
  }
  if (!req.contractRef.trim()) {
    return { decision: "DENIED", reason: "Entitlement requires a contract reference" };
  }

  // Grant the entitlement.
  const entitlement: TenantEntitlement = {
    tenantId: req.tenantId,
    capability: req.capability,
    status: "enabled",
    effectiveFrom: now,
    effectiveUntil: null,
  };

  return { decision: "GRANTED", entitlement };
}

export function isEntitlementActive(
  entitlement: TenantEntitlement,
  now: string = timeAuthority.now().at,
): boolean {
  if (entitlement.status !== "enabled") return false;
  if (entitlement.effectiveUntil !== null && entitlement.effectiveUntil <= now) return false;
  return true;
}

export function expireEntitlement(
  entitlement: TenantEntitlement,
  now: string = timeAuthority.now().at,
): TenantEntitlement {
  return { ...entitlement, status: "expired", effectiveUntil: now };
}

export function revokeEntitlement(
  entitlement: TenantEntitlement,
  actorId: string,
  reason: string,
  now: string = timeAuthority.now().at,
): { entitlement: TenantEntitlement; auditEvent: Record<string, unknown> } {
  const revoked: TenantEntitlement = { ...entitlement, status: "disabled" };
  return {
    entitlement: revoked,
    auditEvent: {
      type: "EntitlementRevoked",
      tenantId: entitlement.tenantId,
      capability: entitlement.capability,
      actorId,
      reason,
      occurredAt: now,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Quota engine (P)
 * ────────────────────────────────────────────────────────────*/

export type QuotaCheckResult =
  | { ok: true; status: "within_limit" | "soft_limit_reached"; usage: number; limit: number }
  | { ok: false; status: "hard_limit_reached"; usage: number; limit: number };

/**
 * Check quota consumption.
 * P2: Soft quota warns when approaching a limit.
 * P3: Hard quota blocks consumption after the limit.
 */
export function checkQuota(quota: TenantQuota, requestedAmount: number = 1): QuotaCheckResult {
  const projectedUsage = quota.currentUsage + requestedAmount;

  if (projectedUsage > quota.limit) {
    return {
      ok: false,
      status: "hard_limit_reached",
      usage: quota.currentUsage,
      limit: quota.limit,
    };
  }

  const softLimit = quota.limit * quota.softThreshold;
  if (projectedUsage >= softLimit) {
    return {
      ok: true,
      status: "soft_limit_reached",
      usage: quota.currentUsage,
      limit: quota.limit,
    };
  }

  return {
    ok: true,
    status: "within_limit",
    usage: quota.currentUsage,
    limit: quota.limit,
  };
}

export function consumeQuota(
  quota: TenantQuota,
  amount: number,
): { ok: true; quota: TenantQuota } | { ok: false; error: string } {
  const check = checkQuota(quota, amount);
  if (!check.ok) {
    return { ok: false, error: `Quota exceeded for ${quota.resource}` };
  }

  return {
    ok: true,
    quota: { ...quota, currentUsage: quota.currentUsage + amount },
  };
}

export function resetQuota(quota: TenantQuota): TenantQuota {
  return { ...quota, currentUsage: 0 };
}

/* ─────────────────────────────────────────────────────────────
 * Burst capacity (P4)
 * ────────────────────────────────────────────────────────────*/

export interface BurstAllowance {
  tenantId: TenantId;
  resource: QuotaResource;
  burstLimit: number;
  burstUsed: number;
  expiresAt: string;
}

export function isBurstAvailable(
  burst: BurstAllowance,
  now: string = timeAuthority.now().at,
): boolean {
  if (burst.expiresAt <= now) return false;
  return burst.burstUsed < burst.burstLimit;
}

export function consumeBurst(
  burst: BurstAllowance,
  amount: number,
): { ok: true; burst: BurstAllowance } | { ok: false; error: string } {
  if (!isBurstAvailable(burst)) {
    return { ok: false, error: "Burst capacity is not available" };
  }
  if (burst.burstUsed + amount > burst.burstLimit) {
    return { ok: false, error: "Burst capacity exceeded" };
  }
  return { ok: true, burst: { ...burst, burstUsed: burst.burstUsed + amount } };
}

/* ─────────────────────────────────────────────────────────────
 * Quota fairness (P5)
 * ────────────────────────────────────────────────────────────*/

/**
 * Ensure one tenant cannot consume unlimited shared resources.
 * P5: Quota fairness.
 */
export function assertQuotaFairness(
  tenantQuotas: TenantQuota[],
  maxShareFraction: number = 0.5,
): { fair: boolean; violatingResources: QuotaResource[] } {
  const violating: QuotaResource[] = [];

  for (const quota of tenantQuotas) {
    const usageFraction = quota.limit > 0 ? quota.currentUsage / quota.limit : 0;
    if (usageFraction > maxShareFraction) {
      violating.push(quota.resource);
    }
  }

  return {
    fair: violating.length === 0,
    violatingResources: violating,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Quota validation
 * ────────────────────────────────────────────────────────────*/

export function validateQuota(quota: TenantQuota): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!QUOTA_RESOURCES.includes(quota.resource)) {
    errors.push(`Unknown quota resource: ${quota.resource}`);
  }
  if (quota.limit <= 0) {
    errors.push("Quota limit must be positive");
  }
  if (quota.currentUsage < 0) {
    errors.push("Quota usage cannot be negative");
  }
  if (quota.softThreshold < 0 || quota.softThreshold > 1) {
    errors.push("Soft threshold must be between 0 and 1");
  }

  return { valid: errors.length === 0, errors };
}
