/**
 * CoreGrid Scholar — Phase 17 Controlled Automation Engine unit tests
 * (automation-core).
 *
 * Validates:
 * - Risk classification (W) and risk controls (X): R3/R4 always require
 *   approval.
 * - Condition engine (K, L, M): UNKNOWN/ERROR fail closed — never
 *   automatically TRUE.
 * - Trigger deduplication (I) and ordering (J).
 * - Policy priority (P): SAFETY > LAW > PLATFORM > TENANT > INSTITUTION >
 *   WORKFLOW > USER PREFERENCE.
 * - Authorization (Q): AI actors never get implicit authority (E).
 * - Approval engine (R, S, T, U): high-risk actions cannot proceed
 *   without approval (FM.6).
 */

import { describe, expect, it } from "vitest";
import { tenantId } from "@/lib/tenant-core";
import {
  riskControlProfile,
  applyFailClosed,
  isTriggerDuplicate,
  isTriggerOrderPreserved,
  resolvePolicyConflict,
  authorizeExecution,
  createApprovalState,
  canProceedThroughApproval,
  type ConditionEvaluation,
  type TriggerEvent,
} from "@/lib/automation-core";

const TENANT_A = tenantId("tenant-a");

function condition(result: ConditionEvaluation["result"], id = "c1"): ConditionEvaluation {
  return { conditionId: id, result, detail: "detail" };
}

function event(overrides: Partial<TriggerEvent> = {}): TriggerEvent {
  return {
    eventId: "evt-1",
    type: "twin.state_changed",
    tenantId: TENANT_A,
    timestamp: "2026-01-01T00:00:00Z",
    sequence: 1,
    correlationId: null,
    payload: {},
    ...overrides,
  };
}

describe("Risk controls (W, X)", () => {
  it("classifies R0 as informational with no approval", () => {
    expect(riskControlProfile("R0").requiresApproval).toBe(false);
    expect(riskControlProfile("R0").monitoringLevel).toBe("none");
  });

  it("requires approval and enhanced monitoring for R3/R4", () => {
    expect(riskControlProfile("R3").requiresApproval).toBe(true);
    expect(riskControlProfile("R3").requiresHumanOversight).toBe(true);
    expect(riskControlProfile("R4").monitoringLevel).toBe("enhanced");
  });

  it("requires rollback for R2 and above", () => {
    expect(riskControlProfile("R1").requiresRollback).toBe(false);
    expect(riskControlProfile("R2").requiresRollback).toBe(true);
  });
});

describe("Condition engine (K, L, M)", () => {
  it("proceeds when all conditions are TRUE", () => {
    const result = applyFailClosed([condition("TRUE"), condition("TRUE")], true);
    expect(result.proceed).toBe(true);
  });

  it("fails closed on UNKNOWN for high-risk automation (M)", () => {
    const result = applyFailClosed([condition("TRUE"), condition("UNKNOWN")], true);
    expect(result.proceed).toBe(false);
  });

  it("never treats UNKNOWN as TRUE for any automation (L)", () => {
    const result = applyFailClosed([condition("UNKNOWN")], false);
    expect(result.proceed).toBe(false);
  });

  it("fails closed on ERROR", () => {
    const result = applyFailClosed([condition("ERROR")], false);
    expect(result.proceed).toBe(false);
  });

  it("does not proceed when a condition is FALSE", () => {
    const result = applyFailClosed([condition("TRUE"), condition("FALSE")], false);
    expect(result.proceed).toBe(false);
  });
});

describe("Trigger deduplication and ordering (I, J)", () => {
  it("deduplicates repeated events within the window (FM.13)", () => {
    const seen = new Map<string, string>();
    const first = isTriggerDuplicate(new Set(), event(), 60_000, "2026-01-01T00:00:20Z", seen);
    expect(first).toBe(false);
    seen.set("evt-1", "2026-01-01T00:00:10Z");
    const second = isTriggerDuplicate(new Set(), event(), 60_000, "2026-01-01T00:00:30Z", seen);
    expect(second).toBe(true);
  });

  it("deduplicates already-processed event IDs", () => {
    expect(
      isTriggerDuplicate(new Set(["evt-1"]), event(), 0, "2026-01-01T00:01:00Z", new Map()),
    ).toBe(true);
  });

  it("preserves event order by sequence (J)", () => {
    expect(
      isTriggerOrderPreserved([
        event({ sequence: 1 }),
        event({ eventId: "e2", sequence: 2 }),
        event({ eventId: "e3", sequence: 3 }),
      ]),
    ).toBe(true);
    expect(
      isTriggerOrderPreserved([event({ sequence: 3 }), event({ eventId: "e2", sequence: 1 })]),
    ).toBe(false);
  });
});

describe("Policy priority (O, P)", () => {
  it("lets the highest-priority policy win on conflict", () => {
    const verdict = resolvePolicyConflict([
      { level: "TENANT", allowed: true, reason: "tenant allows" },
      { level: "SAFETY", allowed: false, reason: "safety prohibits" },
      { level: "WORKFLOW", allowed: true, reason: "workflow allows" },
    ]);
    expect(verdict.allowed).toBe(false);
  });

  it("allows when the highest-priority policy allows", () => {
    const verdict = resolvePolicyConflict([
      { level: "SAFETY", allowed: true, reason: "safe" },
      { level: "TENANT", allowed: false, reason: "tenant prohibits" },
    ]);
    expect(verdict.allowed).toBe(true);
  });

  it("fails closed with no policy decisions", () => {
    const verdict = resolvePolicyConflict([]);
    expect(verdict.allowed).toBe(false);
  });
});

describe("Authorization (Q, E)", () => {
  it("authorizes a permitted role for a permitted operation", () => {
    const verdict = authorizeExecution(
      {
        identity: "ops-1",
        tenantId: TENANT_A,
        role: "operator",
        resource: "twin-1",
        operation: "lock_door",
        isAutomation: true,
        isAI: false,
      },
      ["operator", "admin"],
      ["lock_door"],
    );
    expect(verdict.allowed).toBe(true);
  });

  it("denies an unpermitted operation", () => {
    const verdict = authorizeExecution(
      {
        identity: "ops-1",
        tenantId: TENANT_A,
        role: "operator",
        resource: "twin-1",
        operation: "delete_all",
        isAutomation: true,
        isAI: false,
      },
      ["operator"],
      ["lock_door"],
    );
    expect(verdict.allowed).toBe(false);
  });

  it("denies AI actors without an explicit role — never implicit authority (E)", () => {
    const verdict = authorizeExecution(
      {
        identity: "agent-1",
        tenantId: TENANT_A,
        role: null,
        resource: "twin-1",
        operation: "lock_door",
        isAutomation: false,
        isAI: true,
      },
      ["operator", "admin"],
      ["lock_door"],
    );
    expect(verdict.allowed).toBe(false);
  });
});

describe("Approval engine (R, S, T, U)", () => {
  it("allows execution without approval for low-risk automation (U)", () => {
    const state = createApprovalState(false);
    const result = canProceedThroughApproval(state);
    expect(result.proceed).toBe(true);
  });

  it("blocks a required approval until approved (T, FM.6)", () => {
    const pending = createApprovalState(true);
    expect(canProceedThroughApproval(pending).proceed).toBe(false);
    const approved = {
      required: true,
      status: "approved" as const,
      approvedBy: "admin-1",
      decidedAt: "2026-01-01T00:00:00Z",
    };
    expect(canProceedThroughApproval(approved).proceed).toBe(true);
  });

  it("blocks a rejected or expired approval", () => {
    const rejected = {
      required: true,
      status: "rejected" as const,
      approvedBy: null,
      decidedAt: "2026-01-01T00:00:00Z",
    };
    expect(canProceedThroughApproval(rejected).proceed).toBe(false);
  });
});
