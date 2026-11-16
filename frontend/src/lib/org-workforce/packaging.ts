/**
 * Plan packaging for the organization workforce (ENGINE-17, ADR-095).
 *
 * Smaller plans get fewer agents; each higher plan includes everything below it and
 * Enterprise includes all of them. An agent's minimum plan is read from the plan catalog
 * (the first plan that enables the feature it follows) so that packaging cannot drift from
 * pricing; an agent with no matching feature carries an explicit minimum.
 *
 * This is a commercial fact, like `schoolCallingAgentEntitlement`. Whether a given person may
 * use an agent is decided elsewhere (the feature gate and the agent's own approvals); a plan
 * that includes an agent grants nothing beyond what the agent's pack already limits.
 * It reads the legacy catalog without extending it.
 */
import { SUBSCRIPTION_TIERS, getTier, type TierName } from "../subscription-tiers";
import type { TenantId } from "../tenant-core";
import { ORG_AGENTS, type OrgAgent } from "./org-agents";

export const TIER_ORDER: readonly TierName[] = [
  "trial",
  "starter",
  "growth",
  "professional",
  "enterprise",
];

const rank = (t: TierName): number => TIER_ORDER.indexOf(t);

/** The lowest plan that includes the agent. An agent with no usable rule is Enterprise only. */
export function minTierOf(agent: OrgAgent): TierName {
  if (agent.anchorFeature !== null) {
    const first = TIER_ORDER.find((t) => SUBSCRIPTION_TIERS[t].features[agent.anchorFeature!]);
    return first ?? "enterprise";
  }
  return agent.minTier ?? "enterprise";
}

export function orgAgentsForTier(tier: string | null | undefined): readonly OrgAgent[] {
  const resolved = getTier(tier?.trim().toLowerCase());
  return ORG_AGENTS.filter((a) => rank(minTierOf(a)) <= rank(resolved));
}

export interface OrgAgentEntitlement {
  readonly tenantId: TenantId;
  readonly tier: TierName;
  readonly agentCode: string;
  readonly entitled: boolean;
  readonly minTier: TierName | null;
  readonly source: "legacy-tier-catalog";
}

/** Unknown plans resolve to the lowest plan and unknown agents are not entitled. */
export function orgAgentEntitlement(
  tenantId: TenantId,
  tier: string | null | undefined,
  agentCode: string,
): OrgAgentEntitlement {
  if (tenantId.trim() === "") {
    throw new Error("Org agent entitlement requires a tenant id — fail closed");
  }
  const resolved = getTier(tier?.trim().toLowerCase());
  const agent = ORG_AGENTS.find((a) => a.pack.code === agentCode);
  const minTier = agent ? minTierOf(agent) : null;
  return {
    tenantId,
    tier: resolved,
    agentCode,
    entitled: minTier !== null && rank(minTier) <= rank(resolved),
    minTier,
    source: "legacy-tier-catalog",
  };
}

export interface PlanRow {
  readonly tier: TierName;
  readonly included: readonly string[];
  readonly addedHere: readonly string[];
}

/** The plan-by-plan view, in plan order. */
export function planMatrix(): readonly PlanRow[] {
  return TIER_ORDER.map((tier) => ({
    tier,
    included: orgAgentsForTier(tier).map((a) => a.pack.code),
    addedHere: ORG_AGENTS.filter((a) => minTierOf(a) === tier).map((a) => a.pack.code),
  }));
}
