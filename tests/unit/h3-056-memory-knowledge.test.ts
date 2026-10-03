/**
 * CoreGrid — H3-056 phase-36 memory & knowledge contract tests (mission G-056).
 *
 * Proves, against the pure contract in
 * `frontend/src/lib/memory-knowledge/contracts.ts`:
 * - the substrate is FAIL-CLOSED: malformed records/gates/requests/pipelines
 *   are rejected with typed reasons and never throw;
 * - recall and record reads are AUTHORIZATION-GATED (AGENTS §19, L-T-015):
 *   there is NO bypass path — a missing, malformed, expired, mismatched or
 *   non-permitting gate denies with a typed reason, and the only content-
 *   opening surface is `authorizedMemoryView` behind a valid ALLOW gate;
 * - a REDACT decision yields a redacted posture with directives, never raw
 *   content, and a redact decision without directives is structurally invalid;
 * - AI disclosure (AGENTS §19 pipeline) blocks unless identity, authorization,
 *   classification, purpose, minimization and redaction are ALL complete, and
 *   the disclosed payload is metadata-only by construction;
 * - knowledge validation/provenance invariants hold (validated ⇒ evidence,
 *   retracted ⇒ reason, retracted/expunged are unreadable and undislosable);
 * - lifecycle transitions are explicit and revision-carrying; forgetting is
 *   approval-gated and GENUINE (an expunged record structurally cannot carry
 *   content and is unreachable through every read surface);
 * - composition: the module binds to the phase-36 kernel contract read-only
 *   and reuses the platform sensitivity vocabulary;
 * - purity: time is injected, inputs are never mutated.
 *
 * Pure offline suite: no network, no database, no secrets.
 */
import { describe, expect, it } from "vitest";
import {
  MEMORY_KNOWLEDGE_CONTRACT_POSTURE,
  MEMORY_LIFECYCLE_TRANSITIONS,
  authorizedMemoryView,
  evaluateAiDisclosure,
  evaluateRecallRequest,
  executeForgettingAct,
  applyLifecycleTransition,
  parseAiDisclosurePipeline,
  parseAuthorizationGate,
  parseForgettingAct,
  parseKnowledgeRevision,
  parseMemoryRecord,
  parseRecallRequest,
  parseMemoryScopeKey,
  type AiDisclosurePipeline,
  type ForgettingAct,
  type KnowledgeRevision,
  type MemoryAuthorizationGate,
  type MemoryCallerContext,
  type MemoryRecord,
} from "../../frontend/src/lib/memory-knowledge/contracts";
import { PHASE_36_MEMORY_KNOWLEDGE } from "../../frontend/src/lib/kernel/phase-contracts/phase-36-memory-knowledge";

const NOW = "2026-10-03T00:00:00.000Z";
const EARLIER = "2026-10-02T00:00:00.000Z";
const LATER = "2026-10-03T12:00:00.000Z";
const AFTER_EXPIRY = "2026-10-04T00:00:00.000Z";

/* ─────────────── fixture builders ─────────────── */

function gate(overrides: Partial<MemoryAuthorizationGate> = {}): MemoryAuthorizationGate {
  return {
    gateId: "gate-0001",
    decision: "allow",
    principalRef: "principal:alpha",
    tenantRef: "tenant-1",
    scopeKey: "scope-alpha",
    purposeRef: "purpose:ops",
    sensitivityCeiling: "restricted",
    redactionDirectives: [],
    decidedAt: EARLIER,
    expiresAt: LATER,
    authorityRef: "authority:authz-layer",
    traceId: "trace:0001",
    ...overrides,
  };
}

function record(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    recordId: "record-alpha",
    tenantRef: "tenant-1",
    scopeKey: "scope-alpha",
    kind: "semantic",
    sensitivity: "internal",
    abstractionLevel: "knowledge",
    content: { summary: "A bounded summary of preserved material.", payloadRefs: [] },
    validation: {
      state: "validated",
      confidence: 0.9,
      evidenceLevel: "verified",
      evidenceRefs: ["evidence:1"],
    },
    provenance: {
      createdBy: "creator:alpha",
      originKind: "human",
      originRef: "origin:1",
      createdAt: EARLIER,
      aiGenerated: false,
      transformationRefs: [],
      validationRefs: ["validation:1"],
    },
    retention: { rule: "bounded", expiresAt: LATER },
    lifecycle: "active",
    createdAt: EARLIER,
    updatedAt: EARLIER,
    ...overrides,
  };
}

function caller(overrides: Partial<MemoryCallerContext> = {}): MemoryCallerContext {
  return {
    principalRef: "principal:alpha",
    purposeRef: "purpose:ops",
    ...overrides,
  };
}

function pipeline(overrides: Partial<AiDisclosurePipeline> = {}): AiDisclosurePipeline {
  return {
    identityRef: "identity:model-client",
    authorizationRef: "authz:decision-1",
    classification: "internal",
    purposeRef: "purpose:ops",
    purposeAllowed: true,
    minimized: true,
    redacted: true,
    aiContextRef: "ai-context:1",
    ...overrides,
  };
}

function revision(
  overrides: Partial<KnowledgeRevision> & { recordId?: string } = {},
): KnowledgeRevision {
  return {
    revisionId: "rev-0001",
    recordId: "record-alpha",
    reason: "advance lifecycle",
    contributorRef: "contributor:alpha",
    appliedAt: NOW,
    previousLifecycle: "created",
    newLifecycle: "processed",
    ...overrides,
  };
}

function forgettingAct(overrides: Partial<ForgettingAct> = {}): ForgettingAct {
  return {
    actId: "act-0001",
    recordId: "record-alpha",
    mode: "expunge",
    approvalRef: "approval:forget-1",
    executedByRef: "operator:alpha",
    executedAt: NOW,
    ...overrides,
  };
}

/* ─────────────── posture composition ─────────────── */

describe("posture composition (read-only kernel binding)", () => {
  it("binds to the phase-36 kernel contract and its boundary statement", () => {
    expect(MEMORY_KNOWLEDGE_CONTRACT_POSTURE.phaseId).toBe(PHASE_36_MEMORY_KNOWLEDGE.id);
    expect(MEMORY_KNOWLEDGE_CONTRACT_POSTURE.phaseCapability).toBe(
      PHASE_36_MEMORY_KNOWLEDGE.capabilities.owns[0],
    );
    expect(MEMORY_KNOWLEDGE_CONTRACT_POSTURE.boundary).toBe(
      PHASE_36_MEMORY_KNOWLEDGE.boundary.statement,
    );
    expect(MEMORY_KNOWLEDGE_CONTRACT_POSTURE.boundary).toContain("never grants the right to read");
  });

  it("encodes the approval-gated operations named by the kernel contract", () => {
    expect(MEMORY_KNOWLEDGE_CONTRACT_POSTURE.approvalRequiredFor).toContain(
      "retention-policy-change",
    );
    expect(MEMORY_KNOWLEDGE_CONTRACT_POSTURE.approvalRequiredFor).toContain(
      "forgetting-execution",
    );
    expect(MEMORY_KNOWLEDGE_CONTRACT_POSTURE.approvalRequiredFor).toContain(
      "cross-tenant-recall",
    );
  });

  it("is deny-by-default and authorization-gated by posture", () => {
    expect(MEMORY_KNOWLEDGE_CONTRACT_POSTURE.defaultDecision).toBe("deny");
    expect(MEMORY_KNOWLEDGE_CONTRACT_POSTURE.recallPolicy).toBe("authorization-gated");
    expect(MEMORY_KNOWLEDGE_CONTRACT_POSTURE.aiDisclosurePolicy).toBe(
      "minimized-and-redacted-metadata-only",
    );
    expect(MEMORY_KNOWLEDGE_CONTRACT_POSTURE.forgettingPolicy).toBe(
      "approval-gated-and-unreachable",
    );
  });
});

/* ─────────────── fail-closed parsing ─────────────── */

describe("fail-closed parsing", () => {
  it("rejects a malformed record with a typed reason instead of throwing", () => {
    expect(parseMemoryRecord({ ...record(), recordId: "BAD ID" }).ok).toBe(false);
    expect(parseMemoryRecord({ ...record(), validation: { ...record().validation, confidence: 1.5 } }).ok).toBe(false);
    expect(parseMemoryRecord({ ...record(), sensitivity: "secret" }).ok).toBe(false);
  });

  it("rejects an expunged record that still carries content", () => {
    const bad = record({ lifecycle: "expunged", expungedAt: NOW });
    const result = parseMemoryRecord(bad);
    expect(result.ok).toBe(false);
  });

  it("rejects expungedAt on a non-expunged record", () => {
    expect(parseMemoryRecord(record({ expungedAt: NOW })).ok).toBe(false);
  });

  it("rejects validated knowledge without evidence and retracted knowledge without a reason", () => {
    expect(
      parseMemoryRecord(
        record({
          validation: {
            state: "validated",
            confidence: 0.2,
            evidenceLevel: "none",
            evidenceRefs: [],
          },
        }),
      ).ok,
    ).toBe(false);
    expect(
      parseMemoryRecord(
        record({
          validation: {
            state: "retracted",
            confidence: 0.9,
            evidenceLevel: "verified",
            evidenceRefs: ["evidence:1"],
          },
        }),
      ).ok,
    ).toBe(false);
  });

  it("rejects retractionReason outside the retracted state", () => {
    expect(
      parseMemoryRecord(
        record({
          validation: {
            state: "validated",
            confidence: 0.9,
            evidenceLevel: "verified",
            evidenceRefs: ["evidence:1"],
            retractionReason: "not allowed here",
          },
        }),
      ).ok,
    ).toBe(false);
  });

  it("rejects bounded retention without expiry and unbounded retention without approval", () => {
    expect(parseMemoryRecord(record({ retention: { rule: "bounded" } })).ok).toBe(false);
    expect(parseMemoryRecord(record({ retention: { rule: "unbounded" } })).ok).toBe(false);
    expect(
      parseMemoryRecord(
        record({
          retention: { rule: "unbounded", approvalRef: "approval:retain" },
        }),
      ).ok,
    ).toBe(true);
    expect(
      parseMemoryRecord(
        record({
          retention: { rule: "bounded", expiresAt: EARLIER },
        }),
      ).ok,
    ).toBe(false);
  });

  it("rejects an eternal gate and a redact decision without directives", () => {
    expect(parseAuthorizationGate(gate({ expiresAt: EARLIER })).ok).toBe(false);
    expect(parseAuthorizationGate(gate({ decision: "redact" })).ok).toBe(false);
    expect(
      parseAuthorizationGate(
        gate({ decision: "allow", redactionDirectives: ["strip field"] }),
      ).ok,
    ).toBe(false);
  });

  it("rejects malformed requests, pipelines, revisions and acts with typed reasons", () => {
    expect(parseRecallRequest({ scopeKey: "SCOPE", tenantRef: "t", principalRef: "p", purposeRef: "u" }).ok).toBe(false);
    expect(parseAiDisclosurePipeline({ ...pipeline(), minimized: false }).ok).toBe(true);
    expect(parseAiDisclosurePipeline({ ...pipeline(), classification: 3 }).ok).toBe(false);
    expect(
      parseKnowledgeRevision(revision({ newLifecycle: "expunged" })).ok,
    ).toBe(false);
    expect(parseForgettingAct(forgettingAct({ approvalRef: "" })).ok).toBe(true);
    expect(parseMemoryScopeKey("Bad_Scope_Upper").ok).toBe(false);
  });
});

/* ─────────────── authorization-gated recall (L-T-015) ─────────────── */

describe("recall is authorization-gated and deny-by-default", () => {
  const request = {
    scopeKey: "scope-alpha",
    tenantRef: "tenant-1",
    principalRef: "principal:alpha",
    purposeRef: "purpose:ops",
  };

  it("denies when no gate is presented", () => {
    expect(evaluateRecallRequest(request, undefined, NOW)).toEqual({
      outcome: "denied",
      reason: "no_gate_presented",
    });
  });

  it("denies a malformed gate instead of throwing", () => {
    expect(
      evaluateRecallRequest(request, { ...gate(), gateId: "" } as MemoryAuthorizationGate, NOW),
    ).toEqual({ outcome: "denied", reason: "gate_malformed" });
  });

  it("denies an expired gate", () => {
    expect(evaluateRecallRequest(request, gate(), AFTER_EXPIRY)).toEqual({
      outcome: "denied",
      reason: "gate_expired",
    });
  });

  it("denies every non-permitting decision", () => {
    for (const decision of ["deny", "escalate", "require_approval"] as const) {
      expect(evaluateRecallRequest(request, gate({ decision }), NOW)).toEqual({
        outcome: "denied",
        reason: "decision_not_permitted",
      });
    }
  });

  it("denies tenant, scope, principal and purpose mismatches", () => {
    expect(evaluateRecallRequest({ ...request, tenantRef: "tenant-2" }, gate(), NOW)).toEqual({
      outcome: "denied",
      reason: "tenant_mismatch",
    });
    expect(evaluateRecallRequest({ ...request, scopeKey: "scope-beta" }, gate(), NOW)).toEqual({
      outcome: "denied",
      reason: "scope_mismatch",
    });
    expect(
      evaluateRecallRequest({ ...request, principalRef: "principal:beta" }, gate(), NOW),
    ).toEqual({ outcome: "denied", reason: "principal_mismatch" });
    expect(evaluateRecallRequest({ ...request, purposeRef: "purpose:other" }, gate(), NOW)).toEqual({
      outcome: "denied",
      reason: "purpose_mismatch",
    });
  });

  it("denies a malformed request with a typed reason", () => {
    expect(
      evaluateRecallRequest(
        { ...request, scopeKey: "NOT-VALID" },
        gate(),
        NOW,
      ),
    ).toEqual({ outcome: "denied", reason: "request_malformed" });
  });

  it("allows only behind a valid allow gate and returns a bounded scope, never content", () => {
    const verdict = evaluateRecallRequest(request, gate(), NOW);
    expect(verdict).toEqual({
      outcome: "allowed",
      gateId: "gate-0001",
      traceId: "trace:0001",
      boundedScope: {
        scopeKey: "scope-alpha",
        tenantRef: "tenant-1",
        principalRef: "principal:alpha",
        purposeRef: "purpose:ops",
      },
    });
    expect("content" in verdict).toBe(false);
  });

  it("yields a redacted posture with directives — never raw content", () => {
    const verdict = evaluateRecallRequest(request, gate({ decision: "redact", redactionDirectives: ["strip-identifiers"] }), NOW);
    expect(verdict.outcome).toBe("redacted");
    if (verdict.outcome === "redacted") {
      expect(verdict.redactionDirectives).toEqual(["strip-identifiers"]);
    }
    expect("content" in verdict).toBe(false);
  });
});

/* ─────────────── authorized record view — no bypass path ─────────────── */

describe("authorizedMemoryView is the only content-opening surface", () => {
  it("denies every read without a gate", () => {
    expect(authorizedMemoryView(record(), undefined, NOW, caller())).toEqual({
      outcome: "denied",
      reason: "no_gate_presented",
    });
  });

  it("denies a malformed caller context with a typed reason", () => {
    expect(
      authorizedMemoryView(record(), gate(), NOW, { principalRef: "", purposeRef: "purpose:ops" }),
    ).toEqual({ outcome: "denied", reason: "caller_malformed" });
  });

  it("denies expunged, retracted and not-yet-stored records before consulting the gate", () => {
    expect(
      authorizedMemoryView(
        record({ lifecycle: "expunged", expungedAt: NOW, content: undefined }),
        gate(),
        NOW,
        caller(),
      ),
    ).toEqual({ outcome: "denied", reason: "record_expunged" });
    expect(
      authorizedMemoryView(
        record({
          validation: {
            state: "retracted",
            confidence: 0.9,
            evidenceLevel: "verified",
            evidenceRefs: ["evidence:1"],
            retractionReason: "contradicted",
          },
        }),
        gate(),
        NOW,
        caller(),
      ),
    ).toEqual({ outcome: "denied", reason: "record_retracted" });
    expect(
      authorizedMemoryView(record({ lifecycle: "created", content: undefined }), gate(), NOW, caller()),
    ).toEqual({ outcome: "denied", reason: "record_not_stored" });
  });

  it("binds the gate to the caller: tenant, scope, principal, purpose failures deny", () => {
    expect(
      authorizedMemoryView(record({ tenantRef: "tenant-2" }), gate(), NOW, caller()),
    ).toEqual({ outcome: "denied", reason: "tenant_mismatch" });
    expect(
      authorizedMemoryView(record({ scopeKey: "scope-beta" }), gate(), NOW, caller()),
    ).toEqual({ outcome: "denied", reason: "scope_mismatch" });
    expect(
      authorizedMemoryView(record(), gate(), NOW, caller({ principalRef: "principal:beta" })),
    ).toEqual({ outcome: "denied", reason: "principal_mismatch" });
    expect(
      authorizedMemoryView(record(), gate(), NOW, caller({ purposeRef: "purpose:other" })),
    ).toEqual({ outcome: "denied", reason: "purpose_mismatch" });
    expect(authorizedMemoryView(record(), gate(), AFTER_EXPIRY, caller())).toEqual({
      outcome: "denied",
      reason: "gate_expired",
    });
    expect(authorizedMemoryView(record(), gate({ decision: "deny" }), NOW, caller())).toEqual({
      outcome: "denied",
      reason: "decision_not_permitted",
    });
  });

  it("denies a redact decision at the record level (record reads need ALLOW)", () => {
    expect(
      authorizedMemoryView(
        record(),
        gate({ decision: "redact", redactionDirectives: ["x"] }),
        NOW,
        caller(),
      ),
    ).toEqual({ outcome: "denied", reason: "decision_not_permitted" });
  });

  it("denies records above the gate's sensitivity ceiling", () => {
    expect(
      authorizedMemoryView(
        record({ sensitivity: "restricted" }),
        gate({ sensitivityCeiling: "public" }),
        NOW,
        caller(),
      ),
    ).toEqual({ outcome: "denied", reason: "sensitivity_exceeds_clearance" });
  });

  it("opens content only behind a valid allow gate and returns a copy", () => {
    const view = authorizedMemoryView(record(), gate(), NOW, caller());
    expect(view.outcome).toBe("allowed");
    if (view.outcome === "allowed") {
      expect(view.recordId).toBe("record-alpha");
      expect(view.content).toEqual(record().content);
      expect(view.content).not.toBe(record().content);
    }
  });

  it("denies a malformed record with a typed reason", () => {
    expect(
      authorizedMemoryView({ ...record(), recordId: 7 } as unknown as MemoryRecord, gate(), NOW, caller()),
    ).toEqual({
      outcome: "denied",
      reason: "record_malformed",
    });
  });
});

/* ─────────────── AI disclosure (AGENTS §19) ─────────────── */

describe("AI disclosure is minimized, redacted and fail-closed", () => {
  const baseRecord = record();

  it("blocks without a gate", () => {
    expect(evaluateAiDisclosure(baseRecord, undefined, pipeline(), NOW)).toEqual({
      outcome: "blocked",
      reason: "no_gate_presented",
    });
  });

  it("blocks when any pipeline stage is incomplete", () => {
    for (const broken of [
      pipeline({ purposeAllowed: false }),
      pipeline({ minimized: false }),
      pipeline({ redacted: false }),
    ]) {
      expect(evaluateAiDisclosure(baseRecord, gate(), broken, NOW)).toEqual({
        outcome: "blocked",
        reason: "pipeline_incomplete",
      });
    }
  });

  it("blocks a malformed pipeline with a typed reason", () => {
    expect(
      evaluateAiDisclosure(baseRecord, gate(), { ...pipeline(), classification: "unknown" } as unknown as AiDisclosurePipeline, NOW),
    ).toEqual({ outcome: "blocked", reason: "pipeline_malformed" });
    expect(
      evaluateAiDisclosure(baseRecord, gate(), pipeline({ identityRef: "" }), NOW),
    ).toEqual({ outcome: "blocked", reason: "pipeline_malformed" });
  });

  it("blocks classification above the gate ceiling and records above the classification", () => {
    expect(
      evaluateAiDisclosure(baseRecord, gate({ sensitivityCeiling: "public" }), pipeline(), NOW),
    ).toEqual({ outcome: "blocked", reason: "classification_exceeds_clearance" });
    expect(
      evaluateAiDisclosure(record({ sensitivity: "restricted" }), gate(), pipeline(), NOW),
    ).toEqual({ outcome: "blocked", reason: "record_sensitivity_exceeds_classification" });
  });

  it("blocks retracted and expunged records", () => {
    expect(
      evaluateAiDisclosure(
        record({
          lifecycle: "expunged",
          expungedAt: NOW,
          content: undefined,
          validation: { state: "unvalidated", confidence: 0.1, evidenceLevel: "none", evidenceRefs: [] },
        }),
        gate(),
        pipeline(),
        NOW,
      ),
    ).toEqual({ outcome: "blocked", reason: "record_expunged" });
    expect(
      evaluateAiDisclosure(
        record({
          validation: {
            state: "retracted",
            confidence: 0.9,
            evidenceLevel: "verified",
            evidenceRefs: ["evidence:1"],
            retractionReason: "superseded by correction",
          },
        }),
        gate(),
        pipeline(),
        NOW,
      ),
    ).toEqual({ outcome: "blocked", reason: "record_retracted" });
  });

  it("blocks on tenant/scope mismatch and gate expiry", () => {
    expect(
      evaluateAiDisclosure(record({ tenantRef: "tenant-2" }), gate(), pipeline(), NOW),
    ).toEqual({ outcome: "blocked", reason: "tenant_mismatch" });
    expect(
      evaluateAiDisclosure(record({ scopeKey: "scope-beta" }), gate(), pipeline(), NOW),
    ).toEqual({ outcome: "blocked", reason: "scope_mismatch" });
    expect(evaluateAiDisclosure(baseRecord, gate(), pipeline(), AFTER_EXPIRY)).toEqual({
      outcome: "blocked",
      reason: "gate_expired",
    });
  });

  it("discloses metadata only — never record content", () => {
    const verdict = evaluateAiDisclosure(baseRecord, gate(), pipeline(), NOW);
    expect(verdict.outcome).toBe("disclosed");
    if (verdict.outcome === "disclosed") {
      expect(verdict.recordId).toBe("record-alpha");
      expect(verdict.redacted).toBe(true);
      expect(Object.keys(verdict).sort()).toEqual([
        "abstractionLevel",
        "aiContextRef",
        "outcome",
        "recordId",
        "redacted",
        "validationState",
      ]);
    }
  });
});

/* ─────────────── lifecycle transitions ─────────────── */

describe("lifecycle transitions are explicit and revision-carrying", () => {
  it("advances only along the legal chain", () => {
    let current = record({ lifecycle: "created", content: undefined, updatedAt: EARLIER });
    const chain: Array<[import("../../frontend/src/lib/memory-knowledge/contracts").MemoryLifecycleState, string]> = [
      ["processed", "processed"],
      ["validated", "validation applied"],
      ["stored", "stored"],
      ["active", "activated"],
    ];
    for (const [target, reason] of chain) {
      const result = applyLifecycleTransition(
        current,
        target,
        revision({
          previousLifecycle: current.lifecycle,
          newLifecycle: target,
          reason,
        }),
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.lifecycle).toBe(target);
        expect(result.value.updatedAt).toBe(NOW);
        current = result.value;
      }
    }
  });

  it("denies unknown transitions and terminal states", () => {
    const created = record({ lifecycle: "created" });
    expect(
      applyLifecycleTransition(created, "archived", revision({ newLifecycle: "archived" })),
    ).toEqual({ ok: false, error: "unknown_transition" });
    expect(
      applyLifecycleTransition(
        record({ lifecycle: "expunged", expungedAt: NOW, content: undefined }),
        "active",
        revision({ previousLifecycle: "expunged", newLifecycle: "active" }),
      ),
    ).toEqual({ ok: false, error: "unknown_transition" });
    expect(MEMORY_LIFECYCLE_TRANSITIONS.expunged).toEqual([]);
  });

  it("denies target equal to current, id mismatch and revision-state mismatch", () => {
    const active = record({ lifecycle: "active" });
    expect(
      applyLifecycleTransition(active, "active", revision({ previousLifecycle: "active", newLifecycle: "active" })),
    ).toEqual({ ok: false, error: "target_equals_current" });
    expect(
      applyLifecycleTransition(active, "superseded", revision({ recordId: "record-other", newLifecycle: "superseded" })),
    ).toEqual({ ok: false, error: "record_id_mismatch" });
    expect(
      applyLifecycleTransition(
        active,
        "superseded",
        revision({ previousLifecycle: "created", newLifecycle: "superseded" }),
      ),
    ).toEqual({ ok: false, error: "revision_previous_state_mismatch" });
    expect(
      applyLifecycleTransition(
        active,
        "superseded",
        revision({ previousLifecycle: "active", newLifecycle: "archived" }),
      ),
    ).toEqual({ ok: false, error: "revision_target_mismatch" });
  });

  it("denies malformed records and revisions with typed reasons", () => {
    expect(
      applyLifecycleTransition({ ...record(), tenantRef: "" } as unknown as MemoryRecord, "superseded", revision()),
    ).toEqual({ ok: false, error: "record_malformed" });
    expect(
      applyLifecycleTransition(record({ lifecycle: "created" }), "processed", { revisionId: "" } as unknown as KnowledgeRevision),
    ).toEqual({ ok: false, error: "revision_malformed" });
  });
});

/* ─────────────── governed forgetting ─────────────── */

describe("forgetting is approval-gated and genuine", () => {
  it("denies without an approval reference", () => {
    expect(
      executeForgettingAct(record(), forgettingAct({ approvalRef: "" })),
    ).toEqual({ ok: false, error: "missing_approval" });
  });

  it("denies id mismatch, malformed acts/records and double expungement", () => {
    expect(executeForgettingAct(record(), forgettingAct({ recordId: "record-other" }))).toEqual({
      ok: false,
      error: "record_id_mismatch",
    });
    expect(
      executeForgettingAct(record(), { ...forgettingAct(), mode: "archive" } as unknown as ForgettingAct),
    ).toEqual({ ok: false, error: "act_malformed" });
    expect(
      executeForgettingAct(
        record({ lifecycle: "expunged", expungedAt: NOW, content: undefined }),
        forgettingAct(),
      ),
    ).toEqual({ ok: false, error: "already_expunged" });
  });

  it("strips content, stamps expungement and emits a content-free tombstone", () => {
    const result = executeForgettingAct(record(), forgettingAct());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.record.lifecycle).toBe("expunged");
      expect(result.value.record.content).toBeUndefined();
      expect(result.value.record.expungedAt).toBe(NOW);
      expect("summary" in result.value.record).toBe(false);
      expect(result.value.tombstone).toEqual({
        tombstoneId: "act-0001",
        recordId: "record-alpha",
        expungedAt: NOW,
        approvalRef: "approval:forget-1",
        executedByRef: "operator:alpha",
        contentRemoved: true,
      });
      expect(parseMemoryRecord(result.value.record).ok).toBe(true);
    }
  });

  it("leaves the expunged record unreachable through every read surface", () => {
    const result = executeForgettingAct(record(), forgettingAct());
    if (result.ok) {
      const expunged = result.value.record;
      expect(authorizedMemoryView(expunged, gate(), NOW, caller())).toEqual({
        outcome: "denied",
        reason: "record_expunged",
      });
      expect(
        evaluateAiDisclosure(expunged, gate(), pipeline(), NOW),
      ).toEqual({ outcome: "blocked", reason: "record_expunged" });
      expect(
        applyLifecycleTransition(expunged, "active", revision({ previousLifecycle: "expunged", newLifecycle: "active" })),
      ).toEqual({ ok: false, error: "unknown_transition" });
    }
  });
});

/* ─────────────── purity ─────────────── */

describe("purity: injected time and immutable inputs", () => {
  it("never mutates inputs", () => {
    const sourceRecord = record();
    const sourceGate = gate();
    const sourcePipeline = pipeline();
    const sourceAct = forgettingAct();
    const before = JSON.stringify([sourceRecord, sourceGate, sourcePipeline, sourceAct]);

    authorizedMemoryView(sourceRecord, sourceGate, NOW, caller());
    evaluateAiDisclosure(sourceRecord, sourceGate, sourcePipeline, NOW);
    executeForgettingAct(sourceRecord, sourceAct);
    applyLifecycleTransition(
      sourceRecord,
      "superseded",
      revision({ previousLifecycle: "active", newLifecycle: "superseded" }),
    );

    const after = JSON.stringify([sourceRecord, sourceGate, sourcePipeline, sourceAct]);
    expect(after).toBe(before);
  });

  it("is driven entirely by injected instants — same inputs, different now, different verdict", () => {
    const request = {
      scopeKey: "scope-alpha",
      tenantRef: "tenant-1",
      principalRef: "principal:alpha",
      purposeRef: "purpose:ops",
    };
    expect(evaluateRecallRequest(request, gate(), NOW).outcome).toBe("allowed");
    expect(evaluateRecallRequest(request, gate(), AFTER_EXPIRY)).toEqual({
      outcome: "denied",
      reason: "gate_expired",
    });
  });
});