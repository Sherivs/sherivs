/**
 * CoreGrid Scholar — Phase 17 Controlled Automation Engine unit tests
 * (automation-governance).
 *
 * Validates:
 * - Automation lifecycle (CT): DRAFT -> VALIDATING -> APPROVED -> SHADOW
 *   -> CANARY -> ACTIVE -> PAUSED -> DEPRECATED -> RETIRED.
 * - Ownership (CU): risk owner required.
 * - Scheduling (AU, AV): explicit timezone required; blackout windows.
 * - Quotas (BH, DC) and financial guardrails (BJ).
 * - Tenant isolation (DB, FM.2): cross-tenant execution prohibited
 *   without explicit authorization.
 * - Explainability (CL-CM): decision records answer why/why-not.
 * - AI and agent governance (CQ, FC, FD): proposals carry required
 *   metadata; agents get minimum permissions; tokens are short-lived.
 * - Failure classification and recovery (DU, DV, DW): unknown failures
 *   never silently become success.
 */

import { describe, expect, it } from "vitest";
import { tenantId } from "@/lib/tenant-core";
import {
  isLifecycleTransitionAllowed,
  isOwnershipComplete,
  validateSchedule,
  isWithinBlackoutWindow,
  isWithinQuota,
  evaluateFinancialAction,
  isCrossTenantExecutionAllowed,
  buildDecisionRecord,
  isAIAutomationProposalComplete,
  authorizeAgentRequest,
  isScopedExecutionTokenValid,
  recoveryStrategyFor,
  isUnknownFailure,
  type AIAutomationProposal,
} from "@/lib/automation-governance";

const TENANT_A = tenantId("tenant-a");
const TENANT_B = tenantId("tenant-b");
const NOW = "2026-01-01T00:00:00Z";
const LATER = "2026-01-02T00:00:00Z";

function proposal(overrides: Partial<AIAutomationProposal> = {}): AIAutomationProposal {
  return {
    proposalId: "p1",
    automationId: null,
    confidence: 0.8,
    rationale: "energy saving after occupancy drops",
    evidence: ["twin-occupancy-history"],
    expectedImpact: "reduced energy use",
    uncertainty: "schedule may change",
    ...overrides,
  };
}

describe("Automation lifecycle (CT)", () => {
  it("walks the canonical lifecycle", () => {
    expect(isLifecycleTransitionAllowed("DRAFT", "VALIDATING")).toBe(true);
    expect(isLifecycleTransitionAllowed("VALIDATING", "APPROVED")).toBe(true);
    expect(isLifecycleTransitionAllowed("APPROVED", "SHADOW")).toBe(true);
    expect(isLifecycleTransitionAllowed("SHADOW", "CANARY")).toBe(true);
    expect(isLifecycleTransitionAllowed("CANARY", "ACTIVE")).toBe(true);
    expect(isLifecycleTransitionAllowed("ACTIVE", "PAUSED")).toBe(true);
    expect(isLifecycleTransitionAllowed("PAUSED", "DEPRECATED")).toBe(true);
    expect(isLifecycleTransitionAllowed("DEPRECATED", "RETIRED")).toBe(true);
  });

  it("rejects an illegal DRAFT -> ACTIVE jump", () => {
    expect(isLifecycleTransitionAllowed("DRAFT", "ACTIVE")).toBe(false);
  });

  it("never leaves RETIRED", () => {
    expect(isLifecycleTransitionAllowed("RETIRED", "ACTIVE")).toBe(false);
  });
});

describe("Ownership (CU)", () => {
  it("requires technical, business and risk owners", () => {
    expect(
      isOwnershipComplete({
        technicalOwner: "eng",
        businessOwner: "ops",
        tenantOwner: TENANT_A,
        riskOwner: "risk-1",
      }),
    ).toBe(true);
    expect(
      isOwnershipComplete({
        technicalOwner: "eng",
        businessOwner: "ops",
        tenantOwner: TENANT_A,
        riskOwner: null,
      }),
    ).toBe(false);
  });
});

describe("Scheduling (AU, AV)", () => {
  it("requires an explicit timezone — never assumes server timezone", () => {
    expect(
      validateSchedule({ cron: "0 8 * * 1", timezone: "", blackoutWindows: [], enabled: true }).ok,
    ).toBe(false);
    expect(
      validateSchedule({
        cron: "0 8 * * 1",
        timezone: "Africa/Lagos",
        blackoutWindows: [],
        enabled: true,
      }).ok,
    ).toBe(true);
  });

  it("detects blackout windows", () => {
    const windows = [{ start: "2026-01-01T00:00:00Z", end: "2026-01-01T06:00:00Z" }];
    expect(isWithinBlackoutWindow(windows, "2026-01-01T03:00:00Z")).toBe(true);
    expect(isWithinBlackoutWindow(windows, "2026-01-01T07:00:00Z")).toBe(false);
  });
});

describe("Quotas and financial guardrails (BH, BJ, DC)", () => {
  it("enforces per-tenant quotas", () => {
    const quotas = {
      maxActionsPerMinute: 100,
      maxWorkflowsPerTenant: 5,
      maxConcurrentExecutions: 10,
      maxExternalApiCalls: 50,
    };
    expect(
      isWithinQuota(quotas, {
        actionsThisMinute: 10,
        activeWorkflows: 2,
        concurrentExecutions: 3,
        externalApiCalls: 5,
      }).ok,
    ).toBe(true);
    expect(
      isWithinQuota(quotas, {
        actionsThisMinute: 100,
        activeWorkflows: 2,
        concurrentExecutions: 3,
        externalApiCalls: 5,
      }).ok,
    ).toBe(false);
  });

  it("enforces financial guardrails (BJ)", () => {
    const guardrail = {
      maxAmountMinor: 500_000,
      dailyLimitMinor: 2_000_000,
      requiresApproval: true,
      accountRestricted: false,
      maxTransactionsPerDay: 10,
    };
    expect(
      evaluateFinancialAction({
        amountMinor: 100_000,
        todayTotalMinor: 500_000,
        transactionsToday: 2,
        approvalGranted: true,
        guardrail,
      }).allowed,
    ).toBe(true);
    expect(
      evaluateFinancialAction({
        amountMinor: 600_000,
        todayTotalMinor: 0,
        transactionsToday: 0,
        approvalGranted: true,
        guardrail,
      }).allowed,
    ).toBe(false);
    expect(
      evaluateFinancialAction({
        amountMinor: 100_000,
        todayTotalMinor: 1_900_001,
        transactionsToday: 0,
        approvalGranted: true,
        guardrail,
      }).allowed,
    ).toBe(false);
    expect(
      evaluateFinancialAction({
        amountMinor: 100_000,
        todayTotalMinor: 0,
        transactionsToday: 0,
        approvalGranted: false,
        guardrail,
      }).allowed,
    ).toBe(false);
  });
});

describe("Tenant isolation (DB, FM.2)", () => {
  it("allows same-tenant execution", () => {
    expect(isCrossTenantExecutionAllowed(TENANT_A, TENANT_A, false).ok).toBe(true);
  });

  it("prohibits cross-tenant execution without explicit authorization", () => {
    const result = isCrossTenantExecutionAllowed(TENANT_A, TENANT_B, false);
    expect(result.ok).toBe(false);
  });

  it("allows cross-tenant execution only with an explicit grant", () => {
    expect(isCrossTenantExecutionAllowed(TENANT_A, TENANT_B, true).ok).toBe(true);
  });
});

describe("Explainability (CL, CM)", () => {
  it("builds a decision record answering why it executed", () => {
    const record = buildDecisionRecord({
      conditions: ["occupancy = 0"],
      policyResults: ["allowed"],
      authorizationResult: "authorized",
      riskClassification: "R2",
      approvals: ["admin-1"],
      selectedActions: ["power_down"],
      executed: true,
      reason: "conditions met",
    });
    expect(record.decision).toBe("executed");
    expect(record.selectedActions).toContain("power_down");
  });

  it("records why it did not execute", () => {
    const record = buildDecisionRecord({
      conditions: ["unknown"],
      policyResults: ["fail-closed"],
      authorizationResult: "n/a",
      riskClassification: "R3",
      approvals: [],
      selectedActions: [],
      executed: false,
      reason: "UNKNOWN condition — fail closed",
    });
    expect(record.decision).toBe("not_executed");
  });
});

describe("AI and agent governance (CQ, FC, FD)", () => {
  it("accepts a complete AI proposal with confidence/rationale/uncertainty", () => {
    expect(isAIAutomationProposalComplete(proposal()).ok).toBe(true);
  });

  it("rejects AI proposals without a valid confidence or uncertainty", () => {
    expect(isAIAutomationProposalComplete(proposal({ confidence: Number.NaN })).ok).toBe(false);
    expect(isAIAutomationProposalComplete(proposal({ uncertainty: "" })).ok).toBe(false);
  });

  it("grants agents only the minimum necessary permissions (FC)", () => {
    expect(authorizeAgentRequest(["READ_TWIN", "REQUEST_DRY_RUN"], "READ_TWIN").ok).toBe(true);
    expect(authorizeAgentRequest(["READ_TWIN"], "REQUEST_APPROVAL").ok).toBe(false);
  });

  it("enforces short-lived scoped execution tokens (FD)", () => {
    const token = {
      tokenId: "t1",
      agentId: "agent-1",
      scope: "lock-door",
      issuedAt: NOW,
      expiresAt: LATER,
      used: false,
    };
    expect(isScopedExecutionTokenValid(token, NOW)).toBe(true);
    expect(isScopedExecutionTokenValid({ ...token, used: true }, NOW)).toBe(false);
    expect(isScopedExecutionTokenValid({ ...token, expiresAt: "2025-01-01T00:00:00Z" }, NOW)).toBe(
      false,
    );
  });
});

describe("Failure classification and recovery (DU, DV, DW)", () => {
  it("maps every failure class to a recovery strategy", () => {
    expect(recoveryStrategyFor("NETWORK")).toContain("Retry");
    expect(recoveryStrategyFor("UNKNOWN")).toContain("never silent success");
  });

  it("marks unknown failures so they are never silently reported as success (DW)", () => {
    expect(isUnknownFailure("UNKNOWN")).toBe(true);
    expect(isUnknownFailure("TIMEOUT")).toBe(false);
  });
});
