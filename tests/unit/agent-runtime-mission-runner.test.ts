/**
 * CoreGrid — ephemeral mission runner plan unit tests (V5.3 Part 14).
 *
 * Validates:
 * - Happy-path RunPlan production from existing mission vocabulary.
 * - Tool-not-in-allowlist denial and out-of-mission-scope denial.
 * - Cross-tenant mission rejection.
 * - Inactive / expired mission and revoked-actor rejection (fail closed).
 * - The runner plans only: no execution, every action requires evidence.
 */

import { describe, expect, it } from "vitest";
import { agentDefinitionId } from "@/lib/agent-core";
import type { ActorScope, MissionIntent } from "@/lib/control-plane/foundation-mission";
import type { AgentDefinition } from "@/lib/agent-runtime/ephemeral-lifecycle";
import {
  createRunPlan,
  evaluateToolAuthorization,
} from "@/lib/agent-runtime/mission-runner";

const NOW = "2026-01-01T00:00:00Z";
const TENANT_A = "tenant-a";

function makeDefinition(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: agentDefinitionId("agent-def:attendance_worker:v1"),
    tenantRef: TENANT_A,
    capabilities: ["attendance.read", "attendance.annotate"],
    allowedTools: ["read_attendance", "annotate_record"],
    permissions: [{ kind: "tool", toolId: "read_attendance" }],
    budget: { maxTokens: 10_000, maxFinancialCost: 5 },
    timeLimitMs: 60_000,
    actionLimit: 3,
    evidenceRequirements: ["execution_record", "evidence_record"],
    ...overrides,
  };
}

function makeMission(overrides: Partial<MissionIntent> = {}): MissionIntent {
  return {
    missionId: "MISSION-V1-009",
    version: "v1",
    tenantId: TENANT_A,
    purpose: "Annotate attendance anomalies for tenant-a",
    authorityRef: "authority:mission-board",
    contextRef: "cprim-1",
    ownerRef: "owner:mission-board",
    nonScope: ["delete_record"],
    authorizedActions: ["read_attendance", "annotate_record"],
    lifecycle: "authorized",
    expiresAt: "2026-01-02T00:00:00Z",
    ...overrides,
  };
}

function makeActor(overrides: Partial<ActorScope> = {}): ActorScope {
  return {
    actorId: "actor:ephemeral-worker-1",
    tenantId: TENANT_A,
    revoked: false,
    ...overrides,
  };
}

describe("happy-path RunPlan", () => {
  it("plans context assembly, authorized actions, evidence and termination", () => {
    const result = createRunPlan({
      definition: makeDefinition(),
      mission: makeMission(),
      actor: makeActor(),
      requestedTools: ["read_attendance", "annotate_record"],
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const plan = result.plan;
      expect(plan.missionId).toBe("MISSION-V1-009");
      expect(plan.tenantId).toBe(TENANT_A);
      expect(plan.contextAssembly).toEqual({
        missionId: "MISSION-V1-009",
        tenantId: TENANT_A,
        purpose: "Annotate attendance anomalies for tenant-a",
        authorityRef: "authority:mission-board",
        contextRef: "cprim-1",
        nonScope: ["delete_record"],
      });
      expect(plan.actions).toEqual([
        { kind: "authorized_tool_invocation", toolId: "read_attendance", requiresEvidence: true },
        { kind: "authorized_tool_invocation", toolId: "annotate_record", requiresEvidence: true },
      ]);
      expect(plan.deniedActions).toEqual([]);
      expect(plan.evidenceRequirements).toEqual(["execution_record", "evidence_record"]);
      expect(plan.terminationConditions).toEqual({
        maxActions: 3,
        timeLimitMs: 60_000,
        onLeaseExpiry: "terminate",
        onActionLimitReached: "terminate",
        onBudgetExhaustion: "terminate",
        onEvidenceMissing: "terminate",
      });
    }
  });

  it("splits requested tools into authorized and denied action plans", () => {
    const result = createRunPlan({
      definition: makeDefinition(),
      mission: makeMission(),
      actor: makeActor(),
      requestedTools: ["read_attendance", "wipe_database"],
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.actions.map((a) => a.toolId)).toEqual(["read_attendance"]);
      expect(result.plan.deniedActions).toEqual([
        { kind: "denied_tool_invocation", toolId: "wipe_database", reason: "tool_not_in_allowlist" },
      ]);
    }
  });

  it("produces a plan without executing anything (plans only)", () => {
    const result = createRunPlan({
      definition: makeDefinition(),
      mission: makeMission(),
      actor: makeActor(),
      requestedTools: ["read_attendance"],
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Every authorized action is a data plan, requires evidence, and the
      // plan carries no executor, handler or callback — execution remains
      // with the existing foundation loop.
      for (const action of result.plan.actions) {
        expect(action.kind).toBe("authorized_tool_invocation");
        expect(action.requiresEvidence).toBe(true);
        expect(Object.values(action).some((v) => typeof v === "function")).toBe(false);
      }
    }
  });
});

describe("tool authorization", () => {
  it("denies tools not in the definition allowlist", () => {
    const verdict = evaluateToolAuthorization(
      makeDefinition(),
      makeMission(),
      "delete_all_records",
    );
    expect(verdict).toEqual({ authorized: false, reason: "tool_not_in_allowlist" });
  });

  it("denies tools in the allowlist but outside mission scope", () => {
    const verdict = evaluateToolAuthorization(
      makeDefinition({ allowedTools: ["delete_record"] }),
      makeMission(),
      "delete_record",
    );
    expect(verdict).toEqual({ authorized: false, reason: "out_of_mission_scope" });
  });

  it("denies tools in the allowlist that the mission never authorized", () => {
    const verdict = evaluateToolAuthorization(
      makeDefinition(),
      makeMission({ authorizedActions: ["read_attendance"] }),
      "annotate_record",
    );
    expect(verdict).toEqual({ authorized: false, reason: "out_of_mission_scope" });
  });

  it("authorizes only the exact intersection of allowlist and mission scope", () => {
    const verdict = evaluateToolAuthorization(makeDefinition(), makeMission(), "read_attendance");
    expect(verdict).toEqual({ authorized: true });
  });
});

describe("cross-tenant mission rejection", () => {
  it("rejects a mission whose tenant differs from the definition tenantRef", () => {
    const result = createRunPlan({
      definition: makeDefinition(),
      mission: makeMission({ tenantId: "tenant-b" }),
      actor: makeActor({ tenantId: "tenant-b" }),
      requestedTools: ["read_attendance"],
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("cross_tenant");
    }
  });

  it("rejects an actor whose tenant differs from the mission tenant", () => {
    const result = createRunPlan({
      definition: makeDefinition(),
      mission: makeMission(),
      actor: makeActor({ tenantId: "tenant-b" }),
      requestedTools: ["read_attendance"],
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("cross_tenant");
    }
  });
});

describe("fail-closed mission and actor checks", () => {
  it("rejects proposed missions", () => {
    const result = createRunPlan({
      definition: makeDefinition(),
      mission: makeMission({ lifecycle: "proposed" }),
      actor: makeActor(),
      requestedTools: ["read_attendance"],
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("mission_not_active");
    }
  });

  it("rejects revoked missions", () => {
    const result = createRunPlan({
      definition: makeDefinition(),
      mission: makeMission({ lifecycle: "revoked" }),
      actor: makeActor(),
      requestedTools: ["read_attendance"],
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("mission_not_active");
    }
  });

  it("rejects closed missions", () => {
    const result = createRunPlan({
      definition: makeDefinition(),
      mission: makeMission({ lifecycle: "closed" }),
      actor: makeActor(),
      requestedTools: ["read_attendance"],
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("mission_not_active");
    }
  });

  it("rejects expired missions", () => {
    const result = createRunPlan({
      definition: makeDefinition(),
      mission: makeMission({ expiresAt: "2025-12-31T23:59:59Z" }),
      actor: makeActor(),
      requestedTools: ["read_attendance"],
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("mission_expired");
    }
  });

  it("rejects revoked actors", () => {
    const result = createRunPlan({
      definition: makeDefinition(),
      mission: makeMission(),
      actor: makeActor({ revoked: true }),
      requestedTools: ["read_attendance"],
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("actor_revoked");
    }
  });
});
