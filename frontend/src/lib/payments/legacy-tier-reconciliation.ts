/**
 * CoreGrid — legacy subscription-tier → neutral entitlement reconciliation
 * (mission H3-091 / J-044, Squad I — Payments & economics).
 *
 * The legacy commercial catalog (`../subscription-tiers.ts`) is a deprecated
 * DECISION surface (MISSION-R-73): it still sells plans against a domain-
 * flavored feature-key matrix, and `payments/tier-entitlements.ts` already
 * translates it per TenantId — but into that legacy feature-key vocabulary.
 * This module is the NEUTRAL entitlement plane (J-037): it maps every
 * recognized legacy tier name onto a domain-neutral plan record — plan
 * class, capacity class, and a closed set of capability classes — so the
 * phase-13 financial contract plane can state what a plan entitles without
 * importing the legacy matrix's vocabulary.
 *
 * Design boundaries:
 *   - PURE: no I/O, no clock reads, no database access, no mutation of any
 *     input; every emitted record is frozen and provenance-stamped (§12).
 *   - The legacy catalog is deliberately NOT imported. The mapping below is
 *     an authored decision table, grounded against the live catalog (and
 *     kept honest on drift) by `tests/unit/h3-091-legacy-tiers.test.ts`,
 *     which cross-checks every capability class against the legacy feature
 *     matrix. Importing the catalog here would pull its vocabulary into the
 *     neutral plane — exactly what J-037 forbids.
 *   - FAIL-CLOSED: a missing or unrecognized tier name entitles NOTHING.
 *     The legacy catalog's own resolver (`getTier`) fails OPEN — an unknown
 *     value silently becomes the trial plan, which would grant a real plan
 *     to a defective record. This module does not reuse it; unknown is a
 *     typed deny, never a coercion.
 *   - Capability-class granularity is deliberately coarser than the legacy
 *     matrix: within-class breadth (which payment rails, which channels)
 *     remains a catalog fact resolvable through `tier-entitlements.ts`.
 *     This module answers "is the class entitled at all", never "which
 *     member of the class".
 *   - Capacity NUMBERS (seat/storage ceilings) are not duplicated here —
 *     they stay catalog facts; only the capacity CLASS is mapped (the test
 *     proves the class ordering matches the catalog's numeric ordering).
 *
 * Authority boundary (Constitution §16): this is a pricing/contract fact,
 * not an access decision. "May THIS actor use this capability?" is answered
 * only by the canonical authorization surface keyed by identity + tenant +
 * roles; "what does the plan the tenant pays for entitle?" is answered here.
 */
import { z } from "zod";
import type { TenantId } from "../tenant-core";

/* ─────────────────────────────────────────────────────────────
 * Legacy tier vocabulary (recognized names only)
 * ────────────────────────────────────────────────────────────*/

/** The complete set of legacy tier names this reconciliation recognizes. */
export const LEGACY_TIER_NAMES = [
  "trial",
  "starter",
  "growth",
  "professional",
  "enterprise",
] as const;

export type LegacyTierName = (typeof LEGACY_TIER_NAMES)[number];

const LEGACY_TIER_NAME_SET: ReadonlySet<string> = new Set<string>(
  LEGACY_TIER_NAMES,
);

/* ─────────────────────────────────────────────────────────────
 * Neutral plan vocabulary (J-037 — no domain words below)
 * ────────────────────────────────────────────────────────────*/

/** Coarse commercial strength of a plan, ordered weakest → strongest. */
export const NEUTRAL_PLAN_CLASSES = [
  "evaluation",
  "standard",
  "advanced",
  "premium",
  "unlimited",
] as const;

export type NeutralPlanClass = (typeof NEUTRAL_PLAN_CLASSES)[number];

/** Capacity envelope of a plan, ordered smallest → unbounded. */
export const NEUTRAL_CAPACITY_CLASSES = [
  "compact",
  "small",
  "medium",
  "large",
  "unbounded",
] as const;

export type NeutralCapacityClass = (typeof NEUTRAL_CAPACITY_CLASSES)[number];

/**
 * The closed set of domain-neutral capability classes a plan can entitle.
 * Membership of a legacy tier in each class is grounded against the legacy
 * catalog's feature matrix by the H3-091 test suite; within-class breadth
 * stays a catalog fact.
 */
export const NEUTRAL_CAPABILITY_CLASSES = [
  "core_platform",
  "multi_role_portals",
  "payment_rails",
  "payment_split",
  "communication_channels",
  "presence_verification",
  "content_publishing",
  "operations_suites",
  "governance_audit",
  "bulk_data_import",
  "analytics_reporting",
  "ai_intelligence",
  "branding_removal",
  "platform_branding",
  "priority_support",
  "digital_twin",
  "api_access",
  "multi_site",
  "dedicated_infrastructure",
] as const;

export type NeutralCapabilityClass = (typeof NEUTRAL_CAPABILITY_CLASSES)[number];

const CAPABILITY_SET: ReadonlySet<NeutralCapabilityClass> = new Set(
  NEUTRAL_CAPABILITY_CLASSES,
);

/* ─────────────────────────────────────────────────────────────
 * Contracts (Zod-validated, strict — unknown keys rejected)
 * ────────────────────────────────────────────────────────────*/

export interface NeutralPlanProvenance {
  readonly declaredBy: string;
  readonly authority: string;
  readonly declaredAt: string;
  readonly source: string;
}

export interface NeutralEntitlementPlan {
  readonly planId: string;
  readonly legacyTier: LegacyTierName;
  readonly planClass: NeutralPlanClass;
  readonly capacityClass: NeutralCapacityClass;
  readonly capabilities: readonly NeutralCapabilityClass[];
  readonly provenance: NeutralPlanProvenance;
}

const provenanceSchema = z.strictObject({
  declaredBy: z.string().min(1),
  authority: z.string().min(1),
  declaredAt: z.string().min(1),
  source: z.string().min(1),
});

export const neutralEntitlementPlanSchema = z
  .strictObject({
    planId: z.string().min(1),
    legacyTier: z.enum(LEGACY_TIER_NAMES),
    planClass: z.enum(NEUTRAL_PLAN_CLASSES),
    capacityClass: z.enum(NEUTRAL_CAPACITY_CLASSES),
    capabilities: z.array(z.enum(NEUTRAL_CAPABILITY_CLASSES)),
    provenance: provenanceSchema,
  })
  .refine((plan) => new Set(plan.capabilities).size === plan.capabilities.length, {
    message: "capability classes must be unique within a plan",
  })
  .refine((plan) => plan.planId === `coregrid.plan.${plan.planClass}`, {
    message: "planId must be derived from the plan class",
  });

export type NeutralEntitlementSource =
  | "legacy-tier-catalog"
  | "fail-closed-no-recognized-tier";

/**
 * One neutral entitlement fact: tenant `tenantId` on the plan its legacy
 * tier maps to is (or is not) entitled to `capability`. Provenance is
 * declared, never inferred. On a missing/unrecognized tier every record
 * denies and carries the fail-closed source marker.
 */
export interface NeutralTierEntitlement {
  readonly tenantId: TenantId;
  readonly legacyTier: LegacyTierName | null;
  readonly planId: string | null;
  readonly capability: NeutralCapabilityClass;
  readonly entitled: boolean;
  readonly source: NeutralEntitlementSource;
}

export const neutralTierEntitlementSchema = z.strictObject({
  tenantId: z.string().min(1),
  legacyTier: z.enum(LEGACY_TIER_NAMES).nullable(),
  planId: z.string().min(1).nullable(),
  capability: z.enum(NEUTRAL_CAPABILITY_CLASSES),
  entitled: z.boolean(),
  source: z.enum(["legacy-tier-catalog", "fail-closed-no-recognized-tier"]),
});

export type LegacyTierReconciliation =
  | {
      readonly ok: true;
      readonly legacyTier: LegacyTierName;
      readonly plan: NeutralEntitlementPlan;
    }
  | {
      readonly ok: false;
      readonly code: "missing_tier" | "unrecognized_tier";
      readonly reason: string;
    };

export const legacyTierReconciliationSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    legacyTier: z.enum(LEGACY_TIER_NAMES),
    plan: neutralEntitlementPlanSchema,
  }),
  z.strictObject({
    ok: z.literal(false),
    code: z.enum(["missing_tier", "unrecognized_tier"]),
    reason: z.string().min(1),
  }),
]);

/* ─────────────────────────────────────────────────────────────
 * Authored mapping (tier → neutral plan), validated at import
 * ────────────────────────────────────────────────────────────*/

const PLAN_PROVENANCE: NeutralPlanProvenance = {
  declaredBy: "frontend/src/lib/payments/legacy-tier-reconciliation.ts",
  authority: "AGENTS.md §42 / H3 wave mission I-091 (J-044)",
  declaredAt: "2026-10-03T00:00:00.000Z",
  source:
    "legacy commercial tier catalog (authored mapping, grounded by tests/unit/h3-091-legacy-tiers.test.ts)",
};

const STANDARD_CAPABILITIES = [
  "core_platform",
  "multi_role_portals",
  "payment_rails",
  "communication_channels",
  "presence_verification",
  "content_publishing",
  "operations_suites",
  "governance_audit",
] as const satisfies readonly NeutralCapabilityClass[];

const ADVANCED_CAPABILITIES = [
  ...STANDARD_CAPABILITIES,
  "bulk_data_import",
  "analytics_reporting",
  "ai_intelligence",
] as const satisfies readonly NeutralCapabilityClass[];

const PREMIUM_CAPABILITIES = [
  ...ADVANCED_CAPABILITIES,
  "branding_removal",
  "priority_support",
  "digital_twin",
] as const satisfies readonly NeutralCapabilityClass[];

const UNLIMITED_CAPABILITIES = [
  ...PREMIUM_CAPABILITIES,
  "platform_branding",
  "api_access",
  "multi_site",
  "dedicated_infrastructure",
  "payment_split",
] as const satisfies readonly NeutralCapabilityClass[];

const AUTHORED_PLANS: Readonly<Record<LegacyTierName, NeutralEntitlementPlan>> = {
  trial: {
    planId: "coregrid.plan.evaluation",
    legacyTier: "trial",
    planClass: "evaluation",
    capacityClass: "compact",
    capabilities: ["core_platform"],
    provenance: PLAN_PROVENANCE,
  },
  starter: {
    planId: "coregrid.plan.standard",
    legacyTier: "starter",
    planClass: "standard",
    capacityClass: "small",
    capabilities: [...STANDARD_CAPABILITIES],
    provenance: PLAN_PROVENANCE,
  },
  growth: {
    planId: "coregrid.plan.advanced",
    legacyTier: "growth",
    planClass: "advanced",
    capacityClass: "medium",
    capabilities: [...ADVANCED_CAPABILITIES],
    provenance: PLAN_PROVENANCE,
  },
  professional: {
    planId: "coregrid.plan.premium",
    legacyTier: "professional",
    planClass: "premium",
    capacityClass: "large",
    capabilities: [...PREMIUM_CAPABILITIES],
    provenance: PLAN_PROVENANCE,
  },
  enterprise: {
    planId: "coregrid.plan.unlimited",
    legacyTier: "enterprise",
    planClass: "unlimited",
    capacityClass: "unbounded",
    capabilities: [...UNLIMITED_CAPABILITIES],
    provenance: PLAN_PROVENANCE,
  },
};

// Fail-closed authoring: a drifted or malformed decision table breaks the
// module at import time, never silently at call time.
for (const plan of Object.values(AUTHORED_PLANS)) {
  neutralEntitlementPlanSchema.parse(plan);
}

const PLAN_CAPABILITY_SETS: Readonly<
  Record<LegacyTierName, ReadonlySet<NeutralCapabilityClass>>
> = {
  trial: new Set(AUTHORED_PLANS.trial.capabilities),
  starter: new Set(AUTHORED_PLANS.starter.capabilities),
  growth: new Set(AUTHORED_PLANS.growth.capabilities),
  professional: new Set(AUTHORED_PLANS.professional.capabilities),
  enterprise: new Set(AUTHORED_PLANS.enterprise.capabilities),
};

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/** The frozen, import-validated legacy-tier → neutral-plan decision table. */
export const LEGACY_TIER_PLAN_MAP: Readonly<
  Record<LegacyTierName, NeutralEntitlementPlan>
> = deepFreeze(AUTHORED_PLANS);

/* ─────────────────────────────────────────────────────────────
 * Reconciliation entry points (pure, fail-closed)
 * ────────────────────────────────────────────────────────────*/

const REASON_PREVIEW_LIMIT = 64;

/**
 * Reconcile one raw legacy tier value onto the neutral entitlement plane.
 * Case/whitespace variants of a recognized name resolve to the SAME tier
 * (normalization can never escalate). Anything missing or unrecognized is a
 * typed deny — never coerced onto a plan (contrast the legacy catalog's
 * fail-open `getTier`).
 */
export function reconcileLegacyTierPlan(
  tier: string | null | undefined,
): LegacyTierReconciliation {
  if (typeof tier !== "string" || tier.trim() === "") {
    return deepFreeze({
      ok: false,
      code: "missing_tier",
      reason:
        "Legacy tier reconciliation: the record declares no tier — nothing is entitled (fail closed)",
    });
  }
  const normalized = tier.trim().toLowerCase();
  if (!LEGACY_TIER_NAME_SET.has(normalized)) {
    return deepFreeze({
      ok: false,
      code: "unrecognized_tier",
      reason: `Legacy tier reconciliation: tier "${tier.slice(0, REASON_PREVIEW_LIMIT)}" is outside the recognized legacy catalog — nothing is entitled (fail closed)`,
    });
  }
  const legacyTier = normalized as LegacyTierName;
  return deepFreeze({
    ok: true,
    legacyTier,
    plan: LEGACY_TIER_PLAN_MAP[legacyTier],
  });
}

function requireTenantId(tenantId: TenantId): void {
  if (typeof tenantId !== "string" || tenantId.trim() === "") {
    throw new Error(
      "Neutral tier entitlement requires a tenant id — an entitlement fact without a tenant is not a fact (fail closed)",
    );
  }
}

/**
 * The full neutral entitlement record set of one tenant's legacy tier, in
 * the declared capability-class order. A missing/unrecognized tier yields
 * ONLY denials carrying the fail-closed source marker — never a default
 * plan grant. An empty tenant id is a caller defect and throws.
 */
export function neutralEntitlementsForTier(
  tenantId: TenantId,
  tier: string | null | undefined,
): readonly NeutralTierEntitlement[] {
  requireTenantId(tenantId);
  const reconciliation = reconcileLegacyTierPlan(tier);
  const entitlements = NEUTRAL_CAPABILITY_CLASSES.map((capability): NeutralTierEntitlement => {
    if (!reconciliation.ok) {
      return {
        tenantId,
        legacyTier: null,
        planId: null,
        capability,
        entitled: false,
        source: "fail-closed-no-recognized-tier",
      };
    }
    return {
      tenantId,
      legacyTier: reconciliation.legacyTier,
      planId: reconciliation.plan.planId,
      capability,
      entitled: PLAN_CAPABILITY_SETS[reconciliation.legacyTier].has(capability),
      source: "legacy-tier-catalog",
    };
  });
  return deepFreeze(entitlements);
}

/**
 * Single-capability entitlement probe. Fail closed on every ambiguity:
 * an unresolvable tier denies; a capability outside the closed class set
 * denies (defends against runtime callers bypassing the type system).
 */
export function isNeutralCapabilityEntitled(
  tenantId: TenantId,
  tier: string | null | undefined,
  capability: NeutralCapabilityClass,
): boolean {
  requireTenantId(tenantId);
  if (!CAPABILITY_SET.has(capability)) {
    return false;
  }
  const reconciliation = reconcileLegacyTierPlan(tier);
  if (!reconciliation.ok) {
    return false;
  }
  return PLAN_CAPABILITY_SETS[reconciliation.legacyTier].has(capability);
}

/* ─────────────────────────────────────────────────────────────
 * Bulk name-set reconciliation (catalog drift detection)
 * ────────────────────────────────────────────────────────────*/

export interface UnrecognizedTierName {
  /** The raw observed value; `""` when the record declared no tier. */
  readonly raw: string;
  readonly code: "missing_tier" | "unrecognized_tier";
}

export interface LegacyTierSetReconciliation {
  /** Unique recognized names, in first-occurrence order. */
  readonly recognized: readonly LegacyTierName[];
  /** Unique denied values, in first-occurrence order. */
  readonly unrecognized: readonly UnrecognizedTierName[];
}

/**
 * Reconcile a set of observed legacy tier values (e.g. a column census):
 * every value is classified — recognized names pass through, everything
 * else is surfaced as an explicit denial. Nothing is dropped, deduplicated
 * away, or coerced: defects surface, never absorb.
 */
export function reconcileLegacyTierNameSet(
  observed: readonly (string | null | undefined)[],
): LegacyTierSetReconciliation {
  const recognized: LegacyTierName[] = [];
  const seenRecognized = new Set<string>();
  const unrecognized: UnrecognizedTierName[] = [];
  const seenUnrecognized = new Set<string>();
  for (const raw of observed) {
    const reconciliation = reconcileLegacyTierPlan(raw);
    if (reconciliation.ok) {
      if (!seenRecognized.has(reconciliation.legacyTier)) {
        seenRecognized.add(reconciliation.legacyTier);
        recognized.push(reconciliation.legacyTier);
      }
      continue;
    }
    const rawValue = typeof raw === "string" ? raw : "";
    const dedupKey = `${reconciliation.code}|${rawValue}`;
    if (!seenUnrecognized.has(dedupKey)) {
      seenUnrecognized.add(dedupKey);
      unrecognized.push({ raw: rawValue, code: reconciliation.code });
    }
  }
  return deepFreeze({ recognized, unrecognized });
}