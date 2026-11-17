/**
 * SV1-JARVIS-04 — bounded internal role playbooks.
 * Offline and deterministic; uses the real capability registry, worker
 * definition, platform authority and risk policy contracts.
 */
import { describe, expect, it } from "vitest";
import {
  decidePlaybookAction,
  JARVIS_PLAYBOOKS,
  PLAYBOOK_NEVER_DECLARABLE,
  PLAYBOOK_WORKSPACES,
  playbookCapabilityRegistrations,
  validatePlaybook,
  type Playbook,
} from "../../frontend/src/lib/jarvis/playbooks";
import {
  evaluateJarvisRiskPolicy,
  JARVIS_RISK_TIER_POLICY,
  type JarvisRiskActionId,
} from "../../frontend/src/lib/jarvis/risk-policy";
import { createCapabilityRegistry } from "../../frontend/src/lib/workforce/capability-registry";
import { defineWorkerDefinition } from "../../frontend/src/lib/workforce/worker-definition";
import {
  COREGRID_PLATFORM_REF,
  PLATFORM_AGENT_RESOURCE_SCOPE,
  resolvePlatformAgentAuthority,
} from "../../frontend/src/lib/workforce/platform-agent-authority";

const ALL_ACTIONS = Object.keys(JARVIS_RISK_TIER_POLICY) as JarvisRiskActionId[];
const byWorkspace = (w: string) => JARVIS_PLAYBOOKS.find((p) => p.workspace === w) as Playbook;
const declared = (p: Playbook) => [...p.direct, ...p.escalated.map((e) => e.actionId)];

describe("playbook set", () => {
  it("has exactly five playbooks, one per non-personal V1 workspace", () => {
    expect(JARVIS_PLAYBOOKS).toHaveLength(5);
    expect(JARVIS_PLAYBOOKS.map((p) => p.workspace).sort()).toEqual(
      [...PLAYBOOK_WORKSPACES].sort(),
    );
    expect(JARVIS_PLAYBOOKS.map((p) => p.workspace)).not.toContain("personal");
    expect(new Set(JARVIS_PLAYBOOKS.map((p) => p.id)).size).toBe(5);
  });

  it("every shipped playbook validates", () => {
    for (const p of JARVIS_PLAYBOOKS) expect(validatePlaybook(p)).toEqual([]);
  });

  it("declares tools, tiers and an escalation path for each playbook", () => {
    for (const p of JARVIS_PLAYBOOKS) {
      expect(p.direct.length).toBeGreaterThan(0);
      expect(p.escalated.length).toBeGreaterThan(0);
      expect(p.escalationPath).toEqual(["console_inbox", "whatsapp", "voice"]);
      expect(p.credentials).toBe("none");
    }
  });

  it("direct actions are only T0/T1; escalated only T2/T3; T3 only via the sheriff", () => {
    for (const p of JARVIS_PLAYBOOKS) {
      for (const a of p.direct) expect(["T0", "T1"]).toContain(JARVIS_RISK_TIER_POLICY[a]);
      for (const e of p.escalated) {
        const tier = JARVIS_RISK_TIER_POLICY[e.actionId];
        expect(["T2", "T3"]).toContain(tier);
        if (tier === "T3") expect(e.approver).toBe("sheriff");
      }
    }
  });

  it("no playbook declares a T4, secret, deploy, production-DB or spend action", () => {
    for (const p of JARVIS_PLAYBOOKS) {
      for (const a of declared(p)) {
        expect(JARVIS_RISK_TIER_POLICY[a]).not.toBe("T4");
        expect(PLAYBOOK_NEVER_DECLARABLE).not.toContain(a);
      }
    }
  });
});

describe("workspace-specific bounds (from the V1 console brief)", () => {
  it("Platform Operations is read-only: no direct T2/T3 and mutations escalate", () => {
    const p = byWorkspace("platform_operations");
    expect(p.direct.every((a) => ["T0", "T1"].includes(JARVIS_RISK_TIER_POLICY[a]))).toBe(true);
    expect(decidePlaybookAction(p.id, "suspend_organization")).toMatchObject({
      decision: "escalate",
      approver: "sheriff",
    });
  });
  it("Platform Administration escalates privileged invites and cannot do anything else mutating", () => {
    const p = byWorkspace("platform_administration");
    expect(decidePlaybookAction(p.id, "invite_privileged_staff")).toMatchObject({
      decision: "escalate",
      approver: "sheriff",
    });
    expect(decidePlaybookAction(p.id, "change_subscription").decision).toBe("deny");
  });
  it("Operations escalates suspension", () => {
    const p = byWorkspace("operations");
    expect(decidePlaybookAction(p.id, "suspend_organization")).toMatchObject({
      decision: "escalate",
    });
  });
  it("Engineering has no secrets or deploy access and escalates configuration changes", () => {
    const p = byWorkspace("engineering");
    for (const a of ["access_secrets", "deploy_production", "mutate_production_database"]) {
      expect(decidePlaybookAction(p.id, a)).toMatchObject({
        decision: "deny",
        code: "not_declared",
      });
    }
    expect(decidePlaybookAction(p.id, "change_platform_configuration")).toMatchObject({
      decision: "escalate",
      approver: "platform_staff",
    });
  });
  it("Support escalates data access beyond aggregates and cannot export directly", () => {
    const p = byWorkspace("support");
    expect(p.direct).not.toContain("export_tenant_data");
    expect(decidePlaybookAction(p.id, "export_tenant_data")).toMatchObject({
      decision: "escalate",
      approver: "sheriff",
    });
  });
});

describe("undeclared actions are denied", () => {
  it("every action is allow/escalate iff declared by that playbook, else denied", () => {
    for (const p of JARVIS_PLAYBOOKS) {
      for (const a of ALL_ACTIONS) {
        const d = decidePlaybookAction(p.id, a);
        const isDirect = (p.direct as readonly string[]).includes(a);
        const isEscalated = p.escalated.some((e) => e.actionId === a);
        expect(d.decision).toBe(isDirect ? "allow" : isEscalated ? "escalate" : "deny");
      }
    }
  });

  it("denies T4, unmapped actions, unknown playbooks, and prototype keys", () => {
    const p = byWorkspace("platform_operations");
    for (const a of [
      "disable_guardrails",
      "delete_audit_records",
      "mix_cross_tenant_data",
      "made_up",
      "constructor",
      "__proto__",
      "",
    ]) {
      expect(decidePlaybookAction(p.id, a).decision).toBe("deny");
    }
    expect(decidePlaybookAction("playbook.nope", "observe_platform_state")).toMatchObject({
      code: "unknown_playbook",
    });
  });

  it("an invalid playbook denies everything (fails closed)", () => {
    const bad: Playbook = { ...byWorkspace("support"), direct: ["deploy_production"] };
    expect(validatePlaybook(bad).length).toBeGreaterThan(0);
    expect(decidePlaybookAction(bad.id, "observe_platform_state", [bad])).toMatchObject({
      decision: "deny",
      code: "invalid_playbook",
    });
  });
});

describe("validator catches unsafe playbooks", () => {
  const base = byWorkspace("engineering");
  it.each([
    ["standing credentials", { credentials: "standing" } as unknown as Partial<Playbook>],
    ["T3 direct", { direct: [...base.direct, "change_subscription"] } as Partial<Playbook>],
    [
      "T4 escalated",
      { escalated: [{ actionId: "disable_guardrails", approver: "sheriff" }] } as Partial<Playbook>,
    ],
    [
      "T3 by platform_staff",
      {
        escalated: [{ actionId: "export_tenant_data", approver: "platform_staff" }],
      } as Partial<Playbook>,
    ],
    [
      "secrets",
      { escalated: [{ actionId: "access_secrets", approver: "sheriff" }] } as Partial<Playbook>,
    ],
    [
      "duplicate",
      { direct: [...base.direct, base.direct[0] as JarvisRiskActionId] } as Partial<Playbook>,
    ],
    [
      "bad path",
      { escalationPath: ["whatsapp", "console_inbox", "voice"] } as unknown as Partial<Playbook>,
    ],
    ["unknown workspace", { workspace: "personal" } as unknown as Partial<Playbook>],
  ])("rejects %s", (_name, patch) => {
    expect(validatePlaybook({ ...base, ...patch }).length).toBeGreaterThan(0);
  });
});

describe("composition with the existing workforce and risk contracts", () => {
  const NOW = "2026-11-04T05:00:00.000Z";
  function authorityFor(p: Playbook) {
    const regs = playbookCapabilityRegistrations(p);
    const registry = createCapabilityRegistry([...regs]);
    if (!registry.ok) throw new Error(registry.errors.join("; "));
    const ids = regs.map((r) => r.capabilityId);
    const def = defineWorkerDefinition({
      id: `agent-${p.workspace}`,
      tenantScope: "tenant-operations",
      identityRef: `identity-${p.workspace}`,
      classification: "ai",
      capabilities: ids.map((capabilityId) => ({ capabilityId, description: capabilityId })),
      authorityBounds: { maxRiskClass: "high", resourceScopes: [PLATFORM_AGENT_RESOURCE_SCOPE] },
      lifecycle: "active",
    });
    if (!def.ok) throw new Error(def.errors.join("; "));
    const res = resolvePlatformAgentAuthority({
      definition: def.definition,
      grant: {
        grantId: "grant-1",
        definitionId: `agent-${p.workspace}`,
        delegationRef: "platform-operations",
        delegatedCapabilities: ids,
        maxGrantedRiskClass: "high",
        state: "active",
        grantedAt: "2026-11-04T04:00:00.000Z",
        expiresAt: "2026-11-04T07:00:00.000Z",
      },
      capabilityRegistry: registry.registry,
      platformScope: {
        kind: "platform",
        platformRef: COREGRID_PLATFORM_REF,
        resourceScope: PLATFORM_AGENT_RESOURCE_SCOPE,
        tenantRef: null,
      },
      resolvedAt: NOW,
    });
    if (!res.ok) throw new Error(res.reason);
    return res.authority;
  }

  it("each playbook registers cleanly and yields a platform authority", () => {
    for (const p of JARVIS_PLAYBOOKS) {
      const a = authorityFor(p);
      expect(a.capabilities.map((c) => c.capabilityId).sort()).toEqual([...declared(p)].sort());
    }
  });

  it("declared direct actions pass the risk policy; escalated ones require approval; undeclared are denied", () => {
    const p = byWorkspace("engineering");
    const authority = authorityFor(p);
    const evaluate = (actionId: string) =>
      evaluateJarvisRiskPolicy({
        actionId,
        actionRef: "ref-1",
        phase: "proposal",
        evaluatedAt: NOW,
        authority,
      });
    expect(evaluate("observe_platform_state").decision).toBe("allow");
    expect(evaluate("change_platform_configuration").decision).toBe("require_approval");
    const undeclared = evaluate("deploy_production");
    expect(undeclared).toMatchObject({ decision: "deny", code: "capability_or_risk_unregistered" });
  });

  it("registrations carry no credential-like fields", () => {
    for (const p of JARVIS_PLAYBOOKS) {
      for (const r of playbookCapabilityRegistrations(p)) {
        expect(Object.keys(r).sort()).toEqual([
          "capabilityId",
          "contract",
          "evidenceRequirements",
          "riskClass",
        ]);
      }
    }
  });
});
