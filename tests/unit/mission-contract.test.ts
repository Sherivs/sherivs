/**
 * CoreGrid Mission object contract tests (J-025 / V1CAP-046, MISSION-R-50).
 *
 * Validates the pure contract in frontend/src/lib/mission/mission-contract.ts:
 * - a mission missing ANY required element is rejected (fail closed);
 * - full lifecycle transitions through the ONE canonical 15-state
 *   vocabulary (RULING-5 / V1CAP-052), legal and illegal;
 * - admission gates, bounded expiry, EVIDENCE before SUCCESS;
 * - terminal-state immutability;
 * - canonical kernel envelope presence and conformance on every persistent
 *   mission (V1CAP-002, no anonymous persistent mission);
 * - lifecycle composition mapping onto the foundation loop vocabulary.
 */

import { describe, expect, it } from "vitest";
import {
  MISSION_CONTRACT_SCHEMA_VERSION,
  MISSION_LIFECYCLE_MAPPING_TO_FOUNDATION,
  MISSION_LIFECYCLE_STATES,
  evaluateMissionAdmissionGates,
  isMissionTransitionAllowed,
  missionEvidenceCovers,
  missionEvidenceIsUsable,
  stampMissionContract,
  transitionMission,
  validateMissionContract,
  type MissionContract,
  type MissionContractCore,
  type MissionEvidenceRecord,
} from "@/lib/mission/mission-contract";
import { MISSION_LIFECYCLES as FOUNDATION_LIFECYCLE } from "@/lib/control-plane/foundation-mission";
import type { KernelObjectEnvelopeInput } from "@/lib/kernel/reality";
import { KERNEL_ENVELOPE_COLUMNS } from "@/lib/kernel/reality";

const TENANT_A = "tenant-a";
const NOW = "2026-10-01T12:00:00.000Z";

function envelopeInput(): KernelObjectEnvelopeInput {
  return {
    objectType: "mission_intent",
    schemaVersion: "1.0",
    status: "active",
    createdBy: "mission-owner-a",
    updatedBy: "mission-owner-a",
    provenance: { source: "mission:contract-suite", originTenantId: TENANT_A },
    policyContext: { ruling: "RULING-5" },
    traceId: "trace-mission-1",
    correlationId: "corr-mission-1",
    declaredOrigin: "suite-root",
  };
}

const validCore: MissionContractCore = {
  missionId: "mission-1",
  schemaVersion: MISSION_CONTRACT_SCHEMA_VERSION,
  tenantId: TENANT_A,
  objective: "Close the governed Mission->Delegation spine for V1",
  nonScope: ["worker.runtime.provision"],
  ownerRef: "mission-owner-a",
  actorRefs: ["mission-owner-a", "engineer-agent-1"],
  authorizedActions: ["mission.author", "mission.delegate", "mission.verify"],
  tasks: [
    {
      taskId: "task-1",
      title: "Author the mission contract",
      authorizedActions: ["mission.author"],
      requiredEvidenceKinds: ["contract_authored"],
    },
    {
      taskId: "task-2",
      title: "Prove the delegation bounds",
      authorizedActions: ["mission.delegate", "mission.verify"],
      requiredEvidenceKinds: ["suite_pass"],
    },
  ],
  admissionGates: [
    { gateId: "gate-def", kind: "definition", reason: "objective and tasks declared" },
    { gateId: "gate-sec", kind: "security", reason: "scope and non-scope disjoint" },
    { gateId: "gate-ver", kind: "verification", reason: "evidence kinds declared" },
    { gateId: "gate-clo", kind: "closure", reason: "success criteria declared" },
  ],
  successCriteria: ["both contracts authored", "both suites pass"],
  requiredEvidenceKinds: ["contract_authored", "suite_pass"],
  lifecycle: "DEFINED",
  expiresAt: "2027-01-01T00:00:00.000Z",
  provenance: {
    declaredBy: "mission-owner-a",
    declaredAt: "2026-09-30T00:00:00.000Z",
    authorityRef: "MISSION-R-50 (J-025, COND-001 ratified)",
    contextRef: "COREGRID_V1_MISSION_GRAPH.json",
    sourceRef: null,
    generatedByAi: true,
    verified: true,
  },
};

function stamped(): MissionContract {
  return stampMissionContract({ ...validCore, envelope: envelopeInput() });
}

function evidence(kind: string, overrides: Partial<MissionEvidenceRecord> = {}): MissionEvidenceRecord {
  return {
    evidenceId: `ev-${kind}`,
    missionId: "mission-1",
    taskId: null,
    evidenceKind: kind,
    producer: "contract-suite",
    actorId: "engineer-agent-1",
    tenantId: TENANT_A,
    recordedAt: NOW,
    provenance: "suite transcript",
    integrity: "sha256-verified",
    lifecycle: "active",
    ...overrides,
  };
}

describe("mission contract validation (fail closed)", () => {
  it("accepts a fully-declared mission and stamps the envelope", () => {
    const mission = stamped();
    expect(validateMissionContract(mission)).toEqual({ ok: true });
    expect(mission.lifecycle).toBe("DEFINED");
  });

  it("rejects a mission missing each required element", () => {
    const cases: readonly [string, MissionContractCore][] = [
      ["no objective", { ...validCore, objective: "" }],
      ["no tenant scope", { ...validCore, tenantId: "" }],
      ["no owner", { ...validCore, ownerRef: "" }],
      ["no actors", { ...validCore, actorRefs: [] }],
      ["no authorized actions", { ...validCore, authorizedActions: [] }],
      ["no tasks", { ...validCore, tasks: [] }],
      ["no success criteria", { ...validCore, successCriteria: [] }],
      ["no required evidence kinds", { ...validCore, requiredEvidenceKinds: [] }],
      ["no admission gates", { ...validCore, admissionGates: [] }],
      ["no authorityRef", { ...validCore, provenance: { ...validCore.provenance, authorityRef: "" } }],
      ["unknown lifecycle", { ...validCore, lifecycle: "DRAFTING" as unknown as MissionContract["lifecycle"] }],
      [
        "action both authorized and non-scope",
        { ...validCore, nonScope: [...validCore.nonScope, "mission.author"] },
      ],
      [
        "task authorizing outside mission scope",
        {
          ...validCore,
          tasks: validCore.tasks.map((task, i) =>
            i === 0 ? { ...task, authorizedActions: ["worker.runtime.provision"] } : task,
          ),
        },
      ],
      ["duplicate task ids", { ...validCore, tasks: [validCore.tasks[0]!, validCore.tasks[0]!] }],
      ["unparseable expiresAt", { ...validCore, expiresAt: "tomorrow" }],
      ["unparseable declaredAt", { ...validCore, provenance: { ...validCore.provenance, declaredAt: "recently" } }],
      ["bad schemaVersion", { ...validCore, schemaVersion: "1" }],
    ];
    for (const [name, core] of cases) {
      expect(() => stampMissionContract({ ...core, envelope: envelopeInput() })).toThrow(
        /mission contract rejected/,
      );
      void name;
    }
  });

  it("rejects an envelope missing the causation root", () => {
    const envelope = envelopeInput();
    const anonymous: KernelObjectEnvelopeInput = {
      ...envelope,
      causationId: null,
      parentEventId: null,
      declaredOrigin: null,
    };
    expect(() => stampMissionContract({ ...validCore, envelope: anonymous })).toThrow(/causation chain root/);
  });

  it("rejects an envelope object_type outside the contract allowlist", () => {
    const envelope = envelopeInput();
    expect(() =>
      stampMissionContract({ ...validCore, envelope: { ...envelope, objectType: "mission_delegation" } }),
    ).toThrow(/not registered/);
  });

  it("rejects cross-tenant envelope provenance", () => {
    const envelope = envelopeInput();
    const crossTenant: KernelObjectEnvelopeInput = {
      ...envelope,
      provenance: { source: "mission:other", originTenantId: "tenant-b" },
    };
    expect(() => stampMissionContract({ ...validCore, envelope: crossTenant })).toThrow(/cross-tenant/);
  });

  it("carries every kernel envelope column on the persistent object", () => {
    const mission = stamped();
    const envelope = mission.envelope as unknown as Record<string, unknown>;
    for (const column of KERNEL_ENVELOPE_COLUMNS) {
      expect(envelope[column], `missing envelope column ${column}`).toBeDefined();
    }
    expect(mission.envelope.object_type).toBe("mission_intent");
    expect(mission.envelope.trace_id.length).toBeGreaterThan(0);
  });
});

describe("canonical 15-state lifecycle (RULING-5 alignment)", () => {
  it("mirrors the exact RULING-5 vocabulary DEFINED..ARCHIVED", () => {
    expect([...MISSION_LIFECYCLE_STATES]).toEqual([
      "DEFINED",
      "READY",
      "QUEUED",
      "RUNNING",
      "WAITING",
      "PAUSED",
      "RETRYING",
      "SUCCEEDED",
      "FAILED",
      "CANCELLED",
      "TIMED_OUT",
      "COMPENSATING",
      "COMPENSATED",
      "QUARANTINED",
      "ARCHIVED",
    ]);
  });

  it("maps onto the foundation loop vocabulary without duplicating it", () => {
    for (const foundationState of Object.values(MISSION_LIFECYCLE_MAPPING_TO_FOUNDATION)) {
      expect((FOUNDATION_LIFECYCLE as readonly string[]).includes(foundationState)).toBe(true);
    }
    expect(MISSION_LIFECYCLE_MAPPING_TO_FOUNDATION.DEFINED).toBe("proposed");
    expect(MISSION_LIFECYCLE_MAPPING_TO_FOUNDATION.READY).toBe("authorized");
    expect(MISSION_LIFECYCLE_MAPPING_TO_FOUNDATION.CANCELLED).toBe("revoked");
    expect(MISSION_LIFECYCLE_MAPPING_TO_FOUNDATION.ARCHIVED).toBe("closed");
  });

  it("walks the full legal lifecycle DEFINED -> ARCHIVED with evidence", () => {
    let mission = stamped();
    const path = ["READY", "QUEUED", "RUNNING", "WAITING", "RUNNING", "SUCCEEDED", "ARCHIVED"] as const;
    for (const to of path) {
      const result = transitionMission(mission, to, {
        now: NOW,
        evidence: [evidence("contract_authored"), evidence("suite_pass")],
      });
      expect(result.ok, `transition to ${to}`).toBe(true);
      if (result.ok) mission = result.mission;
    }
    expect(mission.lifecycle).toBe("ARCHIVED");
  });

  it("walks a failure/compensation path to a terminal state", () => {
    let mission = stamped();
    for (const to of ["READY", "QUEUED", "RUNNING", "FAILED", "COMPENSATING", "COMPENSATED", "ARCHIVED"] as const) {
      const result = transitionMission(mission, to, { now: NOW });
      expect(result.ok, `transition to ${to}`).toBe(true);
      if (result.ok) mission = result.mission;
    }
    expect(mission.lifecycle).toBe("ARCHIVED");
  });

  it("walks a quarantine path (security posture) to a terminal state", () => {
    let mission = stamped();
    for (const to of ["READY", "QUARANTINED", "ARCHIVED"] as const) {
      const result = transitionMission(mission, to, { now: NOW });
      expect(result.ok, `transition to ${to}`).toBe(true);
      if (result.ok) mission = result.mission;
    }
    expect(mission.lifecycle).toBe("ARCHIVED");
  });

  it("denies every illegal transition pair (exhaustive)", () => {
    const legalPairs = new Set(
      MISSION_LIFECYCLE_STATES.flatMap((from) =>
        MISSION_LIFECYCLE_STATES.filter((to) => isMissionTransitionAllowed(from, to)).map(
          (to) => `${from}->${to}`,
        ),
      ),
    );
    const coverage = [evidence("contract_authored"), evidence("suite_pass")];
    for (const from of MISSION_LIFECYCLE_STATES) {
      for (const to of MISSION_LIFECYCLE_STATES) {
        const mission = { ...stamped(), lifecycle: from };
        const result = transitionMission(mission, to, { now: NOW, evidence: coverage });
        if (from === "ARCHIVED") {
          expect(result).toEqual({
            ok: false,
            denyReason: "terminal_immutable",
            error: expect.stringContaining("ARCHIVED is terminal"),
          });
        } else if (legalPairs.has(`${from}->${to}`)) {
          expect(result.ok, `${from}->${to} should be legal`).toBe(true);
        } else {
          expect(result).toEqual({
            ok: false,
            denyReason: "illegal_transition",
            error: expect.stringContaining(`${from} -> ${to}`),
          });
        }
      }
    }
  });

  it("treats ARCHIVED as terminal and immutable", () => {
    const archived = { ...stamped(), lifecycle: "ARCHIVED" as const };
    for (const to of MISSION_LIFECYCLE_STATES) {
      if (to === "ARCHIVED") continue;
      const result = transitionMission(archived, to, { now: NOW });
      expect(result).toEqual({
        ok: false,
        denyReason: "terminal_immutable",
        error: expect.stringContaining("ARCHIVED is terminal"),
      });
    }
  });
});

describe("admission gates and bounded expiry", () => {
  it("fails closed naming every failing gate", () => {
    const hollow: MissionContractCore = {
      ...validCore,
      tasks: [],
      nonScope: [...validCore.nonScope, "mission.author"],
      requiredEvidenceKinds: [],
      successCriteria: [],
    };
    const evaluation = evaluateMissionAdmissionGates(hollow);
    expect(evaluation.ok).toBe(false);
    if (!evaluation.ok) {
      const kinds = evaluation.failedGates.map((gate) => gate.kind).sort();
      expect(kinds).toEqual(["closure", "definition", "security", "verification"]);
    }
  });

  it("denies a contract-invalid mission at READY (validation precedes gates, fail closed)", () => {
    const hollow = { ...stamped(), tasks: [] } as MissionContract;
    const result = transitionMission(hollow, "READY", { now: NOW });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.denyReason).toBe("invalid_contract");
      expect(result.error).toContain("at least one task");
    }
  });

  it("denies entering an executing state after expiry", () => {
    const queued = { ...stamped(), lifecycle: "QUEUED" as const };
    const failed = { ...stamped(), lifecycle: "FAILED" as const };
    const afterExpiry = "2027-06-01T00:00:00.000Z";
    for (const [mission, to] of [
      [queued, "RUNNING"],
      [failed, "RETRYING"],
    ] as const) {
      const result = transitionMission(mission, to, { now: afterExpiry });
      expect(result.ok, to).toBe(false);
      if (!result.ok) expect(result.denyReason).toBe("expired");
    }
    const beforeExpiry = transitionMission(queued, "RUNNING", { now: NOW });
    expect(beforeExpiry.ok).toBe(true);
  });
});

describe("EVIDENCE before SUCCESS", () => {
  function running(): MissionContract {
    let mission = stamped();
    for (const to of ["READY", "QUEUED", "RUNNING"] as const) {
      const result = transitionMission(mission, to, { now: NOW });
      expect(result.ok).toBe(true);
      if (result.ok) mission = result.mission;
    }
    return mission;
  }

  it("denies SUCCEEDED without complete evidence coverage", () => {
    const mission = running();
    const partial = transitionMission(mission, "SUCCEEDED", {
      now: NOW,
      evidence: [evidence("contract_authored")],
    });
    expect(partial).toEqual({
      ok: false,
      denyReason: "evidence_incomplete",
      error: expect.stringContaining("EVIDENCE before SUCCESS"),
    });
  });

  it("rejects revoked or superseded evidence as coverage", () => {
    const mission = stamped();
    const revokedEvidence = evidence("contract_authored", { lifecycle: "revoked" });
    const supersededEvidence = evidence("suite_pass", { lifecycle: "superseded" });
    expect(missionEvidenceCovers(mission, [revokedEvidence, supersededEvidence])).toBe(false);
    expect(missionEvidenceIsUsable(revokedEvidence)).toBe(false);
  });

  it("rejects cross-tenant and cross-mission evidence as coverage", () => {
    const mission = stamped();
    const foreign = evidence("contract_authored", { tenantId: "tenant-b" });
    const otherMission = evidence("suite_pass", { missionId: "mission-9" });
    expect(missionEvidenceCovers(mission, [foreign, otherMission])).toBe(false);
    expect(
      missionEvidenceCovers(mission, [evidence("contract_authored"), evidence("suite_pass")]),
    ).toBe(true);
  });

  it("requires task-level evidence kinds too, then succeeds", () => {
    const mission = running();
    expect(
      missionEvidenceCovers(mission, [
        evidence("contract_authored", { taskId: "task-1", evidenceKind: "suite_pass" }),
        evidence("suite_pass", { taskId: "task-2", evidenceKind: "suite_pass" }),
      ]),
    ).toBe(false);
    const complete = transitionMission(mission, "SUCCEEDED", {
      now: NOW,
      evidence: [
        evidence("contract_authored", { taskId: "task-1" }),
        evidence("suite_pass", { taskId: "task-2" }),
      ],
    });
    expect(complete.ok).toBe(true);
    if (complete.ok) expect(complete.mission.lifecycle).toBe("SUCCEEDED");
  });
});