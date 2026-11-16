/**
 * Sherivs — TenantId-keyed tier entitlement bridge (MISSION-R-73, J-044).
 *
 * Reconciles the legacy subscription-tiers vocabulary
 * (`../subscription-tiers.ts` — Scholar billing vocabulary hard-wired to the
 * `schools.active_features` column, flagged by STREAM_H as an orphan) into
 * the phase-13 financial contract plane. Entitlements are expressed against
 * a canonical `TenantId`, never against a school row: the caller supplies
 * the tenant, the legacy catalog stays a pure commercial price/limit/feature
 * table, and every entitlement record carries declared provenance (§12).
 *
 * Decision authority is NOT here. This module answers "what does this
 * tenant's plan commercially entitle?" — a pricing/contract fact. The
 * question "may THIS actor use this feature?" is answered only by the
 * canonical feature-access contract surface (`getMyFeatureAccess` in
 * `scholar-feature-access.functions.ts` over `scholar/feature-gate.ts`),
 * keyed by TenantId + identity + roles, fail-closed. As of this mission the
 * `schools.active_features` jsonb is an input to NO access decision; its
 * remaining readers/writers are universal-root UI surfaces scheduled for
 * the MISSION-R-121 relocation and are out of this mission's file scope.
 *
 * ── Migration decision (AUTHORED-NOT-APPLIED ledger) ────────────────────
 * No migration is authored for this reconciliation, deliberately:
 *   1. The canonical entitlement surface derives from existing substrate —
 *      identity/tenant/role RPCs (`get_my_role`, `get_my_school_id`,
 *      workforce positions) plus the feature gate. No canonical
 *      entitlements table is required, so none is created (database law:
 *      minimal schema; never create structure to mirror a decision already
 *      derived from governed substrate).
 *   2. `schools.active_features` has no SQL-level enforcement anywhere
 *      (verified: migrations only ADD/normalize the column; no function,
 *      view or policy reads it). The coupling lives entirely in the
 *      code-level decision path, which this mission kills at the source —
 *      a schema change cannot kill it any deader.
 *   3. The column is decision-dead but not write-dead (`admin/features.tsx`
 *      and the demo provisioner still write it) — files owned by other
 *      missions. Dropping the column now would be a destructive refactor
 *      of files outside this mission's scope. Column retirement is
 *      recorded as follow-up work for MISSION-R-121 (universal-root
 *      relocation), which owns those consumers.
 * ────────────────────────────────────────────────────────────────────────
 */
import {
  SUBSCRIPTION_TIERS,
  getTier,
  type FeatureKey,
  type TierFeatures,
  type TierName,
} from "../subscription-tiers";
import type { TenantId } from "../tenant-core";

export type TierEntitlementSource = "legacy-tier-catalog";

/**
 * One commercial entitlement fact: tenant `tenantId` on plan `tier` is (or
 * is not) entitled to `feature` under the plan it pays for. Provenance is
 * declared, never inferred.
 */
export interface TierEntitlement {
  tenantId: TenantId;
  tier: TierName;
  feature: FeatureKey;
  entitled: boolean;
  source: TierEntitlementSource;
}

/**
 * Resolve one feature entitlement for one tenant. Unknown tiers fail closed
 * to the lowest plan ("trial") via the legacy catalog's own resolution; an
 * empty tenant id is a caller defect and throws — an entitlement fact
 * without a tenant is not a fact.
 */
export function tenantTierEntitlement(
  tenantId: TenantId,
  tier: string | null | undefined,
  feature: FeatureKey,
): TierEntitlement {
  if (tenantId.trim() === "") {
    throw new Error("Tier entitlement requires a tenant id — fail closed");
  }
  const resolvedTier = getTier(tier);
  return {
    tenantId,
    tier: resolvedTier,
    feature,
    entitled: SUBSCRIPTION_TIERS[resolvedTier].features[feature],
    source: "legacy-tier-catalog",
  };
}

/**
 * The full entitlement set of one tenant's plan, in the catalog's declared
 * key order. This is the TenantId-keyed translation of the legacy tier
 * vocabulary into the financial contract plane.
 */
export function tierEntitlementsForTenant(
  tenantId: TenantId,
  tier: string | null | undefined,
): readonly TierEntitlement[] {
  const resolvedTier = getTier(tier);
  const features = SUBSCRIPTION_TIERS[resolvedTier].features as TierFeatures;
  return (Object.keys(features) as FeatureKey[]).map((feature) =>
    tenantTierEntitlement(tenantId, resolvedTier, feature),
  );
}

/**
 * Dedicated school calling agent (COMMS-02). Professional and Enterprise plans
 * include one organization-scoped agent. Trial, Starter, and Growth do not.
 * This is a commercial fact. Whether this actor may use it is decided by the
 * feature gate, not by this function.
 */
export const SCHOOL_CALLING_AGENT_ENTITLEMENT = "school_calling_agent" as const;

const SCHOOL_CALLING_AGENT_TIERS: ReadonlySet<TierName> = new Set(["professional", "enterprise"]);

export interface SchoolCallingAgentEntitlement {
  tenantId: TenantId;
  tier: TierName;
  feature: typeof SCHOOL_CALLING_AGENT_ENTITLEMENT;
  entitled: boolean;
  source: TierEntitlementSource;
}

export function schoolCallingAgentEntitlement(
  tenantId: TenantId,
  tier: string | null | undefined,
): SchoolCallingAgentEntitlement {
  if (tenantId.trim() === "") {
    throw new Error("Tier entitlement requires a tenant id — fail closed");
  }
  const resolvedTier = getTier(tier?.trim().toLowerCase());
  return {
    tenantId,
    tier: resolvedTier,
    feature: SCHOOL_CALLING_AGENT_ENTITLEMENT,
    entitled: SCHOOL_CALLING_AGENT_TIERS.has(resolvedTier),
    source: "legacy-tier-catalog",
  };
}

/** Features a tenant's plan commercially entitles, as a stable string list. */
export function entitledFeaturesForTenant(
  tenantId: TenantId,
  tier: string | null | undefined,
): readonly FeatureKey[] {
  return tierEntitlementsForTenant(tenantId, tier)
    .filter((entitlement) => entitlement.entitled)
    .map((entitlement) => entitlement.feature);
}
