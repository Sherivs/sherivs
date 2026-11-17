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
 * Switching an agent on needs the add-on tables of the ENGINE-20 proposal. Until they exist
 * the switch is shown disabled with that reason. Nothing is invented.
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
  "Switching agents on needs the organization add-on tables, which are drafted but not applied.";

/** Shown when an agent is on but this screen has not loaded who holds its approving role. */
export const HOLDERS_NOT_CHECKED =
  "Switched on. Who approves it is not checked on this screen yet.";

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
  /** What else a school may do with an agent that is already switched on. */
  readonly manage: {
    readonly switchOff: boolean;
    readonly pause: boolean;
    readonly resume: boolean;
    /** Set when the platform paused the agent: the school cannot resume it. */
    readonly resumeBlockedReason: string | null;
  };
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

export const MANAGE_ONLY = "Only people who manage settings can switch agents on.";

/** Shown to a person who may not see whether agents are switched on. */
export const STATE_NOT_SHOWN = "Included in your plan.";

export const PLATFORM_PAUSED = "The platform paused this agent. Only the platform can resume it.";

function card(
  a: OrgAgentActivation,
  addOnsApplied: boolean,
  holdersKnown: boolean,
  platformPaused: ReadonlySet<string>,
  stateKnown: boolean,
): RosterCard {
  const agent = ORG_AGENTS.find((x) => x.pack.code === a.code)!;
  const canSwitch = addOnsApplied && a.status === "available";
  const isOn = a.status === "active" || a.status === "waiting_for_holder" || a.status === "paused";
  const heldByPlatform = a.status === "paused" && platformPaused.has(a.code);
  // Without holder data, "waiting for someone to hold the role" would be a claim we cannot back.
  const holderUnknown = !holdersKnown && a.status === "waiting_for_holder";
  return {
    code: a.code,
    codename: a.codename,
    title: agent.pack.title,
    accountable: agent.accountable,
    status: a.status,
    statusLabel:
      !stateKnown && a.status !== "locked" && a.status !== "tenant_inactive"
        ? STATE_NOT_SHOWN
        : holderUnknown
          ? HOLDERS_NOT_CHECKED
          : STATUS_LABEL[a.status],
    reason:
      !stateKnown && a.status !== "locked" && a.status !== "tenant_inactive"
        ? "state_not_visible"
        : holderUnknown
          ? "holders_not_loaded"
          : a.reason,
    minTier: a.minTier,
    minTierLabel: a.minTier ? TIER_LABEL[a.minTier] : null,
    capabilities: capabilityCounts(agent),
    startsInShadow: true,
    switchOn: {
      enabled: canSwitch,
      disabledReason: canSwitch
        ? null
        : a.status === "available"
          ? stateKnown
            ? ADD_ONS_NOT_APPLIED
            : MANAGE_ONLY
          : a.status === "locked"
            ? `Included from the ${a.minTier ? TIER_LABEL[a.minTier] : "Enterprise"} plan.`
            : null,
    },
    manage: {
      switchOff: addOnsApplied && stateKnown && isOn,
      pause: addOnsApplied && (a.status === "active" || a.status === "waiting_for_holder"),
      resume: addOnsApplied && a.status === "paused" && !heldByPlatform,
      resumeBlockedReason: heldByPlatform ? PLATFORM_PAUSED : null,
    },
  };
}

export function buildOrgRoster(input: {
  readonly tenant: TenantFact;
  readonly members?: readonly MemberFact[];
  readonly enabledCodes?: readonly string[];
  readonly pausedCodes?: readonly string[];
  /** Paused by the platform; a subset of `pausedCodes`. */
  readonly platformPausedCodes?: readonly string[];
  /** Whether the add-on tables exist. False until the ENGINE-20 proposal is applied. */
  readonly addOnsApplied?: boolean;
  /**
   * Whether `members` was loaded. Defaults to true. Pass false when it was not, so a switched-on
   * agent is not reported as waiting for someone to hold its role.
   */
  readonly holdersKnown?: boolean;
  /**
   * Whether the viewer may see which agents are switched on. Defaults to true. Only people who
   * manage settings can read that, so for anyone else the roster says what the plan includes
   * and claims nothing about what is on.
   */
  readonly stateKnown?: boolean;
}): RosterView {
  const platformPaused = new Set(input.platformPausedCodes ?? []);
  const plan = planOrgAgentActivation({
    tenant: input.tenant,
    members: input.members ?? [],
    enabledCodes: input.enabledCodes ?? [],
    ...(input.pausedCodes ? { pausedCodes: input.pausedCodes } : {}),
  });
  const cards = plan
    .map((p) =>
      card(
        p,
        input.addOnsApplied === true,
        input.holdersKnown !== false,
        platformPaused,
        input.stateKnown !== false,
      ),
    )
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
