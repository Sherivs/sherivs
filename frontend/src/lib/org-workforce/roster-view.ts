/**
 * Organization-facing agent roster (ENGINE-19, ADR-097).
 *
 * What a school sees: which agents its plan includes, which are waiting to be switched on,
 * and which need a higher plan. Built from the activation plan and the agent packs; it reads
 * nothing and shows nothing it cannot back up.
 *
 * Every agent starts in shadow (it proposes, a person decides) and rises only as it earns
 * evidence, so the roster says that plainly rather than listing features.
 *
 * Switching an agent on needs the add-on table of ENGINE-19, which is a proposal and not
 * applied. Until then the switch is shown disabled with that reason. Nothing is invented.
 */
import type { TierName } from "../subscription-tiers";
import { ORG_AGENTS, type OrgAgent } from "./org-agents";
import {
  planOrgAgentActivation,
  type MemberFact,
  type OrgAgentActivation,
  type OrgAgentStatus,
  type TenantFact,
} from "./activation";
import { TIER_ORDER, planMatrix } from "./packaging";

export const ADD_ONS_NOT_APPLIED =
  "Switching agents on needs the organization add-on table, which is drafted but not applied.";

const STATUS_LABEL: Readonly<Record<OrgAgentStatus, string>> = {
  active: "Running",
  waiting_for_holder: "Waiting for someone to hold the role",
  paused: "Paused",
  available: "Included in your plan, not switched on",
  locked: "Needs a higher plan",
  tenant_inactive: "Organization is not active",
};

const TIER_LABEL: Readonly<Record<TierName, string>> = {
  trial: "Trial",
  starter: "Starter",
  growth: "Growth",
  professional: "Professional",
  enterprise: "Enterprise",
};

export const tierLabel = (t: TierName): string => TIER_LABEL[t];

export interface RosterCard {
  readonly code: string;
  readonly codename: string;
  readonly title: string;
  readonly accountable: string;
  readonly status: OrgAgentStatus;
  readonly statusLabel: string;
  readonly reason: string;
  readonly minTier: TierName | null;
  readonly minTierLabel: string | null;
  readonly capabilities: {
    readonly reads: number;
    readonly needsApproval: number;
    readonly proposesOnly: number;
  };
  /** Always true: every agent starts proposing, and a person decides. */
  readonly startsInShadow: true;
  readonly switchOn: { readonly enabled: boolean; readonly disabledReason: string | null };
}

export interface RosterView {
  readonly tier: TierName;
  readonly planLabel: string;
  readonly organizationActive: boolean;
  readonly included: readonly RosterCard[];
  readonly upgrade: readonly RosterCard[];
  readonly summary: {
    readonly included: number;
    readonly total: number;
    /** The next plan that adds agents, and how many it adds. */
    readonly next: {
      readonly tier: TierName;
      readonly label: string;
      readonly adds: number;
    } | null;
  };
}

const ORDER: readonly OrgAgentStatus[] = [
  "active",
  "waiting_for_holder",
  "paused",
  "available",
  "tenant_inactive",
  "locked",
];

function capabilityCounts(agent: OrgAgent) {
  let reads = 0;
  let needsApproval = 0;
  let proposesOnly = 0;
  for (const c of agent.pack.capabilities) {
    if (c.autonomy === "act_autonomously") reads += 1;
    else if (c.autonomy === "act_with_approval") needsApproval += 1;
    else proposesOnly += 1;
  }
  return { reads, needsApproval, proposesOnly };
}

function card(a: OrgAgentActivation, addOnsApplied: boolean): RosterCard {
  const agent = ORG_AGENTS.find((x) => x.pack.code === a.code)!;
  const canSwitch = addOnsApplied && a.status === "available";
  return {
    code: a.code,
    codename: a.codename,
    title: agent.pack.title,
    accountable: agent.accountable,
    status: a.status,
    statusLabel: STATUS_LABEL[a.status],
    reason: a.reason,
    minTier: a.minTier,
    minTierLabel: a.minTier ? TIER_LABEL[a.minTier] : null,
    capabilities: capabilityCounts(agent),
    startsInShadow: true,
    switchOn: {
      enabled: canSwitch,
      disabledReason: canSwitch
        ? null
        : a.status === "available"
          ? ADD_ONS_NOT_APPLIED
          : a.status === "locked"
            ? `Included from the ${a.minTier ? TIER_LABEL[a.minTier] : "Enterprise"} plan.`
            : null,
    },
  };
}

export function buildOrgRoster(input: {
  readonly tenant: TenantFact;
  readonly members?: readonly MemberFact[];
  readonly enabledCodes?: readonly string[];
  readonly pausedCodes?: readonly string[];
  /** Whether the add-on table exists. False until ENGINE-19 is applied. */
  readonly addOnsApplied?: boolean;
}): RosterView {
  const plan = planOrgAgentActivation({
    tenant: input.tenant,
    members: input.members ?? [],
    enabledCodes: input.enabledCodes ?? [],
    ...(input.pausedCodes ? { pausedCodes: input.pausedCodes } : {}),
  });
  const cards = plan
    .map((p) => card(p, input.addOnsApplied === true))
    .sort(
      (a, b) =>
        ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.codename.localeCompare(b.codename),
    );
  const included = cards.filter((c) => c.status !== "locked");
  const upgrade = cards.filter((c) => c.status === "locked");
  const tier = resolveTier(input.tenant.tier);
  const matrix = planMatrix();
  const here = TIER_ORDER.indexOf(tier);
  const next = matrix.find((r, i) => i > here && r.addedHere.length > 0) ?? null;
  return {
    tier,
    planLabel: TIER_LABEL[tier],
    organizationActive: input.tenant.active && input.tenant.tenantId.trim() !== "",
    included,
    upgrade,
    summary: {
      included: included.length,
      total: cards.length,
      next: next
        ? { tier: next.tier, label: TIER_LABEL[next.tier], adds: next.addedHere.length }
        : null,
    },
  };
}

function resolveTier(raw: string | null | undefined): TierName {
  const t = raw?.trim().toLowerCase();
  return (TIER_ORDER as readonly string[]).includes(t ?? "") ? (t as TierName) : "trial";
}
