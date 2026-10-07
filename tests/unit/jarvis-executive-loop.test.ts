/**
 * CoreGrid — Jarvis executive loop tests (V1 slice, DECISIONS.md #206).
 *
 * Enforces the executive planning laws: evidence-classed observation intake
 * (fail-closed on fabricated/unproven claims), fixed condition vocabulary,
 * deterministic severity, dynamic staffing from the V1 role catalog with
 * executor/verifier independence, honest escalation when no staffing exists,
 * and an executive briefing that can never assert an executed/verified claim
 * without an evidence ref (directive §§21/28/30/34/55).
 */
import { describe, expect, it } from "vitest";
import {
  EXECUTIVE_CLAIM_CLASSES,
  EXECUTIVE_CONDITION_CODES,
  runExecutiveLoop,
  validateExecutiveObservation,
  type ExecutiveObservation,
} from "../../frontend/src/lib/jarvis/executive-loop";
import { WORKFORCE_ROLE_CATALOG_VALIDATED } from "../../frontend/src/lib/workforce/role-catalog";
import type {
  MissionContractCore,
  MissionEvidenceRecord,
} from "../../frontend/src/lib/mission/mission-contract";
import type { MissionTransitionObservation } from "../../frontend/src/lib/workforce/performance-metrics";
import type { UsageRecord } from "../../frontend/src/lib/metering/usage-ledger";

const NOW = "2026-10-06T21:00:00.000Z";
const TENANT = "tenant-a";

function observation(overrides: Partial<ExecutiveObservation> = {}): ExecutiveObservation {
  return {
    id: "obs-1",
    tenantRef: TENANT,
    summary: "provider health probe reports degraded AI provider latency",
    claimClass: "observed",
    source: "provider_health",
    sourceRef: "frontend/src/lib/observability/provider-health.server.ts#probe",
    observedAt: NOW,
    conditionSignals: ["ai_rate_limit"],
    ...overrides,
  };
}

describe("executive observation intake (anti-hallucination law)", () => {
  it("accepts an evidence-classed observation", () => {
    expect(validateExecutiveObservation(observation())).toEqual({ ok: true });
  });

  it("rejects the unknown claim class — never asserted as fact", () => {
    const verdict = validateExecutiveObservation(observation({ claimClass: "unknown" }));
    expect(verdict).toMatchObject({ ok: false, denyCode: "state_fabrication" });
  });

  it("rejects executed/verified claims without an evidence ref", () => {
    for (const claimClass of ["executed", "verified"] as const) {
      const verdict = validateExecutiveObservation(observation({ claimClass, evidenceRef: undefined }));
      expect(verdict).toMatchObject({ ok: false, denyCode: "unverified_claim" });
    }
  });

  it("accepts executed/verified claims that carry an evidence ref", () => {
    const verdict = validateExecutiveObservation(
      observation({ claimClass: "executed", evidenceRef: "cg_evidence_record/123" }),
    );
    expect(verdict).toEqual({ ok: true });
  });

  it("rejects observations without tenant, source provenance, or a parseable instant", () => {
    expect(validateExecutiveObservation(observation({ tenantRef: "" }))).toMatchObject({
      ok: false,
      denyCode: "state_fabrication",
    });
    expect(validateExecutiveObservation(observation({ sourceRef: "" }))).toMatchObject({
      ok: false,
      denyCode: "state_fabrication",
    });
    expect(validateExecutiveObservation(observation({ observedAt: "not-a-date" }))).toMatchObject({
      ok: false,
      denyCode: "unparseable_instant",
    });
  });

  it("rejects unknown condition signals (fixed §30 vocabulary)", () => {
    const verdict = validateExecutiveObservation(
      observation({ conditionSignals: ["planetary_alignment_failure" as never] }),
    );
    expect(verdict).toMatchObject({ ok: false, denyCode: "unknown_condition" });
  });

  it("exposes the full vocabularies", () => {
    expect(EXECUTIVE_CLAIM_CLASSES).toContain("verified");
    expect(EXECUTIVE_CONDITION_CODES.length).toBeGreaterThanOrEqual(17);
  });
});

describe("executive loop — observe → detect → staff → propose → report", () => {
  it("runs the full cycle on a single warning condition", () => {
    const result = runExecutiveLoop({
      tenantRef: TENANT,
      objectives: ["keep mission execution reliable"],
      observations: [observation()],
      now: NOW,
    });
    expect(result.rejectedObservations).toHaveLength(0);
    expect(result.detectedConditions).toHaveLength(1);
    const condition = result.detectedConditions[0];
    expect(condition.condition).toBe("ai_rate_limit");
    expect(condition.severity).toBe("info");
    const proposal = result.missionProposals[0];
    expect(proposal.status).toBe("proposed");
    expect(proposal.requiresApproval).toBe(false);
    expect(proposal.staffing.executorRoleIds.length).toBeGreaterThan(0);
    expect(proposal.staffing.verifierRoleIds.length).toBeGreaterThan(0);
    // Verifier independence holds at the role level.
    for (const verifier of proposal.staffing.verifierRoleIds) {
      expect(proposal.staffing.executorRoleIds).not.toContain(verifier);
    }
    expect(proposal.verificationPlan.length).toBeGreaterThan(0);
    expect(proposal.evidencePlan.length).toBeGreaterThan(0);
    expect(proposal.rollbackPlan.length).toBeGreaterThan(0);
    expect(result.briefing.whatJarvisProposes[0].claimClass).toBe("proposed");
  });

  it("escalates critical signals to the human approval gate", () => {
    const result = runExecutiveLoop({
      tenantRef: TENANT,
      objectives: [],
      observations: [observation({ conditionSignals: ["security_vulnerability"], source: "log", id: "obs-sec" })],
      now: NOW,
    });
    const proposal = result.missionProposals[0];
    expect(proposal.requiresApproval).toBe(true);
    expect(proposal.riskClass).toBe("high");
    expect(result.escalations.some((escalation) => escalation.severity === "critical")).toBe(true);
    expect(result.briefing.whatRequiresHumanDecision.length).toBeGreaterThan(0);
  });

  it("warns when the same condition appears on two independent observations", () => {
    const result = runExecutiveLoop({
      tenantRef: TENANT,
      objectives: [],
      observations: [
        observation({ id: "obs-a" }),
        observation({ id: "obs-b", source: "metric", sourceRef: "metrics-registry#ai-latency" }),
      ],
      now: NOW,
    });
    expect(result.detectedConditions[0].severity).toBe("warning");
    expect(result.detectedConditions[0].basisObservationIds.slice().sort()).toEqual(["obs-a", "obs-b"]);
  });

  it("escalates honestly when no V1 role can staff a condition (never fabricates a team)", () => {
    // Restrict the catalog to roles without the matching capabilities.
    const result = runExecutiveLoop({
      tenantRef: TENANT,
      objectives: [],
      observations: [observation()],
      now: NOW,
      roles: WORKFORCE_ROLE_CATALOG_VALIDATED.filter((role) => role.roleId === "jarvis"),
    });
    expect(result.missionProposals).toHaveLength(0);
    expect(result.escalations[0]?.reason).toContain("unstaffed capabilities");
  });

  it("rejects fabricated observations but keeps processing the honest ones", () => {
    const result = runExecutiveLoop({
      tenantRef: TENANT,
      objectives: [],
      observations: [
        observation({ id: "good" }),
        observation({ id: "bad", claimClass: "executed", evidenceRef: undefined }),
        observation({ id: "bad2", claimClass: "unknown" }),
      ],
      now: NOW,
    });
    expect(result.acceptedObservations.map((entry) => entry.id)).toEqual(["good"]);
    expect(result.rejectedObservations.map((entry) => entry.id).sort()).toEqual(["bad", "bad2"]);
    expect(result.rejectedObservations.find((entry) => entry.id === "bad")?.denyCode).toBe("unverified_claim");
  });

  it("carries no proposal when there is nothing detected", () => {
    const result = runExecutiveLoop({
      tenantRef: TENANT,
      objectives: ["steady state"],
      observations: [observation({ conditionSignals: undefined })],
      now: NOW,
    });
    expect(result.detectedConditions).toHaveLength(0);
    expect(result.missionProposals).toHaveLength(0);
    expect(result.escalations).toHaveLength(0);
  });
});

describe("executive loop fail-closed construction", () => {
  it("refuses to run on an unparseable instant (clock discipline)", () => {
    expect(() =>
      runExecutiveLoop({ tenantRef: TENANT, objectives: [], observations: [], now: "yesterday-ish" }),
    ).toThrow(/parseable instant/);
  });

  it("refuses to run without a tenant ref (multi-tenancy law)", () => {
    expect(() =>
      runExecutiveLoop({ tenantRef: "", objectives: [], observations: [], now: NOW }),
    ).toThrow(/tenantRef/);
  });

  it("refuses empty objectives", () => {
    expect(() =>
      runExecutiveLoop({ tenantRef: TENANT, objectives: ["  "], observations: [], now: NOW }),
    ).toThrow(/objective/);
  });
});

describe("workforce performance lens inside the cycle (§40/§41, DECISIONS #208)", () => {
  const mission: MissionContractCore = {
    missionId: "m-1",
    schemaVersion: "1.0",
    tenantId: TENANT,
    objective: "deliver the declared outcome",
    nonScope: [],
    ownerRef: "owner-1",
    actorRefs: ["backend-engineer"],
    authorizedActions: ["observe"],
    tasks: [
      { taskId: "t-1", title: "task", authorizedActions: ["observe"], requiredEvidenceKinds: ["test_report"] },
    ],
    admissionGates: [{ gateId: "g-1", kind: "definition", reason: "gate" }],
    successCriteria: ["verified"],
    requiredEvidenceKinds: ["test_report"],
    lifecycle: "SUCCEEDED",
    expiresAt: null,
    provenance: {
      declaredBy: "jarvis",
      declaredAt: "2026-10-06T00:00:00.000Z",
      authorityRef: "DECISIONS.md#208",
      contextRef: null,
      sourceRef: null,
      generatedByAi: true,
      verified: false,
    },
  };
  const transition: MissionTransitionObservation = {
    missionId: "m-1",
    actorId: "backend-engineer",
    from: "RUNNING",
    to: "SUCCEEDED",
    at: "2026-10-06T02:00:00.000Z",
  };
  const evidence: MissionEvidenceRecord = {
    evidenceId: "e-1",
    missionId: "m-1",
    taskId: null,
    evidenceKind: "test_report",
    producer: "security-verification-agent",
    actorId: "backend-engineer",
    tenantId: TENANT,
    recordedAt: "2026-10-06T01:00:00.000Z",
    provenance: "unit fixture",
    integrity: "sha256:fixture",
    lifecycle: "active",
  };

  it("computes the performance report inside the cycle and joins metrics into the briefing", () => {
    const result = runExecutiveLoop({
      tenantRef: TENANT,
      objectives: ["keep the platform operating"],
      observations: [],
      now: NOW,
      workforce: { missions: [mission], evidence: [evidence], transitions: [transition] },
    });
    expect(result.workforcePerformance).toBeDefined();
    expect(result.workforcePerformance?.metrics.missionCompletionRate.value).toBe(1);
    const metricItems = result.briefing.whatHappened.filter((item) => item.summary.startsWith("workforce metric"));
    expect(metricItems.length).toBeGreaterThanOrEqual(3);
    for (const item of metricItems) {
      expect(["observed", "inferred"]).toContain(item.claimClass);
      expect(item.evidenceRef).toMatch(/mission substrate \+ metering records/);
    }
  });

  it("turns supplied metering records into observed token/cost metrics in the briefing", () => {
    const usage: UsageRecord = {
      tenantRef: TENANT,
      actorRef: "backend-engineer",
      agentRef: "sdk_engineer",
      missionRef: "m-1",
      model: "coregrid-test-model",
      provider: "ai-gateway",
      purpose: "classification",
      tokensIn: 220,
      tokensOut: 90,
      durationMs: 800,
      estimatedCostUsd: 0.0007,
      at: "2026-10-06T02:00:00.000Z",
    };
    const result = runExecutiveLoop({
      tenantRef: TENANT,
      objectives: ["keep the platform operating"],
      observations: [],
      now: NOW,
      workforce: { missions: [mission], evidence: [evidence], transitions: [transition], usage: [usage] },
    });
    const tokenUsage = result.workforcePerformance?.metrics.tokenUsage;
    const computeCost = result.workforcePerformance?.metrics.computeCost;
    expect(tokenUsage?.status).toBe("computed");
    expect(tokenUsage?.value).toBe(310);
    expect(computeCost?.status).toBe("computed");
    expect(computeCost?.value).toBeCloseTo(0.0007, 9);
    const metricSummaries = result.briefing.whatHappened.map((item) => item.summary);
    expect(metricSummaries.some((s) => s.startsWith("workforce metric tokenUsage"))).toBe(true);
    expect(metricSummaries.some((s) => s.startsWith("workforce metric computeCost"))).toBe(true);
  });

  it("keeps token/cost unobservable in the cycle when no usage records are supplied", () => {
    const result = runExecutiveLoop({
      tenantRef: TENANT,
      objectives: [],
      observations: [],
      now: NOW,
      workforce: { missions: [mission], evidence: [evidence], transitions: [transition] },
    });
    expect(result.workforcePerformance?.metrics.tokenUsage.status).toBe("not_observable");
    expect(result.workforcePerformance?.metrics.computeCost.status).toBe("not_observable");
    const metricSummaries = result.briefing.whatHappened.map((item) => item.summary);
    expect(metricSummaries.some((s) => s.startsWith("workforce metric tokenUsage"))).toBe(false);
    expect(metricSummaries.some((s) => s.startsWith("workforce metric computeCost"))).toBe(false);
  });

  it("stays observation-only when no workforce inputs are supplied", () => {
    const result = runExecutiveLoop({ tenantRef: TENANT, objectives: [], observations: [], now: NOW });
    expect(result.workforcePerformance).toBeUndefined();
    expect(result.briefing.whatHappened.some((item) => item.summary.startsWith("workforce metric"))).toBe(false);
  });

  it("fails closed when workforce records violate the mission contract", () => {
    const broken: MissionContractCore = { ...mission, objective: "" };
    expect(() =>
      runExecutiveLoop({
        tenantRef: TENANT,
        objectives: [],
        observations: [],
        now: NOW,
        workforce: { missions: [broken], evidence: [], transitions: [] },
      }),
    ).toThrow(/objective/);
  });
});