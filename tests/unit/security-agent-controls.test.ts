/**
 * CoreGrid Scholar — Phase 08 Security Engine unit tests
 * (security-agent-controls: the Phase 07/08 boundary).
 *
 * Validates:
 * - Agent security fail-safe: deployment state and high-risk production
 *   actions require human approval context (Sections N.2, N.3, N.4).
 * - Tool security: Phase 07 deny lists are honored; dangerous tool
 *   categories require human approval (Sections O.1, O.3).
 * - Acting-as-user permission verification.
 */

import { describe, expect, it } from "vitest";
import { tenantId } from "@/lib/tenant-core";
import {
  createAgentDefinition,
  type AgentDefinition,
  type AgentPermission,
} from "@/lib/agent-core";
import {
  evaluateAgentSecurity,
  evaluateToolSecurity,
  canActAsUser,
  toSecurityDecisionState,
  type ToolDefinition,
} from "@/lib/security-agent-controls";

const TENANT_A = tenantId("tenant-a");
const NOW = "2026-01-01T00:00:00Z";

function makeAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  const created = createAgentDefinition({
    tenantId: TENANT_A,
    name: "Finance Assistant",
    purpose: "Summarize fee collection",
    type: "monitoring",
    ownerUserId: "user-1",
    version: "1.0.0",
    riskClassification: "low",
    trustLevel: "standard",
    capabilities: ["read_fees"],
    allowedToolIds: ["fees.read"],
    deniedToolIds: ["fees.write"],
    modelPolicy: {
      allowedProviders: ["openai-compatible"],
      maxDataClassification: "TENANT_INTERNAL",
      maxInputTokens: 4000,
      maxOutputTokens: 1000,
      allowFallback: false,
    },
    memoryPolicy: {
      allowPersistentWrite: false,
      allowedMemoryCategories: ["working"],
      requireInferenceMarking: true,
    },
    scope: {
      tenantId: TENANT_A,
      workspaceIds: [],
      resourceTypes: ["fees"],
      maxDataClassification: "TENANT_INTERNAL",
    },
    now: NOW,
  });
  if (!created.ok) throw new Error("fixture failed");
  return {
    ...created.definition,
    lifecycleState: "deployed",
    environment: "production",
    ...overrides,
  };
}

describe("evaluateAgentSecurity (Sections N.2, N.4 fail-safe)", () => {
  it("denies an agent that is not deployed/monitoring", () => {
    const agent = makeAgent({ lifecycleState: "proposed" });
    const result = evaluateAgentSecurity({
      agent,
      actionType: null,
      hasHumanApprovalContext: false,
    });
    expect(result.decision).toBe("DENY");
  });

  it("sends a high-risk production action to REVIEW without approval context (Section N.3)", () => {
    const agent = makeAgent();
    const result = evaluateAgentSecurity({
      agent,
      actionType: "financial_operation",
      hasHumanApprovalContext: false,
    });
    expect(result.decision).toBe("REVIEW");
  });

  it("allows a high-risk production action when human approval context is present", () => {
    const agent = makeAgent();
    const result = evaluateAgentSecurity({
      agent,
      actionType: "financial_operation",
      hasHumanApprovalContext: true,
    });
    expect(result.decision).toBe("ALLOW");
  });

  it("allows a non-high-risk action for a deployed agent without approval context", () => {
    const agent = makeAgent();
    const result = evaluateAgentSecurity({
      agent,
      actionType: null,
      hasHumanApprovalContext: false,
    });
    expect(result.decision).toBe("ALLOW");
  });

  it("never grants trust merely from a high trustLevel/riskClassification (N.4)", () => {
    // Even an agent Phase 07 marks maximally trusted must still be DENYed
    // here if its lifecycle state is not deployed/monitoring.
    const agent = makeAgent({
      lifecycleState: "suspended",
      trustLevel: "high",
      riskClassification: "low",
    });
    const result = evaluateAgentSecurity({
      agent,
      actionType: null,
      hasHumanApprovalContext: true,
    });
    expect(result.decision).toBe("DENY");
  });
});

describe("evaluateToolSecurity (Sections O.1, O.3)", () => {
  function tool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
    return { id: "fees.read", dangerousCategories: [], ...overrides };
  }

  it("denies a tool on the agent's explicit deny list even if requested", () => {
    const agent = makeAgent();
    const result = evaluateToolSecurity({
      agent,
      tool: tool({ id: "fees.write" }),
      hasHumanApprovalContext: true,
    });
    expect(result.decision).toBe("DENY");
  });

  it("denies a tool not on the agent's allow list", () => {
    const agent = makeAgent();
    const result = evaluateToolSecurity({
      agent,
      tool: tool({ id: "unlisted.tool" }),
      hasHumanApprovalContext: true,
    });
    expect(result.decision).toBe("DENY");
  });

  it("sends a dangerous tool category to REVIEW without approval", () => {
    const agent = makeAgent();
    const result = evaluateToolSecurity({
      agent,
      tool: tool({ dangerousCategories: ["financial_transaction"] }),
      hasHumanApprovalContext: false,
    });
    expect(result.decision).toBe("REVIEW");
  });

  it("allows an allow-listed, non-dangerous tool", () => {
    const agent = makeAgent();
    const result = evaluateToolSecurity({ agent, tool: tool(), hasHumanApprovalContext: false });
    expect(result.decision).toBe("ALLOW");
  });
});

describe("canActAsUser", () => {
  it("returns false when no acting_as_user permission is granted", () => {
    const permissions: AgentPermission[] = [{ kind: "tool", toolId: "fees.read" }];
    expect(canActAsUser(permissions, "user-1")).toBe(false);
  });

  it("returns true when the specific user is explicitly granted", () => {
    const permissions: AgentPermission[] = [{ kind: "acting_as_user", userId: "user-1" }];
    expect(canActAsUser(permissions, "user-1")).toBe(true);
    expect(canActAsUser(permissions, "user-2")).toBe(false);
  });
});

describe("toSecurityDecisionState", () => {
  it("passes through ALLOW/DENY/REVIEW unchanged", () => {
    expect(toSecurityDecisionState("ALLOW")).toBe("ALLOW");
    expect(toSecurityDecisionState("DENY")).toBe("DENY");
    expect(toSecurityDecisionState("REVIEW")).toBe("REVIEW");
  });
});
