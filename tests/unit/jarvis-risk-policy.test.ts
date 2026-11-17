import { describe, expect, it } from "vitest";
import {
  createCapabilityRegistry,
  type CapabilityRegistry,
  type CapabilityRegistrationInput,
} from "../../frontend/src/lib/workforce/capability-registry";
import {
  defineWorkerDefinition,
  type WorkerDefinition,
} from "../../frontend/src/lib/workforce/worker-definition";
import {
  COREGRID_PLATFORM_REF,
  PLATFORM_AGENT_RESOURCE_SCOPE,
  resolvePlatformAgentAuthority,
} from "../../frontend/src/lib/workforce/platform-agent-authority";
import {
  evaluateJarvisRiskPolicy,
  JARVIS_RISK_POLICY_VERSION,
  JARVIS_RISK_TIER_POLICY,
  type JarvisHumanApprovalEvidence,
  type JarvisRiskActionId,
} from "../../frontend/src/lib/jarvis/risk-policy";

const NOW = "2026-11-04T05:00:00.000Z";
const EXPIRY = "2026-11-04T06:00:00.000Z";
const ACTION_REF = "proposal-001";
const ACTION_IDS = Object.keys(JARVIS_RISK_TIER_POLICY) as JarvisRiskActionId[];

function riskClassFor(actionId: JarvisRiskActionId): "low" | "medium" | "high" | "critical" {
  const tier = JARVIS_RISK_TIER_POLICY[actionId];
  if (tier === "T0" || tier === "T1") return "low";
  if (tier === "T2") return "medium";
  if (tier === "T3") return "high";
  return "critical";
}

function registeredCapabilities(
  ids: readonly string[] = ACTION_IDS,
): ReturnType<typeof createCapabilityRegistry> {
  const registrations: CapabilityRegistrationInput[] = ids.map((capabilityId) => ({
    capabilityId,
    contract: `Governed action ${capabilityId}`,
    riskClass: riskClassFor(capabilityId as JarvisRiskActionId),
    evidenceRequirements: ["policy-decision"],
  }));
  return createCapabilityRegistry(registrations);
}

function capabilityRegistry(ids: readonly string[] = ACTION_IDS): CapabilityRegistry {
  const result = registeredCapabilities(ids);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.registry;
}

function workerDefinition(
  overrides: Partial<Parameters<typeof defineWorkerDefinition>[0]> = {},
): WorkerDefinition {
  const result = defineWorkerDefinition({
    id: "agent-operations",
    tenantScope: "tenant-operations",
    identityRef: "identity-agent-operations",
    classification: "ai",
    capabilities: ACTION_IDS.map((capabilityId) => ({
      capabilityId,
      description: `Governed action ${capabilityId}`,
    })),
    authorityBounds: {
      maxRiskClass: "critical",
      resourceScopes: [PLATFORM_AGENT_RESOURCE_SCOPE],
    },
    lifecycle: "active",
    ...overrides,
  });

  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.definition;
}

function grant(overrides: Record<string, unknown> = {}) {
  return {
    grantId: "grant-operations",
    definitionId: "agent-operations",
    delegationRef: "platform-operations",
    delegatedCapabilities: ACTION_IDS,
    maxGrantedRiskClass: "critical",
    state: "active",
    grantedAt: "2026-11-04T04:00:00.000Z",
    expiresAt: EXPIRY,
    ...overrides,
  };
}

function authority(
  overrides: {
    definition?: WorkerDefinition;
    grant?: Record<string, unknown>;
    registryResult?: ReturnType<typeof createCapabilityRegistry>;
    resolvedAt?: string;
  } = {},
) {
  const result = resolvePlatformAgentAuthority({
    definition: overrides.definition ?? workerDefinition(),
    grant: overrides.grant ?? grant(),
    capabilityRegistry: overrides.registryResult?.ok
      ? overrides.registryResult.registry
      : capabilityRegistry(),
    platformScope: {
      kind: "platform",
      platformRef: COREGRID_PLATFORM_REF,
      resourceScope: PLATFORM_AGENT_RESOURCE_SCOPE,
      tenantRef: null,
    },
    resolvedAt: overrides.resolvedAt ?? NOW,
  });
  if (!result.ok) throw new Error(result.reason);
  return result.authority;
}

function approval(
  actionId: string,
  overrides: Partial<JarvisHumanApprovalEvidence> = {},
): JarvisHumanApprovalEvidence {
  const tier = JARVIS_RISK_TIER_POLICY[actionId as JarvisRiskActionId];
  return {
    approvalId: "approval-123",
    actionId,
    actionRef: ACTION_REF,
    agentDefinitionId: "agent-operations",
    platformRef: COREGRID_PLATFORM_REF,
    decision: "approved",
    identityKind: "human",
    humanIdentityVerified: true,
    approverId: "human-sheriff",
    approverRole: tier === "T3" ? "sheriff" : "platform_staff",
    channel: "console",
    passkeyStepUpVerified: tier === "T3",
    recordedAt: "2026-11-04T04:30:00.000Z",
    expiresAt: EXPIRY,
    revalidatedAt: NOW,
    ...overrides,
  };
}

describe("platform-scoped JARVIS worker authority", () => {
  it("projects active delegated capabilities without introducing a tenant authority", () => {
    const result = resolvePlatformAgentAuthority({
      definition: workerDefinition(),
      grant: grant({ delegatedCapabilities: ["observe_platform_state"] }),
      capabilityRegistry: capabilityRegistry(),
      platformScope: {
        kind: "platform",
        platformRef: COREGRID_PLATFORM_REF,
        resourceScope: PLATFORM_AGENT_RESOURCE_SCOPE,
        tenantRef: null,
      },
      resolvedAt: NOW,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.authority.scope).toEqual({
        kind: "platform",
        platformRef: COREGRID_PLATFORM_REF,
        resourceScope: PLATFORM_AGENT_RESOURCE_SCOPE,
        tenantRef: null,
      });
      expect(result.authority.capabilities.map((item) => item.capabilityId)).toEqual([
        "observe_platform_state",
      ]);
      expect(result.authority).not.toHaveProperty("tenantId");
    }
  });

  it("rejects a tenant context presented as platform scope", () => {
    const result = resolvePlatformAgentAuthority({
      definition: workerDefinition(),
      grant: grant(),
      capabilityRegistry: capabilityRegistry(),
      platformScope: {
        kind: "platform",
        platformRef: COREGRID_PLATFORM_REF,
        resourceScope: PLATFORM_AGENT_RESOURCE_SCOPE,
        tenantRef: "tenant-operations",
      } as unknown as Parameters<typeof resolvePlatformAgentAuthority>[0]["platformScope"],
      resolvedAt: NOW,
    });

    expect(result).toEqual({
      ok: false,
      reason: "server_resolved_platform_scope_required",
    });
  });

  it.each([
    ["human identity", workerDefinition({ classification: "human" }), grant()],
    ["inactive worker", workerDefinition({ lifecycle: "suspended" }), grant()],
    [
      "undeclared platform scope",
      workerDefinition({ authorityBounds: { maxRiskClass: "critical", resourceScopes: [] } }),
      grant(),
    ],
    ["expired delegation", workerDefinition(), grant({ expiresAt: NOW })],
    ["unbounded delegation", workerDefinition(), grant({ expiresAt: null })],
    ["future delegation", workerDefinition(), grant({ grantedAt: EXPIRY })],
    ["wrong definition", workerDefinition(), grant({ definitionId: "different-agent" })],
    [
      "undeclared capability",
      workerDefinition(),
      grant({ delegatedCapabilities: ["undeclared-action"] }),
    ],
  ])("fails closed for %s", (_label, definition, workerGrant) => {
    const capabilities = registeredCapabilities();
    const result = resolvePlatformAgentAuthority({
      definition,
      grant: workerGrant,
      capabilityRegistry: capabilities.ok ? capabilities.registry : new Map(),
      platformScope: {
        kind: "platform",
        platformRef: COREGRID_PLATFORM_REF,
        resourceScope: PLATFORM_AGENT_RESOURCE_SCOPE,
        tenantRef: null,
      },
      resolvedAt: NOW,
    });
    expect(result.ok).toBe(false);
  });
});

describe("versioned T0–T4 JARVIS policy", () => {
  it("denies unknown and unmapped actions and stamps every decision with policy version", () => {
    const result = evaluateJarvisRiskPolicy({
      actionId: "rewrite_architecture",
      actionRef: ACTION_REF,
      phase: "execution",
      evaluatedAt: NOW,
      authority: authority(),
    });

    expect(result.decision).toBe("deny");
    expect(result).toMatchObject({
      policyVersion: JARVIS_RISK_POLICY_VERSION,
      actionId: "rewrite_architecture",
      code: "unknown_action",
    });
  });

  it("allows delegated T0/T1 actions autonomously", () => {
    for (const actionId of ["observe_platform_state", "coordinate_workers"] as const) {
      const result = evaluateJarvisRiskPolicy({
        actionId,
        actionRef: ACTION_REF,
        phase: "execution",
        evaluatedAt: NOW,
        authority: authority(),
      });
      expect(result.decision).toBe("allow");
      expect(result.policyVersion).toBe(JARVIS_RISK_POLICY_VERSION);
    }
  });

  it("routes T2 to console approval and denies execution without recorded approval", () => {
    const pending = evaluateJarvisRiskPolicy({
      actionId: "send_customer_communications",
      actionRef: ACTION_REF,
      phase: "proposal",
      evaluatedAt: NOW,
      authority: authority(),
    });
    const denied = evaluateJarvisRiskPolicy({
      actionId: "send_customer_communications",
      actionRef: ACTION_REF,
      phase: "execution",
      evaluatedAt: NOW,
      authority: authority(),
    });
    const approved = evaluateJarvisRiskPolicy({
      actionId: "send_customer_communications",
      actionRef: ACTION_REF,
      phase: "execution",
      evaluatedAt: NOW,
      authority: authority(),
      approval: approval("send_customer_communications"),
    });
    const steppedUpApproval = evaluateJarvisRiskPolicy({
      actionId: "send_customer_communications",
      actionRef: ACTION_REF,
      phase: "execution",
      evaluatedAt: NOW,
      authority: authority(),
      approval: approval("send_customer_communications", { passkeyStepUpVerified: true }),
    });

    expect(pending.decision).toBe("require_approval");
    expect(pending.policyVersion).toBe(JARVIS_RISK_POLICY_VERSION);
    expect(denied).toMatchObject({
      decision: "deny",
      policyVersion: JARVIS_RISK_POLICY_VERSION,
      code: "human_approval_required",
    });
    expect(approved.decision).toBe("allow");
    expect(steppedUpApproval.decision).toBe("allow");
  });

  it("never executes T3 without a current Sheriff console passkey approval", () => {
    const actionId = "deploy_production";
    const withoutApproval = evaluateJarvisRiskPolicy({
      actionId,
      actionRef: ACTION_REF,
      phase: "execution",
      evaluatedAt: NOW,
      authority: authority(),
    });
    const noPasskey = evaluateJarvisRiskPolicy({
      actionId,
      actionRef: ACTION_REF,
      phase: "execution",
      evaluatedAt: NOW,
      authority: authority(),
      approval: approval(actionId, { passkeyStepUpVerified: false }),
    });
    const valid = evaluateJarvisRiskPolicy({
      actionId,
      actionRef: ACTION_REF,
      phase: "execution",
      evaluatedAt: NOW,
      authority: authority(),
      approval: approval(actionId),
    });

    expect(withoutApproval.decision).toBe("deny");
    expect(withoutApproval.policyVersion).toBe(JARVIS_RISK_POLICY_VERSION);
    expect(noPasskey.decision).toBe("deny");
    expect(valid).toMatchObject({
      decision: "allow",
      policyVersion: JARVIS_RISK_POLICY_VERSION,
      approvalId: "approval-123",
    });
  });

  it("revalidates approval at execution and binds it to the action and agent", () => {
    const actionId = "export_tenant_data";
    for (const invalidApproval of [
      approval(actionId, { actionId: "change_subscription" }),
      approval(actionId, { actionRef: "different-proposal" }),
      approval(actionId, { revalidatedAt: "2026-11-04T04:59:59.000Z" }),
      approval(actionId, { expiresAt: NOW }),
      approval(actionId, { approverRole: "platform_staff" }),
      approval(actionId, { humanIdentityVerified: false }),
    ]) {
      const result = evaluateJarvisRiskPolicy({
        actionId,
        actionRef: ACTION_REF,
        phase: "execution",
        evaluatedAt: NOW,
        authority: authority(),
        approval: invalidApproval,
      });
      expect(result.decision).toBe("deny");
    }
  });

  it("always denies T4, even with an otherwise valid human approval", () => {
    const actionId = "delete_audit_records";
    const result = evaluateJarvisRiskPolicy({
      actionId,
      actionRef: ACTION_REF,
      phase: "execution",
      evaluatedAt: NOW,
      authority: authority(),
      approval: approval(actionId),
    });

    expect(result).toMatchObject({
      decision: "deny",
      policyVersion: JARVIS_RISK_POLICY_VERSION,
      riskTier: "T4",
      code: "forbidden_tier",
    });
  });

  it("denies stale platform authority and capability-risk mismatches", () => {
    const staleAuthority = authority({ resolvedAt: "2026-11-04T04:59:59.000Z" });
    const stale = evaluateJarvisRiskPolicy({
      actionId: "observe_platform_state",
      actionRef: ACTION_REF,
      phase: "execution",
      evaluatedAt: NOW,
      authority: staleAuthority,
    });
    const mismatchedAuthority = authority({
      registryResult: createCapabilityRegistry([
        {
          capabilityId: "observe_platform_state",
          contract: "platform observation",
          riskClass: "critical",
          evidenceRequirements: ["policy-decision"],
        },
      ]),
      definition: workerDefinition({
        capabilities: [{ capabilityId: "observe_platform_state", description: "observe" }],
      }),
      grant: grant({ delegatedCapabilities: ["observe_platform_state"] }),
    });
    const mismatched = evaluateJarvisRiskPolicy({
      actionId: "observe_platform_state",
      actionRef: ACTION_REF,
      phase: "execution",
      evaluatedAt: NOW,
      authority: mismatchedAuthority,
    });

    expect(stale.decision).toBe("deny");
    expect(mismatched.decision).toBe("deny");
  });
});
