/**
 * CoreGrid — Jarvis V1 contract tests (V5.3 Part 15 boundary, fail-closed).
 *
 * Security negatives are mandatory (Constitution §31): every Part 15 MUST-NOT
 * must be an enforced deny code, unknown capability codes must fail closed,
 * and every capability on the MAY-list must have an exercised allow path.
 */
import { describe, expect, it } from "vitest";
import {
  evaluateJarvisAction,
  isJarvisCapability,
  JarvisCapability,
  JARVIS_ACTOR_REF,
  JARVIS_PROHIBITION_CODES,
  type JarvisAction,
  type JarvisEvaluation,
  type JarvisProhibitionCode,
} from "../../frontend/src/lib/jarvis/jarvis-contract";

const ALL_CAPABILITIES = Object.values(JarvisCapability);
const PART15_MUST_NOTS: readonly JarvisProhibitionCode[] = [
  "authorization_bypass",
  "secret_access",
  "governance_mutation",
  "self_authority_grant",
  "approval_override",
  "out_of_policy_critical_action",
  "state_fabrication",
  "unverified_claim",
];

const grantedContext = {
  tenantRef: "tenant-alpha",
  grantedCapabilities: ALL_CAPABILITIES,
  humanApprovalGranted: true,
};

function actionFor(capability: JarvisCapability): JarvisAction {
  const base = {
    tenantRef: "tenant-alpha",
    actorRef: JARVIS_ACTOR_REF,
    justification: "governed orchestration step",
    requiredApproval: false,
  };
  switch (capability) {
    case JarvisCapability.ObservePlatformState:
      return { ...base, capability, payload: { scope: "platform" } };
    case JarvisCapability.InspectMissionState:
      return { ...base, capability, payload: { missionRef: "mission-001" } };
    case JarvisCapability.CoordinateWorkers:
      return { ...base, capability, payload: { workerRefs: ["worker-1"], directive: "proceed" } };
    case JarvisCapability.InitiateGovernedMission:
      return {
        ...base,
        capability,
        payload: { missionRef: "mission-002", blueprintSummary: "blueprint v1" },
      };
    case JarvisCapability.RequestApproval:
      return { ...base, capability, payload: { proposalSummary: "proposal v1" } };
    case JarvisCapability.EscalateIncident:
      return {
        ...base,
        capability,
        payload: { incidentRef: "incident-001", severity: "warning" as const },
      };
    case JarvisCapability.SummarizeEvents:
      return { ...base, capability, payload: { eventRefs: ["event-001"] } };
    case JarvisCapability.RecommendAction:
      return { ...base, capability, payload: { recommendationSummary: "recommendation v1" } };
  }
}

function prohibitionOf(result: JarvisEvaluation): JarvisProhibitionCode | null {
  return result.decision === "deny" ? result.prohibition : null;
}

describe("JarvisCapability (Part 15 MAY-list)", () => {
  it("enumerates exactly the eight governed capabilities", () => {
    expect(ALL_CAPABILITIES).toEqual([
      "observe_platform_state",
      "inspect_mission_state",
      "coordinate_workers",
      "initiate_governed_mission",
      "request_approval",
      "escalate_incident",
      "summarize_events",
      "recommend_action",
    ]);
  });

  it("accepts every declared code and rejects undeclared ones", () => {
    for (const capability of ALL_CAPABILITIES) {
      expect(isJarvisCapability(capability)).toBe(true);
    }
    expect(isJarvisCapability("secret_access")).toBe(false);
    expect(isJarvisCapability("deploy_production")).toBe(false);
    expect(isJarvisCapability("")).toBe(false);
  });
});

describe("evaluateJarvisAction — allow path (every capability exercised)", () => {
  it("allows each declared capability under a fully granted, approved context", () => {
    for (const capability of ALL_CAPABILITIES) {
      const result = evaluateJarvisAction(actionFor(capability), grantedContext);
      expect(result.decision).toBe("allow");
      if (result.decision === "allow") {
        expect(result.capability).toBe(capability);
      }
    }
  });

  it("allows request_approval to request approval it does not yet have", () => {
    const action = actionFor(JarvisCapability.RequestApproval);
    const result = evaluateJarvisAction(action, {
      tenantRef: "tenant-alpha",
      grantedCapabilities: ALL_CAPABILITIES,
      humanApprovalGranted: false,
    });
    expect(result.decision).toBe("allow");
  });

  it("allows a non-required-approval action without any human approval on record", () => {
    const result = evaluateJarvisAction(actionFor(JarvisCapability.ObservePlatformState), {
      tenantRef: "tenant-alpha",
      grantedCapabilities: ["observe_platform_state"],
    });
    expect(result.decision).toBe("allow");
  });
});

describe("evaluateJarvisAction — every Part 15 MUST-NOT is an enforced deny", () => {
  it("declares the full prohibition index", () => {
    expect(JARVIS_PROHIBITION_CODES).toEqual([...PART15_MUST_NOTS, "unknown_capability"]);
  });

  it("denies authorization_bypass on actor impersonation", () => {
    const action = {
      ...actionFor(JarvisCapability.ObservePlatformState),
      actorRef: "jarvis-impersonator",
    } as unknown as JarvisAction;
    expect(prohibitionOf(evaluateJarvisAction(action, grantedContext))).toBe(
      "authorization_bypass",
    );
  });

  it("denies authorization_bypass on tenant mismatch", () => {
    const action = {
      ...actionFor(JarvisCapability.InspectMissionState),
      tenantRef: "tenant-beta",
    } as JarvisAction;
    expect(prohibitionOf(evaluateJarvisAction(action, grantedContext))).toBe(
      "authorization_bypass",
    );
  });

  it("denies authorization_bypass when policy has not granted the capability", () => {
    const result = evaluateJarvisAction(actionFor(JarvisCapability.CoordinateWorkers), {
      tenantRef: "tenant-alpha",
      grantedCapabilities: ["observe_platform_state"],
      humanApprovalGranted: true,
    });
    expect(prohibitionOf(result)).toBe("authorization_bypass");
  });

  it("denies secret_access", () => {
    const action = {
      ...actionFor(JarvisCapability.ObservePlatformState),
      requestsSecretMaterial: true,
    } as JarvisAction;
    expect(prohibitionOf(evaluateJarvisAction(action, grantedContext))).toBe("secret_access");
  });

  it("denies governance_mutation", () => {
    const action = {
      ...actionFor(JarvisCapability.CoordinateWorkers),
      mutatesGovernance: true,
    } as JarvisAction;
    expect(prohibitionOf(evaluateJarvisAction(action, grantedContext))).toBe(
      "governance_mutation",
    );
  });

  it("denies self_authority_grant", () => {
    const action = {
      ...actionFor(JarvisCapability.InitiateGovernedMission),
      expandsOwnAuthority: true,
    } as JarvisAction;
    expect(prohibitionOf(evaluateJarvisAction(action, grantedContext))).toBe(
      "self_authority_grant",
    );
  });

  it("denies approval_override when a required-approval action lacks a human approval", () => {
    const action = {
      ...actionFor(JarvisCapability.InitiateGovernedMission),
      requiredApproval: true,
    };
    const result = evaluateJarvisAction(action, {
      tenantRef: "tenant-alpha",
      grantedCapabilities: ALL_CAPABILITIES,
      humanApprovalGranted: false,
    });
    expect(prohibitionOf(result)).toBe("approval_override");
  });

  it("denies approval_override on an explicit bypass of the human approval gate", () => {
    const action = {
      ...actionFor(JarvisCapability.InitiateGovernedMission),
      requiredApproval: true,
      bypassesHumanApprovalGate: true,
    } as JarvisAction;
    expect(prohibitionOf(evaluateJarvisAction(action, grantedContext))).toBe("approval_override");
  });

  it("denies out_of_policy_critical_action", () => {
    const action = {
      ...actionFor(JarvisCapability.RecommendAction),
      executesCriticalOutsidePolicy: true,
    } as JarvisAction;
    expect(prohibitionOf(evaluateJarvisAction(action, grantedContext))).toBe(
      "out_of_policy_critical_action",
    );
  });

  it("denies state_fabrication", () => {
    const action = {
      ...actionFor(JarvisCapability.SummarizeEvents),
      fabricatesSystemState: true,
    } as JarvisAction;
    expect(prohibitionOf(evaluateJarvisAction(action, grantedContext))).toBe("state_fabrication");
  });

  it("denies unverified_claim", () => {
    const action = {
      ...actionFor(JarvisCapability.SummarizeEvents),
      claimsVerificationWithoutEvidence: true,
    } as JarvisAction;
    expect(prohibitionOf(evaluateJarvisAction(action, grantedContext))).toBe("unverified_claim");
  });

  it("fails closed on unknown capability codes — including disguised ones", () => {
    const disguised = {
      ...actionFor(JarvisCapability.ObservePlatformState),
      capability: "secret_access",
    } as unknown as JarvisAction;
    const invented = {
      ...actionFor(JarvisCapability.ObservePlatformState),
      capability: "rewrite_architecture",
    } as unknown as JarvisAction;
    expect(prohibitionOf(evaluateJarvisAction(disguised, grantedContext))).toBe(
      "unknown_capability",
    );
    expect(prohibitionOf(evaluateJarvisAction(invented, grantedContext))).toBe(
      "unknown_capability",
    );
  });
});
