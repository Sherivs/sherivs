/**
 * CoreGrid Scholar — Phase 17 Controlled Automation Engine unit tests
 * (automation-actions).
 *
 * Validates:
 * - Action contract (AB): validation/authorization failures never reach
 *   execution (FM.1).
 * - Verification (BT, BU): failed verification never becomes success
 *   (FM.12).
 * - Pre/postconditions (BR, BS).
 * - Stale state protection (BQ, FM.10): critical automation refuses stale
 *   state.
 * - Escalation (BV) and incidents (BW).
 * - Kill switches (BX): SYSTEM stop blocks everything.
 * - Execution modes (CB, CC, CD, CE): dry-run/simulation/shadow never
 *   create production side effects (FM.8/FM.9); progressive rollout (CF).
 */

import { describe, expect, it } from "vitest";
import { tenantId } from "@/lib/tenant-core";
import {
  executeActionContract,
  checkPreconditions,
  checkPostconditions,
  verifyActionExecution,
  isStateFreshForExecution,
  decideEscalation,
  isStopped,
  shouldExecuteAction,
  isRolloutAdvanceAllowed,
  type ActionExecutionRecord,
  type KillSwitchEvent,
} from "@/lib/automation-actions";

const TENANT_A = tenantId("tenant-a");
const NOW = "2026-01-01T00:00:00Z";

function record(overrides: Partial<ActionExecutionRecord> = {}): ActionExecutionRecord {
  return {
    actionId: "action-1",
    executionId: "exec-1",
    tenantId: TENANT_A,
    status: "EXECUTED",
    startedAt: NOW,
    finishedAt: NOW,
    result: "ok",
    error: null,
    evidence: null,
    verified: false,
    ...overrides,
  };
}

describe("Action contract (AB)", () => {
  it("executes when validation and authorization pass", () => {
    const execution = executeActionContract(
      {
        input: { door: "A" },
        validate: () => ({ ok: true as const }),
        authorize: () => ({ ok: true as const }),
        execute: () => ({ result: "locked", evidence: { door: "A", state: "locked" } }),
      },
      "exec-1",
      "lock-door",
      TENANT_A,
      NOW,
    );
    expect(execution.status).toBe("EXECUTED");
    expect(execution.result).toBe("locked");
  });

  it("never reaches execution on validation failure (FM.1)", () => {
    const execution = executeActionContract(
      {
        input: {},
        validate: () => ({ ok: false as const, error: "invalid input" }),
        authorize: () => ({ ok: true as const }),
        execute: () => ({ result: "should-not-run", evidence: null }),
      },
      "exec-1",
      "lock-door",
      TENANT_A,
      NOW,
    );
    expect(execution.status).toBe("NOT_EXECUTED");
    expect(execution.error).toBe("invalid input");
  });

  it("never reaches execution on authorization failure (FM.1)", () => {
    const execution = executeActionContract(
      {
        input: {},
        validate: () => ({ ok: true as const }),
        authorize: () => ({ ok: false as const, error: "unauthorized" }),
        execute: () => ({ result: "should-not-run", evidence: null }),
      },
      "exec-1",
      "lock-door",
      TENANT_A,
      NOW,
    );
    expect(execution.status).toBe("NOT_EXECUTED");
    expect(execution.error).toBe("unauthorized");
  });

  it("records a thrown execution error as FAILED", () => {
    const execution = executeActionContract(
      {
        input: {},
        validate: () => ({ ok: true as const }),
        authorize: () => ({ ok: true as const }),
        execute: () => {
          throw new Error("provider down");
        },
      },
      "exec-1",
      "lock-door",
      TENANT_A,
      NOW,
    );
    expect(execution.status).toBe("FAILED");
    expect(execution.error).toContain("provider down");
  });
});

describe("Verification (BT, BU)", () => {
  it("marks a verified action as VERIFIED", () => {
    const verified = verifyActionExecution({
      execution: record(),
      verified: true,
      detail: "twin confirms locked",
    });
    expect(verified.status).toBe("VERIFIED");
    expect(verified.verified).toBe(true);
  });

  it("never reports failed verification as success (FM.12)", () => {
    const failed = verifyActionExecution({
      execution: record(),
      verified: false,
      detail: "twin still open",
    });
    expect(failed.status).toBe("FAILED");
    expect(failed.verified).toBe(false);
  });
});

describe("Preconditions and postconditions (BR, BS)", () => {
  it("accepts passing preconditions", () => {
    expect(checkPreconditions([{ name: "fresh", passed: true, detail: "" }]).ok).toBe(true);
  });

  it("rejects a failing precondition", () => {
    const result = checkPreconditions([{ name: "fresh", passed: false, detail: "stale" }]);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("fresh");
  });

  it("accepts passing postconditions", () => {
    expect(checkPostconditions([{ name: "door_locked", passed: true, detail: "" }]).ok).toBe(true);
  });

  it("rejects a failing postcondition", () => {
    const result = checkPostconditions([{ name: "door_locked", passed: false, detail: "open" }]);
    expect(result.ok).toBe(false);
  });
});

describe("Stale state protection (BQ, FM.10)", () => {
  it("allows fresh state", () => {
    const result = isStateFreshForExecution({
      lastObservedAt: "2025-12-31T23:59:50Z",
      now: NOW,
      maxAgeMs: 60_000,
      critical: true,
      allowStale: false,
    });
    expect(result.ok).toBe(true);
  });

  it("refuses stale state for critical automation unless explicitly permitted", () => {
    const result = isStateFreshForExecution({
      lastObservedAt: "2025-01-01T00:00:00Z",
      now: NOW,
      maxAgeMs: 60_000,
      critical: true,
      allowStale: false,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("refuses stale state");
  });

  it("fails safe when no observation exists", () => {
    const result = isStateFreshForExecution({
      lastObservedAt: null,
      now: NOW,
      maxAgeMs: 60_000,
      critical: true,
      allowStale: false,
    });
    expect(result.ok).toBe(false);
  });
});

describe("Escalation (BV, BW)", () => {
  it("escalates after retries are exhausted", () => {
    const decision = decideEscalation(
      { target: "security_team", afterRetries: 3, createIncident: true },
      3,
      "EXTERNAL",
    );
    expect(decision.escalate).toBe(true);
    expect(decision.target).toBe("security_team");
    expect(decision.createIncident).toBe(true);
  });

  it("escalates authorization failures to an administrator", () => {
    const decision = decideEscalation(
      { target: "system_owner", afterRetries: 3, createIncident: false },
      0,
      "AUTHORIZATION",
    );
    expect(decision.escalate).toBe(true);
    expect(decision.target).toBe("institution_administrator");
  });
});

describe("Kill switches (BX, BY)", () => {
  function stop(overrides: Partial<KillSwitchEvent> = {}): KillSwitchEvent {
    return {
      stopId: "stop-1",
      level: "ACTION",
      scopeId: "lock-door",
      issuedBy: "admin-1",
      reason: "incident",
      issuedAt: NOW,
      active: true,
      ...overrides,
    };
  }

  it("blocks the scoped action when a matching stop is active", () => {
    const result = isStopped({ stops: [stop()], scope: { level: "ACTION", id: "lock-door" } });
    expect(result.stopped).toBe(true);
  });

  it("does not block a different action", () => {
    const result = isStopped({ stops: [stop()], scope: { level: "ACTION", id: "unlock-door" } });
    expect(result.stopped).toBe(false);
  });

  it("blocks everything while a SYSTEM stop is active", () => {
    const result = isStopped({
      stops: [stop({ level: "SYSTEM", scopeId: "*" })],
      scope: { level: "ACTION", id: "any" },
    });
    expect(result.stopped).toBe(true);
  });

  it("ignores released stops", () => {
    const result = isStopped({
      stops: [stop({ active: false })],
      scope: { level: "ACTION", id: "lock-door" },
    });
    expect(result.stopped).toBe(false);
  });
});

describe("Execution modes and rollout (CA, CB, CC, CD, CE, CF)", () => {
  it("dry-run/simulation/shadow never produce production side effects (FM.8/FM.9)", () => {
    expect(
      shouldExecuteAction({ mode: "dry_run", riskLevel: "R1", allowedInMode: true }).execute,
    ).toBe(false);
    expect(
      shouldExecuteAction({ mode: "simulation", riskLevel: "R1", allowedInMode: true }).execute,
    ).toBe(false);
    expect(
      shouldExecuteAction({ mode: "shadow", riskLevel: "R1", allowedInMode: true }).execute,
    ).toBe(false);
  });

  it("allows production execution", () => {
    expect(
      shouldExecuteAction({ mode: "production", riskLevel: "R2", allowedInMode: true }).execute,
    ).toBe(true);
  });

  it("blocks R4 actions in canary mode (CE)", () => {
    expect(
      shouldExecuteAction({ mode: "canary", riskLevel: "R4", allowedInMode: true }).execute,
    ).toBe(false);
  });

  it("only advances rollout stages in order (CF)", () => {
    expect(isRolloutAdvanceAllowed("SHADOW", "CANARY")).toBe(true);
    expect(isRolloutAdvanceAllowed("CANARY", "LIMITED_PRODUCTION")).toBe(true);
    expect(isRolloutAdvanceAllowed("DEV", "FULL_PRODUCTION")).toBe(false);
  });
});
