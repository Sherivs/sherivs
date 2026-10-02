import { describe, expect, it } from "vitest";
import {
  captureVerificationRecord,
  checkVerificationIndependence,
  identityIsAi,
  identityIsProvablyHuman,
  resolveEffectiveIdentity,
  VerificationIndependenceError,
  type IdentityEquivalenceRegistry,
  type VerificationRecord,
} from "@/lib/verification";
import { planFoundationLoop } from "@/lib/control-plane/foundation-loop";

const now = "2026-10-02T00:00:00.000Z";

/**
 * Delegation model (AGENTS.md §5 / identity.ts DelegationRecord): worker
 * "agent:worker-7" is a delegated agent identity whose TRUE executor
 * principal is the operator "principal:operator-1"; a second human operator
 * holds a distinct principal.
 */
const REGISTRY: IdentityEquivalenceRegistry = [
  {
    identityRef: "identity:worker-7",
    effectiveIdentityRef: "principal:operator-1",
    identityKind: "ai_agent",
  },
  {
    identityRef: "identity:operator-1",
    effectiveIdentityRef: "principal:operator-1",
    identityKind: "human",
  },
  {
    identityRef: "identity:operator-2",
    effectiveIdentityRef: "principal:operator-2",
    identityKind: "human",
  },
  {
    identityRef: "ai:unregistered-verifier",
    effectiveIdentityRef: "principal:platform-ai",
    identityKind: "ai_agent",
  },
];

function recordInput(overrides: Partial<Parameters<typeof captureVerificationRecord>[0]> = {}) {
  return {
    verificationId: "verif-1",
    executionId: "exec-1",
    tenantId: "tenant-a",
    decision: "verified" as const,
    reason: "independent criteria and evidence",
    workCriticality: "minor" as const,
    verifiedAt: now,
    executorIdentityRef: "identity:worker-7",
    verifierIdentityRef: "identity:operator-2",
    evidenceIds: ["evidence-1"],
    identityRegistry: REGISTRY,
    ...overrides,
  };
}

describe("verification independence registry (equivalence classes)", () => {
  it("resolves a delegated identity to its true executor principal", () => {
    expect(resolveEffectiveIdentity(REGISTRY, "identity:worker-7")).toBe("principal:operator-1");
    expect(resolveEffectiveIdentity(REGISTRY, "identity:operator-2")).toBe("principal:operator-2");
  });

  it("treats an unregistered identity as its own principal", () => {
    expect(resolveEffectiveIdentity(REGISTRY, "identity:unknown")).toBe("identity:unknown");
  });

  it("detects AI identities by registry kind and by provenance markers", () => {
    expect(identityIsAi(REGISTRY, "identity:worker-7")).toBe(true);
    expect(identityIsAi(REGISTRY, "identity:operator-2")).toBe(false);
    // An unregistered identity cannot launder an AI marker into humanity.
    expect(identityIsAi([], "llm-verifier-1")).toBe(true);
  });

  it("requires a human-kind registry binding for provable humanity", () => {
    expect(identityIsProvablyHuman(REGISTRY, "identity:operator-1")).toBe(true);
    expect(identityIsProvablyHuman(REGISTRY, "identity:unknown")).toBe(false);
    expect(identityIsProvablyHuman(REGISTRY, "ai:operator-3")).toBe(false);
  });
});

describe("verification independence check (E-027 structural law)", () => {
  it("rejects self-verification by the identical identity ref", () => {
    const result = checkVerificationIndependence({
      verifierIdentityRef: "identity:worker-7",
      executorIdentityRef: "identity:worker-7",
      workCriticality: "minor",
      identityRegistry: REGISTRY,
    });
    expect(result.independent).toBe(false);
    expect(result.rejectionCode).toBe("self_verification_rejected");
    expect(result.evidence.verdict).toBe("rejected");
    expect(result.evidence.rejectionCode).toBe("self_verification_rejected");
  });

  it("rejects a verifier proven equivalent to the executor principal (delegated executor)", () => {
    const result = checkVerificationIndependence({
      verifierIdentityRef: "identity:operator-1",
      executorIdentityRef: "identity:worker-7",
      workCriticality: "minor",
      identityRegistry: REGISTRY,
    });
    expect(result.independent).toBe(false);
    expect(result.rejectionCode).toBe("equivalent_identity_rejected");
    expect(result.evidence.verifierEffectiveRef).toBe("principal:operator-1");
    expect(result.evidence.executorEffectiveRef).toBe("principal:operator-1");
  });

  it("rejects an AI verifier on critical work", () => {
    const result = checkVerificationIndependence({
      verifierIdentityRef: "ai:unregistered-verifier",
      executorIdentityRef: "identity:worker-7",
      workCriticality: "critical",
      identityRegistry: [],
    });
    expect(result.independent).toBe(false);
    expect(result.rejectionCode).toBe("ai_verifier_rejected_on_critical");
  });

  it("rejects a critical-work verifier that is not provably human", () => {
    const result = checkVerificationIndependence({
      verifierIdentityRef: "identity:unregistered",
      executorIdentityRef: "identity:worker-7",
      workCriticality: "critical",
      identityRegistry: [],
    });
    expect(result.independent).toBe(false);
    expect(result.rejectionCode).toBe("human_verifier_required");
  });

  it("accepts a structurally independent verifier", () => {
    const result = checkVerificationIndependence({
      verifierIdentityRef: "identity:operator-2",
      executorIdentityRef: "identity:worker-7",
      workCriticality: "critical",
      identityRegistry: REGISTRY,
    });
    expect(result.independent).toBe(true);
    expect(result.rejectionCode).toBeNull();
    expect(result.evidence.verdict).toBe("independent");
  });
});

describe("verification record capture (typed rejection at capture time)", () => {
  it("records an independent verification with full independence evidence", () => {
    const record: VerificationRecord = captureVerificationRecord(recordInput());
    expect(record.decision).toBe("verified");
    expect(record.independence.verifierIdentityRef).toBe("identity:operator-2");
    expect(record.independence.executorIdentityRef).toBe("identity:worker-7");
    expect(record.independence.verifierEffectiveRef).toBe("principal:operator-2");
    expect(record.independence.executorEffectiveRef).toBe("principal:operator-1");
    expect(record.independence.verdict).toBe("independent");
    expect(record.independence.rejectionCode).toBeNull();
    expect(record.evidenceIds).toEqual(["evidence-1"]);
  });

  it("throws a typed rejection for direct self-verification — nothing is recorded", () => {
    expect(() =>
      captureVerificationRecord(recordInput({ verifierIdentityRef: "identity:worker-7" })),
    ).toThrowError(VerificationIndependenceError);
    try {
      captureVerificationRecord(recordInput({ verifierIdentityRef: "identity:worker-7" }));
    } catch (error) {
      expect(error).toBeInstanceOf(VerificationIndependenceError);
      const typed = error as VerificationIndependenceError;
      expect(typed.code).toBe("self_verification_rejected");
      expect(typed.evidence.executorIdentityRef).toBe("identity:worker-7");
    }
  });

  it("throws a typed rejection for an equivalent principal (delegated executor)", () => {
    expect(() =>
      captureVerificationRecord(recordInput({ verifierIdentityRef: "identity:operator-1" })),
    ).toThrowError(VerificationIndependenceError);
    try {
      captureVerificationRecord(recordInput({ verifierIdentityRef: "identity:operator-1" }));
    } catch (error) {
      const typed = error as VerificationIndependenceError;
      expect(typed.code).toBe("equivalent_identity_rejected");
      expect(typed.evidence.verdict).toBe("rejected");
    }
  });

  it("throws a typed rejection when an AI verifier attempts critical work", () => {
    expect(() =>
      captureVerificationRecord(
        recordInput({
          verifierIdentityRef: "ai:unregistered-verifier",
          workCriticality: "critical",
        }),
      ),
    ).toThrowError(VerificationIndependenceError);
    try {
      captureVerificationRecord(
        recordInput({
          verifierIdentityRef: "ai:unregistered-verifier",
          workCriticality: "critical",
        }),
      );
    } catch (error) {
      const typed = error as VerificationIndependenceError;
      expect(typed.code).toBe("ai_verifier_rejected_on_critical");
    }
  });

  it("records an AI verifier on non-critical work with a distinct principal", () => {
    const record = captureVerificationRecord(
      recordInput({ verifierIdentityRef: "ai:unregistered-verifier" }),
    );
    expect(record.decision).toBe("verified");
    expect(record.independence.verdict).toBe("independent");
  });

  it("accepts a provably human verifier on critical work with a distinct principal", () => {
    const record = captureVerificationRecord(
      recordInput({ workCriticality: "critical", verifierIdentityRef: "identity:operator-2" }),
    );
    expect(record.workCriticality).toBe("critical");
    expect(record.independence.verdict).toBe("independent");
  });

  it("rejects malformed records at capture time", () => {
    expect(() => captureVerificationRecord(recordInput({ verificationId: "" }))).toThrowError(
      VerificationIndependenceError,
    );
    expect(() => captureVerificationRecord(recordInput({ verifiedAt: "not-a-time" }))).toThrowError(
      VerificationIndependenceError,
    );
  });
});

describe("foundation loop verification stage consumes independence (loop wiring)", () => {
  const loopRequest = {
    executionId: "exec-loop-1",
    idempotencyKey: "idem-loop-000001",
    missionId: "COREGRID-FOUNDATION-MISSION-001",
    version: "1",
    purpose: "bounded-reality-loop",
    authorityRef: "CONTROL-PLANE-06",
    contextRef: "context-1",
    ownerRef: "MISSIONS.md",
    action: "record-observation",
    requestedAt: now,
  };

  it("blocks stage closure when the loop actor verifies its own work", () => {
    const plan = planFoundationLoop({
      tenantId: "tenant-a",
      actorId: "identity:worker-7",
      now,
      reality: { id: "11111111-1111-4111-8111-111111111111", tenantId: "tenant-a" },
      requestedRealityRef: "11111111-1111-4111-8111-111111111111",
      request: loopRequest,
      verificationGovernance: {
        verifierIdentityRef: "identity:worker-7",
        workCriticality: "critical",
        identityRegistry: REGISTRY,
      },
    });
    expect(plan.admission.result.status).toBe("admitted");
    expect(plan.verification?.decision).toBe("failed");
    expect(plan.verification?.reason).toBe("verification_independence_failed");
    expect(plan.verificationIndependence?.independent).toBe(false);
    expect(plan.verificationIndependence?.rejectionCode).toBe("self_verification_rejected");
  });

  it("blocks stage closure when the verifier resolves to the executor principal", () => {
    const plan = planFoundationLoop({
      tenantId: "tenant-a",
      actorId: "identity:worker-7",
      now,
      reality: { id: "11111111-1111-4111-8111-111111111111", tenantId: "tenant-a" },
      requestedRealityRef: "11111111-1111-4111-8111-111111111111",
      request: loopRequest,
      verificationGovernance: {
        verifierIdentityRef: "identity:operator-1",
        workCriticality: "minor",
        identityRegistry: REGISTRY,
      },
    });
    expect(plan.verification?.decision).toBe("failed");
    expect(plan.verification?.reason).toBe("verification_independence_failed");
    expect(plan.verificationIndependence?.rejectionCode).toBe("equivalent_identity_rejected");
    expect(plan.verificationIndependence?.evidence.executorEffectiveRef).toBe(
      plan.verificationIndependence?.evidence.verifierEffectiveRef,
    );
  });

  it("closes the stage when the verifier is structurally independent", () => {
    const plan = planFoundationLoop({
      tenantId: "tenant-a",
      actorId: "identity:worker-7",
      now,
      reality: { id: "11111111-1111-4111-8111-111111111111", tenantId: "tenant-a" },
      requestedRealityRef: "11111111-1111-4111-8111-111111111111",
      request: loopRequest,
      verificationGovernance: {
        verifierIdentityRef: "identity:operator-2",
        workCriticality: "critical",
        identityRegistry: REGISTRY,
      },
    });
    expect(plan.verification?.decision).toBe("verified");
    expect(plan.verification?.reason).toBe("independent_criteria_and_evidence");
    expect(plan.verificationIndependence?.independent).toBe(true);
    expect(plan.verificationIndependence?.evidence.verdict).toBe("independent");
  });

  it("leaves stages without declared verifiers unchanged (additive)", () => {
    const plan = planFoundationLoop({
      tenantId: "tenant-a",
      actorId: "actor-1",
      now,
      reality: { id: "11111111-1111-4111-8111-111111111111", tenantId: "tenant-a" },
      requestedRealityRef: "11111111-1111-4111-8111-111111111111",
      request: loopRequest,
    });
    expect(plan.verification?.decision).toBe("verified");
    expect(plan.verificationIndependence).toBeNull();
  });
});
