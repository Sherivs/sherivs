import { describe, expect, it } from "vitest";
import {
  admitExecution,
  assessConformance,
  decideVerification,
  rollbackExecution,
  runFoundationLoop,
  STATUS_SEMANTICS,
  type ActorScope,
  type EvidenceRecord,
  type ExecutionRequest,
  type MissionIntent,
} from "@/lib/control-plane/foundation-mission";

const now = "2026-09-29T12:00:00.000Z";

const mission: MissionIntent = {
  missionId: "COREGRID-FOUNDATION-MISSION-001",
  version: "1",
  tenantId: "tenant-a",
  purpose: "bounded-reality-loop",
  authorityRef: "CONTROL-PLANE-06",
  contextRef: "context-1",
  ownerRef: "MISSIONS.md",
  nonScope: ["deploy", "persist"],
  authorizedActions: ["record-observation"],
  lifecycle: "authorized",
  expiresAt: "2026-10-01T00:00:00.000Z",
};

const actor: ActorScope = { actorId: "actor-1", tenantId: "tenant-a", revoked: false };

const request: ExecutionRequest = {
  executionId: "exec-1",
  idempotencyKey: "idem-1",
  missionId: mission.missionId,
  tenantId: "tenant-a",
  actorId: "actor-1",
  action: "record-observation",
  realityRef: "entity-1",
  requestedAt: now,
};

const evidence: EvidenceRecord = {
  evidenceId: "ev-1",
  producer: "foundation-slice",
  actorId: "actor-1",
  tenantId: "tenant-a",
  observedAt: now,
  recordedAt: now,
  provenance: "controlled-fixture",
  integrity: "hash-1",
  lifecycle: "active",
  lineage: [],
};

describe("foundation mission 001 — admission", () => {
  it("admits an authorized in-scope request without an external effect beyond recorded intent", () => {
    const record = admitExecution(mission, actor, request, now);
    expect(record.result.status).toBe("admitted");
    expect(record.externalEffect).toBe("recorded_intent");
    expect(record.attempt.attemptId).toBe("exec-1:1");
  });

  it.each([
    [
      "missing authority",
      { ...mission, authorityRef: " ", lifecycle: "proposed" as const },
      actor,
      request,
      "missing_authority",
    ],
    ["revoked mission", { ...mission, lifecycle: "revoked" as const }, actor, request, "revoked"],
    ["revoked actor", mission, { ...actor, revoked: true }, request, "revoked"],
    ["cross tenant", mission, { ...actor, tenantId: "tenant-b" }, request, "cross_tenant"],
    ["expired", { ...mission, expiresAt: "2026-09-01T00:00:00.000Z" }, actor, request, "expired"],
    ["out of scope", mission, actor, { ...request, action: "deploy" }, "out_of_scope"],
    ["missing reality", mission, actor, { ...request, realityRef: " " }, "missing_reality"],
  ] as const)("fails closed on %s", (_label, nextMission, nextActor, nextRequest, reason) => {
    const record = admitExecution(nextMission, nextActor, nextRequest, now);
    expect(record.result).toEqual({ status: "denied", reason });
    expect(record.externalEffect).toBe("none");
  });

  it("replays an idempotent key without a second external effect and keeps history", () => {
    const first = admitExecution(mission, actor, request, now);
    const replay = admitExecution(mission, actor, { ...request, executionId: "exec-2" }, now, [
      first,
    ]);
    expect(replay.recordId).toBe(first.recordId);
    expect(replay.externalEffect).toBe("none");
    expect(replay.history).toHaveLength(2);
  });

  it("preserves the prior result when rolling back", () => {
    const admitted = admitExecution(mission, actor, request, now);
    const rolled = rollbackExecution(admitted, "2026-09-29T12:05:00.000Z");
    expect(rolled.result.status).toBe("rolled_back");
    expect(rolled.history[0]?.status).toBe("admitted");
    expect(rolled.externalEffect).toBe("compensation_required");
  });
});

describe("foundation mission 001 — verification and conformance", () => {
  it("does not treat execution success as verification", () => {
    const decision = decideVerification({
      verificationId: "ver-1",
      executionId: "exec-1",
      executionSucceeded: true,
      evidence: [],
      criteriaMet: true,
    });
    expect(decision.decision).toBe("inconclusive");
    expect(decision.reason).toBe("execution_success_is_not_verification");
  });

  it("fails closed when evidence is revoked", () => {
    const decision = decideVerification({
      verificationId: "ver-1",
      executionId: "exec-1",
      executionSucceeded: true,
      evidence: [{ ...evidence, lifecycle: "revoked" }],
      criteriaMet: true,
    });
    expect(decision.decision).toBe("failed");
  });

  it("verifies only when independent criteria and usable evidence agree", () => {
    const decision = decideVerification({
      verificationId: "ver-1",
      executionId: "exec-1",
      executionSucceeded: false,
      evidence: [evidence],
      criteriaMet: true,
    });
    expect(decision.decision).toBe("verified");
  });

  it("keeps conformance independent of a passing verification when the contract differs", () => {
    const verification = decideVerification({
      verificationId: "ver-1",
      executionId: "exec-1",
      executionSucceeded: true,
      evidence: [evidence],
      criteriaMet: true,
    });
    const mismatch = assessConformance({
      assessmentId: "conf-1",
      verification,
      declaredContractId: "foundation-v1",
      observedContractId: "foundation-v1",
      declaredVersion: "1",
      observedVersion: "2",
    });
    expect(mismatch.decision).toBe("nonconformant");
  });

  it("runs the bounded loop through conformant only when evidence and contract match", () => {
    const loop = runFoundationLoop({
      mission,
      actor,
      request,
      now,
      evidence: [evidence],
      criteriaMet: true,
      declaredContractId: "foundation-v1",
      observedContractId: "foundation-v1",
      declaredVersion: "1",
      observedVersion: "1",
    });
    expect(loop.admission.result.status).toBe("admitted");
    expect(loop.verification?.decision).toBe("verified");
    expect(loop.conformance?.decision).toBe("conformant");
    expect(STATUS_SEMANTICS.OPERATIONAL).toContain("runtime evidence");
  });
});
