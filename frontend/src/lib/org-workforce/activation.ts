/**
 * Organization agent activation (ENGINE-18, ADR-096).
 *
 * An add-on agent runs for an organization only when every one of these holds:
 *   1. the organization is active,
 *   2. its plan includes the agent (ENGINE-17 packaging),
 *   3. the organization has switched the agent on (add-ons are opt-in),
 *   4. the agent is not paused,
 *   5. at least one person holds the accountable role with an ACTIVE membership whose
 *      invitation was ACCEPTED.
 *
 * An invitation that is pending, expired or revoked never counts, in the same way that
 * `planProvisioning` only acts on an active membership. The result is a plan that says
 * why an agent is or is not running; nothing here starts anything.
 *
 * Pure: no I/O, no clock, no environment.
 */
import type { TierName } from "../subscription-tiers";
import type { TenantId } from "../tenant-core";
import { ORG_AGENTS, type MembershipRole, type OrgAgent } from "./org-agents";
import { orgAgentEntitlement } from "./packaging";

export type InvitationState = "accepted" | "pending" | "expired" | "revoked" | "none";

export interface MemberFact {
  readonly identityId: string;
  readonly role: MembershipRole;
  readonly active: boolean;
  readonly invitation: InvitationState;
}

export interface TenantFact {
  readonly tenantId: string;
  readonly tier: string | null | undefined;
  readonly active: boolean;
}

export type OrgAgentStatus =
  "active" | "waiting_for_holder" | "paused" | "available" | "locked" | "tenant_inactive";

export interface OrgAgentActivation {
  readonly code: string;
  readonly codename: string;
  readonly status: OrgAgentStatus;
  readonly minTier: TierName | null;
  /** People who may approve this agent's actions: active members with an accepted invitation. */
  readonly holders: readonly string[];
  readonly reason: string;
}

/** A person counts only with an active membership and an accepted invitation. */
export function isEligibleHolder(member: MemberFact): boolean {
  return member.active && member.invitation === "accepted";
}

export function holdersOf(members: readonly MemberFact[], role: MembershipRole): readonly string[] {
  return [
    ...new Set(
      members.filter((m) => m.role === role && isEligibleHolder(m)).map((m) => m.identityId),
    ),
  ].sort();
}

/** Who the organization twin reports to: the first of these roles that has an eligible holder. */
export const REPORT_ROLE_ORDER: readonly MembershipRole[] = ["admin", "principal", "hq"];

export function reportTargets(members: readonly MemberFact[]): {
  readonly role: MembershipRole | null;
  readonly holders: readonly string[];
} {
  for (const role of REPORT_ROLE_ORDER) {
    const holders = holdersOf(members, role);
    if (holders.length > 0) return { role, holders };
  }
  return { role: null, holders: [] };
}

function activationFor(
  agent: OrgAgent,
  tenant: TenantFact,
  members: readonly MemberFact[],
  enabled: ReadonlySet<string>,
  paused: ReadonlySet<string>,
): OrgAgentActivation {
  const code = agent.pack.code;
  const base = { code, codename: agent.codename };
  const blank = tenant.tenantId.trim() === "";
  if (blank || !tenant.active) {
    return {
      ...base,
      status: "tenant_inactive",
      minTier: null,
      holders: [],
      reason: blank ? "no_tenant" : "organization_inactive",
    };
  }
  const ent = orgAgentEntitlement(tenant.tenantId as TenantId, tenant.tier, code);
  if (!ent.entitled) {
    return {
      ...base,
      status: "locked",
      minTier: ent.minTier,
      holders: [],
      reason: "plan_excludes_agent",
    };
  }
  if (!enabled.has(code)) {
    return {
      ...base,
      status: "available",
      minTier: ent.minTier,
      holders: [],
      reason: "not_switched_on",
    };
  }
  const holders = holdersOf(members, agent.accountable);
  if (paused.has(code)) {
    return { ...base, status: "paused", minTier: ent.minTier, holders, reason: "paused" };
  }
  if (holders.length === 0) {
    return {
      ...base,
      status: "waiting_for_holder",
      minTier: ent.minTier,
      holders,
      reason: "no_active_accepted_holder_of_accountable_role",
    };
  }
  return { ...base, status: "active", minTier: ent.minTier, holders, reason: "ok" };
}

export function planOrgAgentActivation(input: {
  readonly tenant: TenantFact;
  readonly members: readonly MemberFact[];
  readonly enabledCodes: readonly string[];
  readonly pausedCodes?: readonly string[];
}): readonly OrgAgentActivation[] {
  const enabled = new Set(input.enabledCodes);
  const paused = new Set(input.pausedCodes ?? []);
  return ORG_AGENTS.map((a) => activationFor(a, input.tenant, input.members, enabled, paused));
}
