/**
 * CoreGrid Scholar — Phase 07 AI Agent System unit tests (agent-core).
 *
 * Validates:
 * - Agent definition creation and validation (Sections H, I, M).
 * - Agent lifecycle transitions and approval requirements (Sections K, L, N).
 * - Risk classification control profiles (Section O).
 * - Agent execution context creation and tenant-boundary validation (Sections E2, FO).
 */

import { describe, expect, it } from "vitest";
import { tenantId } from "@/lib/tenant-core";
import { createExecutionContext } from "@/lib/runtime-core";
import {
  agentSessionId,
  agentExecutionId,
  agentCorrelationId,
  createAgentDefinition,
  changeAgentLifecycle,
  isAgentLifecycleTransitionAllowed,
  createAgentExecutionContext,
  validateAgentExecutionContext,
  RISK_CONTROL_PROFILES,
  type AgentDefinition,
  type CreateAgentDefinitionInput,
} from "@/lib/agent-core";

const TENANT_A = tenantId("tenant-a");
const TENANT_B = tenantId("tenant-b");
const NOW = "2026-01-01T00:00:00Z";

function baseInput(
  overrides: Partial<CreateAgentDefinitionInput> = {},
): CreateAgentDefinitionInput {
  return {
    tenantId: TENANT_A,
    name: "Attendance Assistant",
    purpose: "Summarize daily attendance anomalies",
    type: "monitoring",
    ownerUserId: "user-1",
    version: "1.0.0",
    riskClassification: "low",
    trustLevel: "standard",
    capabilities: ["read_attendance"],
    allowedToolIds: ["attendance.read"],
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
      resourceTypes: ["attendance"],
      maxDataClassification: "TENANT_INTERNAL",
    },
    now: NOW,
    ...overrides,
  };
}

describe("createAgentDefinition", () => {
  it("creates a valid agent definition in proposed state", () => {
    const result = createAgentDefinition(baseInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.definition.lifecycleState).toBe("proposed");
      expect(result.definition.deploymentState).toBe("not_deployed");
      expect(result.definition.evaluationStatus).toBe("not_evaluated");
      expect(result.definition.tenantId).toBe(TENANT_A);
    }
  });

  it("rejects an empty name", () => {
    const result = createAgentDefinition(baseInput({ name: "  " }));
    expect(result.ok).toBe(false);
  });

  it("rejects an empty purpose", () => {
    const result = createAgentDefinition(baseInput({ purpose: "" }));
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown agent type", () => {
    // @ts-expect-error intentional invalid type for validation test
    const result = createAgentDefinition(baseInput({ type: "not_a_type" }));
    expect(result.ok).toBe(false);
  });

  it("rejects a missing owner (Section IO)", () => {
    const result = createAgentDefinition(baseInput({ ownerUserId: "" }));
    expect(result.ok).toBe(false);
  });

  it("rejects a missing version", () => {
    const result = createAgentDefinition(baseInput({ version: "" }));
    expect(result.ok).toBe(false);
  });
});

describe("Agent lifecycle transitions (Sections K, L)", () => {
  it("allows proposed -> in_review without approval", () => {
    const transition = isAgentLifecycleTransitionAllowed("proposed", "in_review");
    expect(transition.allowed).toBe(true);
    expect(transition.requiresApproval).toBe(false);
  });

  it("requires approval for approved -> deployed", () => {
    const transition = isAgentLifecycleTransitionAllowed("approved", "deployed");
    expect(transition.allowed).toBe(true);
    expect(transition.requiresApproval).toBe(true);
  });

  it("rejects an undefined transition", () => {
    const transition = isAgentLifecycleTransitionAllowed("proposed", "deployed");
    expect(transition.allowed).toBe(false);
  });
});

describe("changeAgentLifecycle", () => {
  function makeDefinition(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
    const created = createAgentDefinition(baseInput());
    if (!created.ok) throw new Error("fixture creation failed");
    return { ...created.definition, ...overrides };
  }

  it("retired agents cannot change lifecycle state (Section HB)", () => {
    const definition = makeDefinition({ lifecycleState: "retired" });
    const result = changeAgentLifecycle({
      definition,
      to: "deployed",
      actorId: "admin-1",
      reason: "reactivate",
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a disallowed transition", () => {
    const definition = makeDefinition({ lifecycleState: "proposed" });
    const result = changeAgentLifecycle({
      definition,
      to: "deployed",
      actorId: "admin-1",
      reason: null,
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it("requires approval context to deploy high-risk agents (Section N)", () => {
    const definition = makeDefinition({
      lifecycleState: "approved",
      riskClassification: "high",
    });
    const result = changeAgentLifecycle({
      definition,
      to: "deployed",
      actorId: "admin-1",
      reason: null,
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it("deploys a low-risk agent without explicit approval reason", () => {
    const definition = makeDefinition({
      lifecycleState: "approved",
      riskClassification: "low",
    });
    const result = changeAgentLifecycle({
      definition,
      to: "deployed",
      actorId: "admin-1",
      reason: null,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.definition.lifecycleState).toBe("deployed");
      expect(result.definition.deploymentState).toBe("deployed");
    }
  });

  it("deploys a high-risk agent when approval reason is provided", () => {
    const definition = makeDefinition({
      lifecycleState: "approved",
      riskClassification: "critical",
    });
    const result = changeAgentLifecycle({
      definition,
      to: "deployed",
      actorId: "admin-1",
      reason: "Approved by security review board",
      now: NOW,
    });
    expect(result.ok).toBe(true);
  });
});

describe("RISK_CONTROL_PROFILES (Section O)", () => {
  it("requires human-in-loop and sandbox for high/critical risk", () => {
    expect(RISK_CONTROL_PROFILES.high.requiresHumanInLoop).toBe(true);
    expect(RISK_CONTROL_PROFILES.high.requiresSandbox).toBe(true);
    expect(RISK_CONTROL_PROFILES.critical.allowsAutonomous).toBe(false);
  });

  it("allows autonomous execution for low/medium risk without sandbox", () => {
    expect(RISK_CONTROL_PROFILES.low.allowsAutonomous).toBe(true);
    expect(RISK_CONTROL_PROFILES.low.requiresSandbox).toBe(false);
    expect(RISK_CONTROL_PROFILES.medium.requiresMonitoring).toBe(true);
  });
});

describe("Agent execution context (Sections E2, BZ, FO)", () => {
  function makeAgent(): AgentDefinition {
    const created = createAgentDefinition(baseInput());
    if (!created.ok) throw new Error("fixture creation failed");
    return created.definition;
  }

  it("creates a valid tenant-scoped execution context", () => {
    const agent = makeAgent();
    const execCtx = createExecutionContext({
      source: "agent",
      actorId: "agent-runtime",
      tenantId: TENANT_A,
      tenantRequired: true,
      now: NOW,
    });
    const context = createAgentExecutionContext(
      agent,
      agentSessionId("session-1"),
      agentExecutionId("exec-1"),
      agentCorrelationId("corr-1"),
      "user-1",
      null,
      NOW,
      execCtx,
    );
    expect(validateAgentExecutionContext(context)).toEqual({ ok: true });
  });

  it("rejects cross-tenant agent execution (Section FO)", () => {
    const agent = makeAgent();
    const execCtx = createExecutionContext({
      source: "agent",
      actorId: "agent-runtime",
      tenantId: TENANT_A,
      tenantRequired: true,
      isCrossTenantOperation: true,
      isPlatformOperation: true,
      now: NOW,
    });
    const context = createAgentExecutionContext(
      agent,
      agentSessionId("session-2"),
      agentExecutionId("exec-2"),
      agentCorrelationId("corr-2"),
      "user-1",
      null,
      NOW,
      execCtx,
    );
    const result = validateAgentExecutionContext(context);
    expect(result.ok).toBe(false);
  });

  it("rejects execution when agent tenant scope does not match execution tenant context", () => {
    const agent = makeAgent();
    const execCtx = createExecutionContext({
      source: "agent",
      actorId: "agent-runtime",
      tenantId: TENANT_B,
      tenantRequired: true,
      now: NOW,
    });
    const context = createAgentExecutionContext(
      agent,
      agentSessionId("session-3"),
      agentExecutionId("exec-3"),
      agentCorrelationId("corr-3"),
      "user-1",
      null,
      NOW,
      execCtx,
    );
    const result = validateAgentExecutionContext(context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/tenant scope/i);
    }
  });
});
