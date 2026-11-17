import { describe, expect, it } from "vitest";
import { SUBSCRIPTION_TIERS, type TierName } from "../../frontend/src/lib/subscription-tiers";
import type { TenantId } from "../../frontend/src/lib/tenant-core";
import { TENANT_ROLE_PACKS } from "../../frontend/src/lib/scholar/role-packs/tenant-role-packs";
import {
  NG_PERMISSIONS,
  NG_ROLE_TEMPLATES,
} from "../../frontend/src/lib/scholar/roles/ng-role-catalog.generated";
import {
  MAX_AUTONOMOUS_TIER,
  tierRank,
  validateRolePack,
} from "../../frontend/src/lib/twin-engine/role-pack";
import { workforceRoster } from "../../frontend/src/lib/workforce-charter/roster";
import {
  MEMBERSHIP_ROLES,
  ORG_AGENTS,
  ORG_AGENT_PACKS,
  type OrgAgent,
} from "../../frontend/src/lib/org-workforce/org-agents";
import {
  TIER_ORDER,
  minTierOf,
  orgAgentEntitlement,
  orgAgentsForTier,
  planMatrix,
} from "../../frontend/src/lib/org-workforce/packaging";

const T = (s: string) => s as TenantId;
const codes = (tier: string) => orgAgentsForTier(tier).map((a) => a.pack.code);
const perms = NG_PERMISSIONS as Record<string, { sensitivity: string; protected: boolean }>;
const templates = NG_ROLE_TEMPLATES as unknown as Record<
  string,
  { mandatory: string[]; optionalOn: string[]; optionalOff: string[] }
>;
/** Restricted permissions an organization agent may hold, by agent, with the reason in ADR-095. */
const RESTRICTED_ALLOWED: Record<string, readonly string[]> = {
  "org-compliance": ["ndpa.dsar", "audit.view"],
};

describe("ENGINE-17 organization agent definitions", () => {
  it("there are seventeen, each a valid tenant pack", () => {
    expect(ORG_AGENTS).toHaveLength(17);
    for (const a of ORG_AGENTS) {
      expect(validateRolePack(a.pack), a.pack.code).toEqual([]);
      expect(a.pack.kind).toBe("tenant_role");
      expect(a.pack.startsInShadow).toBe(true);
      expect(a.pack.memory.crossTenant).toBe(false);
    }
    expect(ORG_AGENT_PACKS).toHaveLength(17);
  });

  it("codes and codenames are unique and do not collide with any existing agent", () => {
    const code = ORG_AGENTS.map((a) => a.pack.code);
    const names = ORG_AGENTS.map((a) => a.codename);
    expect(new Set(code).size).toBe(17);
    expect(new Set(names).size).toBe(17);
    for (const c of code) expect(c).toMatch(/^org-/);
    const existingCodes = new Set([
      ...TENANT_ROLE_PACKS.map((p) => p.code),
      ...workforceRoster().map((m) => m.pack.code),
    ]);
    const existingNames = new Set(workforceRoster().map((m) => m.charter.codename.toLowerCase()));
    for (const c of code) expect(existingCodes.has(c), c).toBe(false);
    for (const n of names) expect(existingNames.has(n.toLowerCase()), n).toBe(false);
  });

  it("permissions are real, grantable to the function's template, and never more sensitive than allowed", () => {
    for (const a of ORG_AGENTS) {
      const tpl = templates[a.template];
      expect(tpl, `${a.pack.code}: template ${a.template}`).toBeDefined();
      const allowed = new Set([...tpl!.mandatory, ...tpl!.optionalOn, ...tpl!.optionalOff]);
      for (const p of a.pack.permissions) {
        expect(perms[p], `${a.pack.code}: ${p} not in catalog`).toBeDefined();
        expect(allowed.has(p), `${a.pack.code}: ${p} not grantable to ${a.template}`).toBe(true);
        if (perms[p]!.sensitivity === "restricted" || perms[p]!.protected) {
          expect(RESTRICTED_ALLOWED[a.pack.code] ?? [], `${a.pack.code}: ${p}`).toContain(p);
        }
      }
    }
  });

  it("every agent is accountable to a real membership role", () => {
    expect([...MEMBERSHIP_ROLES]).toEqual([
      "admin",
      "principal",
      "teacher",
      "parent",
      "student",
      "bursar",
      "hq",
      "alumni",
      "driver",
    ]);
    for (const a of ORG_AGENTS) {
      expect(MEMBERSHIP_ROLES).toContain(a.accountable);
      expect(a.pack.appliesTo).toEqual([a.accountable]);
    }
  });

  it("nothing above T2, nothing risky autonomous, approvals by the organization only", () => {
    for (const a of ORG_AGENTS) {
      expect(a.pack.escalation.defaultApprover).toBe("role_owner");
      for (const c of a.pack.capabilities) {
        const id = `${a.pack.code}/${c.id}`;
        expect(tierRank(c.tier), id).toBeLessThanOrEqual(tierRank("T2"));
        if (c.autonomy === "act_autonomously") {
          expect(c.tier, id).toBe("T0");
          expect(tierRank(c.tier)).toBeLessThanOrEqual(tierRank(MAX_AUTONOMOUS_TIER));
        }
        if (c.approver !== undefined) expect(c.approver, id).toBe("role_owner");
        expect(c.promotableToAutonomous, id).toBeUndefined();
      }
    }
  });

  it("anything that reaches a person is approval-gated and decisions stay with humans", () => {
    for (const a of ORG_AGENTS) {
      for (const c of a.pack.capabilities) {
        const id = `${a.pack.code}/${c.id}`;
        if (/^(send|publish)\./.test(c.id)) {
          expect(c.autonomy, id).toBe("act_with_approval");
          expect(c.tier, id).toBe("T2");
        }
        if (/^propose\./.test(c.id)) {
          expect(c.autonomy, id).toBe("propose_only");
        }
        if (c.tier === "T0") expect(c.id, id).not.toMatch(/^(send|publish|propose)\./);
      }
    }
  });

  it("the safeguarding agent can only screen, surface and propose, and never sends", () => {
    const haven = ORG_AGENTS.find((a) => a.codename === "Haven")!;
    expect(haven.pack.capabilities.map((c) => c.id)).toEqual([
      "screen.concern",
      "surface.patterns",
      "propose.referral",
    ]);
    expect(haven.pack.permissions).not.toContain("counselling.notes");
    expect(haven.pack.permissions.some((p) => /^comms\./.test(p))).toBe(false);
  });

  it("these definitions are not in, and not reachable from, the person-role pack list", () => {
    const personCodes = new Set(TENANT_ROLE_PACKS.map((p) => p.code));
    for (const p of ORG_AGENT_PACKS) expect(personCodes.has(p.code)).toBe(false);
  });
});

describe("ENGINE-17 plan packaging", () => {
  it("each plan includes everything below it, and Enterprise includes all seventeen", () => {
    let prev = new Set<string>();
    for (const tier of TIER_ORDER) {
      const now = new Set(codes(tier));
      for (const c of prev) expect(now.has(c), `${tier} lost ${c}`).toBe(true);
      prev = now;
    }
    expect(codes("enterprise")).toHaveLength(17);
  });

  it("smaller plans get fewer agents: 1, 5, 12, 16, 17", () => {
    expect(TIER_ORDER.map((t) => codes(t).length)).toEqual([1, 5, 12, 16, 17]);
    expect(codes("trial")).toEqual(["org-support"]);
    expect(codes("starter")).toEqual([
      "org-support",
      "org-fees",
      "org-attendance",
      "org-report-cards",
      "org-parent-comms",
    ]);
  });

  it("an anchored agent follows the plan catalog: its plan is the first that enables the feature", () => {
    for (const a of ORG_AGENTS.filter((x) => x.anchorFeature !== null)) {
      const first = (
        ["trial", "starter", "growth", "professional", "enterprise"] as TierName[]
      ).find((t) => SUBSCRIPTION_TIERS[t].features[a.anchorFeature!]);
      expect(minTierOf(a), a.pack.code).toBe(first);
      expect(a.minTier, a.pack.code).toBeNull();
    }
  });

  it("an agent with no anchor carries an explicit plan, and an agent with no rule is Enterprise only", () => {
    for (const a of ORG_AGENTS.filter((x) => x.anchorFeature === null)) {
      expect(a.minTier, a.pack.code).not.toBeNull();
      expect(minTierOf(a)).toBe(a.minTier);
    }
    const base = ORG_AGENTS[0]!;
    const none: OrgAgent = { ...base, anchorFeature: null, minTier: null };
    expect(minTierOf(none)).toBe("enterprise");
    const never: OrgAgent = { ...base, anchorFeature: "white_label", minTier: null };
    expect(minTierOf(never)).toBe("enterprise");
  });

  it("entitlements are exact, case-insensitive, and fail closed", () => {
    expect(orgAgentEntitlement(T("t1"), "starter", "org-fees")).toMatchObject({
      entitled: true,
      minTier: "starter",
      tier: "starter",
      source: "legacy-tier-catalog",
    });
    expect(orgAgentEntitlement(T("t1"), "trial", "org-fees")).toMatchObject({
      entitled: false,
      minTier: "starter",
    });
    expect(orgAgentEntitlement(T("t1"), " Enterprise ", "org-alumni").entitled).toBe(true);
    expect(orgAgentEntitlement(T("t1"), "professional", "org-alumni").entitled).toBe(false);
    expect(orgAgentEntitlement(T("t1"), "mystery-plan", "org-support")).toMatchObject({
      tier: "trial",
      entitled: true,
    });
    expect(orgAgentEntitlement(T("t1"), "mystery-plan", "org-fees").entitled).toBe(false);
    expect(orgAgentEntitlement(T("t1"), null, "org-support").tier).toBe("trial");
    expect(orgAgentEntitlement(T("t1"), "enterprise", "nope")).toMatchObject({
      entitled: false,
      minTier: null,
    });
    expect(() => orgAgentEntitlement(T("  "), "enterprise", "org-fees")).toThrow(/fail closed/);
  });

  it("the plan matrix lists what each plan adds, once", () => {
    const m = planMatrix();
    expect(m.map((r) => r.tier)).toEqual([...TIER_ORDER]);
    expect(m.flatMap((r) => r.addedHere)).toHaveLength(17);
    expect(new Set(m.flatMap((r) => r.addedHere)).size).toBe(17);
    expect(m.map((r) => r.addedHere.length)).toEqual([1, 4, 7, 4, 1]);
    for (const r of m) expect(r.included.length).toBe(orgAgentsForTier(r.tier).length);
  });
});
