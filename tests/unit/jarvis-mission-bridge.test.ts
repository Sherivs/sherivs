import { describe, expect, it } from "vitest";

import {
  draftMissionsFromProposals,
  MISSION_BRIDGE_AUTHORIZED_ACTIONS,
  type MissionBridgeInput,
} from "../../frontend/src/lib/jarvis/mission-bridge";
import type { ExecutiveMissionProposal } from "../../frontend/src/lib/jarvis/executive-loop";
import { evaluateMissionAdmissionGates, validateMissionCore } from "../../frontend/src/lib/mission/mission-contract";

const NOW = "2026-10-07T05:00:00.000Z";

let seq = 0;
function makeProposal(overrides: Partial<ExecutiveMissionProposal> = {}): ExecutiveMissionProposal {
  seq += 1;
  return {
    missionRef: `jarvis-api_failure-${seq}`,
    tenantRef: "tenant-a",
    objective: "restore stable operation after api failure",
    reason: "detected from evidence-backed observations: obs-1",
    priority: "medium",
    riskClass: "medium",
    status: "proposed",
    requiresApproval: false,
    staffing: {
      executorRoleIds: ["integration-engineer"],
      verifierRoleIds: ["security-verification-agent"],
      unstaffedCapabilities: [],
    },
    verificationPlan: "independent verifier validates the remediation",
    evidencePlan: "executor records artifacts; verifier records its verdict",
    rollbackPlan: "bounded recovery policy",
    acceptanceCriteria: ["no active api failure reports", "independent verification verdict recorded"],
    basisObservationIds: ["obs-1"],
    detectedAt: "2026-10-07T04:00:00.000Z",
    ...overrides,
  };
}

function runBridge(proposals: ExecutiveMissionProposal[], overrides: Partial<MissionBridgeInput> = {}) {
  return draftMissionsFromProposals({ now: NOW, proposals, ...overrides });
}

describe("mission bridge (executive plan → mission contract, DECISIONS #208)", () => {
  it("drafts a mission-contract-valid core from a staffable proposal", () => {
    const proposal = makeProposal();
    const result = runBridge([proposal]);
    expect(result.rejected).toEqual([]);
    expect(result.drafts).toHaveLength(1);
    const draft = result.drafts[0];
    expect(draft.sourceProposalRef).toBe(proposal.missionRef);
    expect(draft.mission.missionId).toBe(proposal.missionRef);
    expect(draft.mission.tenantId).toBe("tenant-a");
    expect(draft.mission.lifecycle).toBe("DEFINED");
    expect(validateMissionCore(draft.mission)).toBeNull();
    expect(evaluateMissionAdmissionGates(draft.mission)).toEqual({ ok: true });
  });

  it("carries the staffing into the draft and keeps executors as the actor set", () => {
    const proposal = makeProposal({
      staffing: { executorRoleIds: ["backend-engineer", "api-engineer"], verifierRoleIds: ["security-verification-agent"], unstaffedCapabilities: [] },
    });
    const draft = runBridge([proposal]).drafts[0];
    expect(draft.mission.actorRefs).toEqual(["api-engineer", "backend-engineer"]);
  });

  it("bounds the draft's authorization to the planning set — the bridge never expands authority", () => {
    const draft = runBridge([makeProposal()]).drafts[0];
    expect(draft.mission.authorizedActions).toEqual([...MISSION_BRIDGE_AUTHORIZED_ACTIONS]);
    expect(draft.mission.nonScope).toEqual(["execute", "deploy", "approve"]);
  });

  it("stamps the approval admission gate on high-risk proposals", () => {
    const draft = runBridge([makeProposal({ requiresApproval: true })]).drafts[0];
    const approvalGate = draft.mission.admissionGates.find((gate) => gate.gateId.endsWith("-gate-approval"));
    expect(approvalGate).toBeDefined();
    expect(approvalGate?.kind).toBe("security");
    expect(approvalGate?.reason).toMatch(/human approval/);
    expect(draft.requiresApproval).toBe(true);
  });

  it("records provenance: declared by jarvis, AI-generated, unverified, with observation context", () => {
    const draft = runBridge([makeProposal()]).drafts[0];
    expect(draft.mission.provenance.declaredBy).toBe("jarvis");
    expect(draft.mission.provenance.generatedByAi).toBe(true);
    expect(draft.mission.provenance.verified).toBe(false);
    expect(draft.mission.provenance.contextRef).toContain("obs-1");
    expect(draft.mission.provenance.authorityRef).toContain("DECISIONS.md");
  });

  it("rejects a proposal with no staffed executor — unstaffable escalates, never drafts", () => {
    const result = runBridge([
      makeProposal({ staffing: { executorRoleIds: [], verifierRoleIds: [], unstaffedCapabilities: ["provider_integration"] } }),
    ]);
    expect(result.drafts).toEqual([]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toMatch(/no staffed executor/);
  });

  it("rejects proposals that are not in proposed status", () => {
    const result = runBridge([makeProposal({ status: "executed" as ExecutiveMissionProposal["status"] })]);
    expect(result.drafts).toEqual([]);
    expect(result.rejected[0].reason).toMatch(/only "proposed"/);
  });

  it("rejects proposals without acceptance criteria or parseable detection instants", () => {
    const noCriteria = runBridge([makeProposal({ acceptanceCriteria: [] })]);
    expect(noCriteria.rejected[0].reason).toMatch(/acceptance criteria/);
    const badInstant = runBridge([makeProposal({ detectedAt: "not-a-time" })]);
    expect(badInstant.rejected[0].reason).toMatch(/parseable instant/);
  });

  it("rejects proposals missing tenant or objective (fail closed, never repaired)", () => {
    const noTenant = runBridge([makeProposal({ tenantRef: "" })]);
    expect(noTenant.rejected[0].reason).toMatch(/multi-tenancy/);
    const noObjective = runBridge([makeProposal({ objective: "  " })]);
    expect(noObjective.rejected[0].reason).toMatch(/objective/);
  });

  it("fails closed on an unparseable bridge clock", () => {
    expect(() => draftMissionsFromProposals({ now: "junk", proposals: [] })).toThrow(/parseable instant/);
  });

  it("partitions mixed inputs: valid drafts alongside honest rejections", () => {
    const good = makeProposal();
    const unstaffed = makeProposal({ staffing: { executorRoleIds: [], verifierRoleIds: [], unstaffedCapabilities: ["x"] } });
    const result = runBridge([good, unstaffed]);
    expect(result.drafts).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.drafts[0].sourceProposalRef).toBe(good.missionRef);
  });
});