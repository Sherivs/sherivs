/**
 * CoreGrid — H3-015 mission-gate machinery tests (mission B-015 / J-026).
 *
 * Proves the fail-closed gate laws for the definition / security /
 * verification / closure taxonomy (MISSION-R-51):
 * - a gate can never default to PASSED — every non-allow path is BLOCKED
 *   with a named reason, including the empty gate set;
 * - PASSED is issued only by evaluation after requirements were verified;
 * - waivers are evidence-bearing, security-only, time-bounded, and never a
 *   bypass for a lapsed or unattributed waiver;
 * - mission composition fails closed on undeclared, kind-mismatched,
 *   duplicate, and missing gate reviews, and closure composes with
 *   EVIDENCE before SUCCESS.
 *
 * Pure offline: no network, no database, no secrets, no wall clock.
 */
import { describe, expect, it } from "vitest";
import {
  GATE_KINDS,
  GATE_OUTCOMES,
  evaluateGate,
  evaluateGateReviews,
  evaluateMissionGates,
  parseGateReview,
  type GateDeclaration,
  type GatePassed,
  type GateReview,
  type GateSubmission,
  type GateWaiver,
} from "../../frontend/src/lib/mission/gates";
import {
  validateMissionCore,
  type MissionContractCore,
  type MissionEvidenceRecord,
} from "../../frontend/src/lib/mission/mission-contract";

const NOW = "2026-10-03T00:00:00.000Z";
const TENANT = "tenant-a";
const MISSION_ID = "mission-h3-015";

/* ─── fixtures ─────────────────────────────────────────────── */

function evidenceRecord(overrides: Partial<MissionEvidenceRecord> = {}): MissionEvidenceRecord {
  return {
    evidenceId: "ev-1",
    missionId: MISSION_ID,
    taskId: null,
    evidenceKind: "spec_record",
    producer: "role:mission-gate-engineer",
    actorId: "actor:owner",
    tenantId: TENANT,
    recordedAt: NOW,
    provenance: "H3 wave mission B-015 evidence ledger",
    integrity: "sha256:stub-integrity",
    lifecycle: "active",
    ...overrides,
  };
}

function declaration(overrides: Partial<GateDeclaration> = {}): GateDeclaration {
  return {
    gateId: "gate-definition",
    kind: "definition",
    tenantId: TENANT,
    reason: "the declared outcome and its decomposition exist before work is admitted",
    requiredEvidenceKinds: ["spec_record"],
    notBefore: null,
    expiresAt: null,
    ...overrides,
  };
}

function submission(overrides: Partial<GateSubmission> = {}): GateSubmission {
  return {
    gateId: "gate-definition",
    submittedBy: "actor:owner",
    submittedAt: NOW,
    evidenceRefs: [{ evidenceId: "ev-1", evidenceKind: "spec_record" }],
    ...overrides,
  };
}

function waiver(overrides: Partial<GateWaiver> = {}): GateWaiver {
  return {
    waiverId: "waiver-1",
    gateId: "gate-security",
    grantedBy: "role:security-authority",
    authorityRef: "AGENTS.md §16 authorization model",
    grantedAt: "2026-10-01T00:00:00.000Z",
    expiresAt: "2026-10-04T00:00:00.000Z",
    reason: "bounded, attributed, evidence-bearing security waiver",
    evidence: [{ evidenceId: "ev-waiver", evidenceKind: "authority_attestation" }],
    ...overrides,
  };
}

function review(overrides: Partial<GateReview> = {}): GateReview {
  return {
    declaration: declaration(),
    submission: submission(),
    waiver: null,
    ...overrides,
  };
}

function missionCore(overrides: Partial<MissionContractCore> = {}): MissionContractCore {
  return {
    missionId: MISSION_ID,
    schemaVersion: "1.0",
    tenantId: TENANT,
    objective: "admit and close governed work through typed gates",
    nonScope: ["act:forbidden"],
    ownerRef: "actor:owner",
    actorRefs: ["actor:owner"],
    authorizedActions: ["act:admit", "act:close"],
    tasks: [
      {
        taskId: "task-1",
        title: "produce the work",
        authorizedActions: ["act:admit"],
        requiredEvidenceKinds: ["task_record"],
      },
    ],
    admissionGates: [
      { gateId: "gate-definition", kind: "definition", reason: "definition completeness" },
      { gateId: "gate-security", kind: "security", reason: "security review" },
      { gateId: "gate-verification", kind: "verification", reason: "verification completeness" },
      { gateId: "gate-closure", kind: "closure", reason: "closure completeness" },
    ],
    successCriteria: ["all gates passed"],
    requiredEvidenceKinds: ["completion_attestation"],
    lifecycle: "DEFINED",
    expiresAt: null,
    provenance: {
      declaredBy: "role:mission-gate-engineer",
      declaredAt: NOW,
      authorityRef: "H3 wave mission B-015",
      contextRef: null,
      sourceRef: null,
      generatedByAi: false,
      verified: true,
    },
    ...overrides,
  };
}

const CTX = { tenantId: TENANT, now: NOW, evidence: [evidenceRecord()] };

/* ─── schema strictness (fail closed at the parse boundary) ── */

describe("gate review schema (strict, fail closed)", () => {
  it("accepts a well-formed review", () => {
    const parsed = parseGateReview(review());
    expect(parsed.ok).toBe(true);
  });

  it("rejects an unknown gate kind — only the closed J-026 taxonomy exists", () => {
    expect((GATE_KINDS as readonly string[]).includes("approval")).toBe(false);
    const parsed = parseGateReview(review({ declaration: declaration({ kind: "approval" as never }) }));
    expect(parsed.ok).toBe(false);
  });

  it("rejects blank required fields and unknown keys", () => {
    expect(parseGateReview(review({ declaration: declaration({ gateId: "  " }) })).ok).toBe(false);
    expect(parseGateReview(review({ declaration: declaration({ reason: "" }) })).ok).toBe(false);
    expect(parseGateReview(review({ submission: submission({ submittedBy: " " }) })).ok).toBe(false);
    const extraKey = review() as GateReview & { extra: true };
    expect(parseGateReview({ ...extraKey, extra: true }).ok).toBe(false);
  });

  it("rejects unparseable timestamps everywhere time appears", () => {
    expect(parseGateReview(review({ declaration: declaration({ notBefore: "soon" }) })).ok).toBe(false);
    expect(parseGateReview(review({ declaration: declaration({ expiresAt: "never" }) })).ok).toBe(false);
    expect(parseGateReview(review({ submission: submission({ submittedAt: "earlier" }) })).ok).toBe(false);
  });

  it("rejects a waiver without evidence — an evidence-less waiver is void", () => {
    const evidenceless = { ...waiver(), evidence: [] };
    expect(parseGateReview(review({ waiver: evidenceless })).ok).toBe(false);
  });

  it("rejects duplicate required evidence kinds and duplicate evidence refs", () => {
    expect(parseGateReview(review({ declaration: declaration({ requiredEvidenceKinds: ["a", "a"] }) })).ok).toBe(false);
    const dupRefs = submission({
      evidenceRefs: [
        { evidenceId: "ev-1", evidenceKind: "spec_record" },
        { evidenceId: "ev-1", evidenceKind: "spec_record" },
      ],
    });
    expect(parseGateReview(review({ submission: dupRefs })).ok).toBe(false);
  });
});

/* ─── fail-closed core: a gate can never default to PASSED ── */

describe("fail-closed evaluation core", () => {
  it("offers exactly two outcomes — PASSED and BLOCKED — with no third state", () => {
    expect(GATE_OUTCOMES).toEqual(["PASSED", "BLOCKED"]);
  });

  it("blocks when the evidence ledger holds nothing usable", () => {
    const verdict = evaluateGate(review(), { ...CTX, evidence: [] });
    expect(verdict.outcome).toBe("BLOCKED");
    if (verdict.outcome === "BLOCKED") {
      expect(verdict.reasons.some((r) => r.includes("missing_evidence_kind: spec_record"))).toBe(true);
    }
  });

  it("blocks on an invalid evaluation clock instead of guessing", () => {
    const verdict = evaluateGate(review(), { ...CTX, now: "not-a-timestamp" });
    expect(verdict.outcome).toBe("BLOCKED");
    if (verdict.outcome === "BLOCKED") {
      expect(verdict.reasons[0]).toContain("invalid_evaluation_context");
    }
  });

  it("blocks when the evaluation tenant is missing or foreign", () => {
    const blank = evaluateGate(review(), { ...CTX, tenantId: "  " });
    expect(blank.outcome).toBe("BLOCKED");

    const foreign = evaluateGate(review(), { ...CTX, tenantId: "tenant-b" });
    expect(foreign.outcome).toBe("BLOCKED");
    if (foreign.outcome === "BLOCKED") {
      expect(foreign.reasons[0]).toContain("cross_tenant");
    }
  });

  it("passes only on verified evidence coverage — PASSED is earned, never defaulted", () => {
    const verdict = evaluateGate(review(), CTX);
    expect(verdict.outcome).toBe("PASSED");
    if (verdict.outcome === "PASSED") {
      expect(verdict.basis).toBe("evidence");
      expect(verdict.satisfiedBy).toEqual(["ev-1"]);
      expect(verdict.evaluatedAt).toBe(NOW);
    }
  });

  it("PASSED is a branded type that cannot be forged outside the gate machinery", () => {
    // A forged literal is missing the module-private brand property, so this
    // assignment is a compile-time error. At runtime the API never trusts a
    // hand-built verdict — only evaluateGate/evaluateGateReviews issue one.
    // @ts-expect-error — GatePassed carries a non-exported brand symbol
    const forged: GatePassed = {
      outcome: "PASSED",
      gateId: "gate-definition",
      kind: "definition",
      basis: "evidence",
      satisfiedBy: [],
      evaluatedAt: NOW,
    };
    expect(forged.outcome).toBe("PASSED");
  });
});

/* ─── evidence resolution is fail closed ───────────────────── */

describe("evidence resolution (usable-or-not)", () => {
  it("rejects a claimed evidence kind the record does not carry", () => {
    const verdict = evaluateGate(
      review({ submission: submission({ evidenceRefs: [{ evidenceId: "ev-1", evidenceKind: "other_kind" }] }) }),
      CTX,
    );
    expect(verdict.outcome).toBe("BLOCKED");
  });

  it("rejects revoked and superseded evidence", () => {
    for (const lifecycle of ["revoked", "superseded"] as const) {
      const verdict = evaluateGate(review(), { ...CTX, evidence: [evidenceRecord({ lifecycle })] });
      expect(verdict.outcome).toBe("BLOCKED");
    }
  });

  it("rejects cross-tenant evidence even when the gate tenant matches", () => {
    const verdict = evaluateGate(review(), {
      ...CTX,
      evidence: [evidenceRecord({ tenantId: "tenant-b" })],
    });
    expect(verdict.outcome).toBe("BLOCKED");
  });

  it("rejects malformed evidence records (missing integrity, bad recordedAt)", () => {
    const noIntegrity = evaluateGate(review(), { ...CTX, evidence: [evidenceRecord({ integrity: "" })] });
    expect(noIntegrity.outcome).toBe("BLOCKED");
    const badTime = evaluateGate(review(), { ...CTX, evidence: [evidenceRecord({ recordedAt: "yesterday-ish" })] });
    expect(badTime.outcome).toBe("BLOCKED");
  });

  it("passes when multiple required kinds are each covered by usable evidence", () => {
    const decl = declaration({ requiredEvidenceKinds: ["spec_record", "authority_attestation"] });
    const sub = submission({
      evidenceRefs: [
        { evidenceId: "ev-1", evidenceKind: "spec_record" },
        { evidenceId: "ev-2", evidenceKind: "authority_attestation" },
      ],
    });
    const verdict = evaluateGate(review({ declaration: decl, submission: sub }), {
      ...CTX,
      evidence: [evidenceRecord(), evidenceRecord({ evidenceId: "ev-2", evidenceKind: "authority_attestation" })],
    });
    expect(verdict.outcome).toBe("PASSED");
  });
});

/* ─── gate windows and submission sanity ───────────────────── */

describe("gate window enforcement", () => {
  it("blocks a not-yet-effective gate", () => {
    const verdict = evaluateGate(
      review({ declaration: declaration({ notBefore: "2026-10-04T00:00:00.000Z" }) }),
      CTX,
    );
    expect(verdict.outcome).toBe("BLOCKED");
    if (verdict.outcome === "BLOCKED") expect(verdict.reasons[0]).toContain("not_yet_effective");
  });

  it("blocks an expired gate — expiry is enforced, never advisory", () => {
    const verdict = evaluateGate(
      review({ declaration: declaration({ expiresAt: "2026-10-02T00:00:00.000Z" }) }),
      CTX,
    );
    expect(verdict.outcome).toBe("BLOCKED");
    if (verdict.outcome === "BLOCKED") expect(verdict.reasons[0]).toContain("expired");
  });

  it("blocks a submission dated in the future", () => {
    const verdict = evaluateGate(
      review({ submission: submission({ submittedAt: "2026-10-04T00:00:00.000Z" }) }),
      CTX,
    );
    expect(verdict.outcome).toBe("BLOCKED");
    if (verdict.outcome === "BLOCKED") expect(verdict.reasons[0]).toContain("future_submission");
  });

  it("blocks a submission that targets a different gate", () => {
    const verdict = evaluateGate(review({ submission: submission({ gateId: "gate-other" }) }), CTX);
    expect(verdict.outcome).toBe("BLOCKED");
    if (verdict.outcome === "BLOCKED") expect(verdict.reasons[0]).toContain("submission_mismatch");
  });
});

/* ─── waivers: evidence-bearing, security-only, time-bounded ── */

describe("waiver semantics (never a bypass)", () => {
  it("lets a valid, evidence-bearing waiver pass a security gate lacking evidence", () => {
    const securityReview = review({
      declaration: declaration({ gateId: "gate-security", kind: "security", requiredEvidenceKinds: ["penetration_record"] }),
      submission: submission({ gateId: "gate-security", evidenceRefs: [] }),
      waiver: waiver(),
    });
    const verdict = evaluateGate(securityReview, {
      ...CTX,
      evidence: [evidenceRecord({ evidenceId: "ev-waiver", evidenceKind: "authority_attestation" })],
    });
    expect(verdict.outcome).toBe("PASSED");
    if (verdict.outcome === "PASSED") {
      expect(verdict.basis).toBe("authoritative_waiver");
      expect(verdict.satisfiedBy).toEqual(["ev-waiver"]);
    }
  });

  it("blocks on an expired waiver — a lapsed waiver is BLOCKED, not forgiven", () => {
    const securityReview = review({
      declaration: declaration({ gateId: "gate-security", kind: "security", requiredEvidenceKinds: ["penetration_record"] }),
      submission: submission({ gateId: "gate-security", evidenceRefs: [] }),
      waiver: waiver({ expiresAt: "2026-10-02T00:00:00.000Z" }),
    });
    const verdict = evaluateGate(securityReview, CTX);
    expect(verdict.outcome).toBe("BLOCKED");
    if (verdict.outcome === "BLOCKED") expect(verdict.reasons.some((r) => r.includes("waiver_expired"))).toBe(true);
  });

  it("blocks on a waiver granted in the future", () => {
    const securityReview = review({
      declaration: declaration({ gateId: "gate-security", kind: "security", requiredEvidenceKinds: ["penetration_record"] }),
      submission: submission({ gateId: "gate-security", evidenceRefs: [] }),
      waiver: waiver({ grantedAt: "2026-10-04T00:00:00.000Z" }),
    });
    const verdict = evaluateGate(securityReview, CTX);
    expect(verdict.outcome).toBe("BLOCKED");
    if (verdict.outcome === "BLOCKED") expect(verdict.reasons.some((r) => r.includes("waiver_not_yet_granted"))).toBe(true);
  });

  it("blocks when the waiver's own evidence is unusable or cross-tenant", () => {
    const securityReview = review({
      declaration: declaration({ gateId: "gate-security", kind: "security", requiredEvidenceKinds: ["penetration_record"] }),
      submission: submission({ gateId: "gate-security", evidenceRefs: [] }),
      waiver: waiver(),
    });
    const unusable = evaluateGate(securityReview, { ...CTX, evidence: [] });
    expect(unusable.outcome).toBe("BLOCKED");
    if (unusable.outcome === "BLOCKED") expect(unusable.reasons.some((r) => r.includes("waiver_void"))).toBe(true);

    const foreign = evaluateGate(securityReview, {
      ...CTX,
      evidence: [evidenceRecord({ evidenceId: "ev-waiver", evidenceKind: "authority_attestation", tenantId: "tenant-b" })],
    });
    expect(foreign.outcome).toBe("BLOCKED");
  });

  it("never lets a waiver open a definition gate — waivers are security-only", () => {
    const definitionReview = review({ waiver: waiver({ gateId: "gate-definition" }) });
    const verdict = evaluateGate(definitionReview, { ...CTX, evidence: [] });
    expect(verdict.outcome).toBe("BLOCKED");
    if (verdict.outcome === "BLOCKED") expect(verdict.reasons.some((r) => r.includes("waiver_misplaced"))).toBe(true);
  });

  it("blocks a waiver that names a different gate", () => {
    const securityReview = review({
      declaration: declaration({ gateId: "gate-security", kind: "security", requiredEvidenceKinds: ["penetration_record"] }),
      submission: submission({ gateId: "gate-security", evidenceRefs: [] }),
      waiver: waiver({ gateId: "gate-elsewhere" }),
    });
    const verdict = evaluateGate(securityReview, CTX);
    expect(verdict.outcome).toBe("BLOCKED");
    if (verdict.outcome === "BLOCKED") expect(verdict.reasons.some((r) => r.includes("waiver_mismatch"))).toBe(true);
  });
});

/* ─── gate sets: no vacuous passes ──────────────────────────── */

describe("gate set evaluation", () => {
  it("passes a set only when every review passed", () => {
    const securityReview = review({
      declaration: declaration({ gateId: "gate-security", kind: "security", requiredEvidenceKinds: ["penetration_record"] }),
      submission: submission({ gateId: "gate-security", evidenceRefs: [{ evidenceId: "ev-sec", evidenceKind: "penetration_record" }] }),
    });
    const set = evaluateGateReviews([review(), securityReview], {
      ...CTX,
      evidence: [evidenceRecord(), evidenceRecord({ evidenceId: "ev-sec", evidenceKind: "penetration_record" })],
    });
    expect(set.allPassed).toBe(true);
    expect(set.blocked).toHaveLength(0);
    expect(set.passed).toHaveLength(2);
  });

  it("fails a set when one gate is blocked", () => {
    const set = evaluateGateReviews([review(), review({ declaration: declaration({ gateId: "gate-verification", kind: "verification" }) })], {
      ...CTX,
      evidence: [],
    });
    expect(set.allPassed).toBe(false);
    expect(set.blocked).toHaveLength(2);
    expect(set.passed).toHaveLength(0);
  });

  it("NEVER passes an empty gate set — absence of gates is absence of assurance", () => {
    const set = evaluateGateReviews([], CTX);
    expect(set.allPassed).toBe(false);
  });
});

/* ─── mission composition (MISSION-R-50 / V1CAP-046) ────────── */

describe("mission gate composition", () => {
  it("validates the fixture mission core so composition laws bind to a real contract", () => {
    expect(validateMissionCore(missionCore())).toBeNull();
  });

  it("blocks a review for a gate the mission never declared", () => {
    const result = evaluateMissionGates(
      missionCore(),
      [review({ declaration: declaration({ gateId: "gate-undeclared", kind: "security" }) })],
      CTX,
    );
    expect(result.allPassed).toBe(false);
    expect(result.blocked.some((v) => v.reasons[0].includes("undeclared_gate"))).toBe(true);
  });

  it("blocks a review whose kind differs from the declared admission gate", () => {
    const result = evaluateMissionGates(
      missionCore(),
      [review({ declaration: declaration({ gateId: "gate-definition", kind: "security" }) })],
      CTX,
    );
    expect(result.allPassed).toBe(false);
    expect(result.blocked.some((v) => v.reasons[0].includes("kind_mismatch"))).toBe(true);
  });

  it("blocks a duplicate review for the same gate — no re-roll until pass", () => {
    const result = evaluateMissionGates(missionCore(), [review(), review()], CTX);
    expect(result.allPassed).toBe(false);
    expect(result.blocked.some((v) => v.reasons[0].includes("duplicate_submission"))).toBe(true);
  });

  it("reports missing submissions for declared admission gates", () => {
    const result = evaluateMissionGates(missionCore(), [review()], CTX);
    expect(result.missingSubmissions).toEqual(
      expect.arrayContaining(["gate-security", "gate-verification", "gate-closure"]),
    );
    expect(result.allPassed).toBe(false);
  });

  it("blocks a closure gate that ignores mission-level evidence coverage", () => {
    // Gate-local kinds are covered, but the mission's completion_attestation
    // kind is not in the ledger — EVIDENCE before SUCCESS still blocks closure.
    const closureReview = review({
      declaration: declaration({ gateId: "gate-closure", kind: "closure", requiredEvidenceKinds: ["spec_record"] }),
      submission: submission({ gateId: "gate-closure" }),
    });
    const result = evaluateMissionGates(missionCore(), [closureReview], {
      ...CTX,
      evidence: [evidenceRecord()],
    });
    expect(result.allPassed).toBe(false);
    expect(result.blocked.some((v) => v.reasons[0].includes("closure_incomplete"))).toBe(true);
  });

  it("admits a fully-evidenced mission through all four declared gates", () => {
    const ledger: MissionEvidenceRecord[] = [
      evidenceRecord(),
      evidenceRecord({ evidenceId: "ev-sec", evidenceKind: "penetration_record" }),
      evidenceRecord({ evidenceId: "ev-ver", evidenceKind: "test_record" }),
      evidenceRecord({ evidenceId: "ev-task", evidenceKind: "task_record", taskId: "task-1" }),
      evidenceRecord({ evidenceId: "ev-done", evidenceKind: "completion_attestation" }),
    ];
    const reviews: GateReview[] = [
      review(),
      review({
        declaration: declaration({ gateId: "gate-security", kind: "security", requiredEvidenceKinds: ["penetration_record"] }),
        submission: submission({ gateId: "gate-security", evidenceRefs: [{ evidenceId: "ev-sec", evidenceKind: "penetration_record" }] }),
      }),
      review({
        declaration: declaration({ gateId: "gate-verification", kind: "verification", requiredEvidenceKinds: ["test_record"] }),
        submission: submission({ gateId: "gate-verification", evidenceRefs: [{ evidenceId: "ev-ver", evidenceKind: "test_record" }] }),
      }),
      review({
        declaration: declaration({ gateId: "gate-closure", kind: "closure", requiredEvidenceKinds: ["completion_attestation"] }),
        submission: submission({ gateId: "gate-closure", evidenceRefs: [{ evidenceId: "ev-done", evidenceKind: "completion_attestation" }] }),
      }),
    ];
    const result = evaluateMissionGates(missionCore(), reviews, { ...CTX, evidence: ledger });
    expect(result.allPassed).toBe(true);
    expect(result.missingSubmissions).toHaveLength(0);
    expect(result.blocked).toHaveLength(0);
    expect(result.passed).toHaveLength(4);
    expect(new Set(result.passed.map((v) => v.kind))).toEqual(new Set(GATE_KINDS));
  });
});
