/**
 * CoreGrid — H3-074 adversarial verification suite, phase 36 memory-knowledge
 * (Squad G, Verifier role; campaign H3-WAVE-CAMPAIGN.md, mission G-074).
 *
 * Adversarial verification against the COMPLETED contract module
 * `frontend/src/lib/memory-knowledge/contracts.ts` (landed by H3-056 — imported
 * READ-ONLY, never modified). This suite deepens — never duplicates — the
 * H3-056 suite by attacking the contract instead of exercising it:
 *
 * 1. RECALL-GATE REPLAY across principals/purposes/tenants/scopes/time — a
 *    gate issued once must open nothing for any other binding.
 * 2. GATE FORGERY — malformed, smuggled, unattributed and self-issued gates.
 * 3. CONTENT EXFILTRATION VIA ALLOW VERDICTS — allowed scopes must never carry
 *    content; every verdict is canary-scanned for record material.
 * 4. DISCLOSURE-PIPELINE BYPASS — skipping minimization/redaction stages,
 *    verdict-as-gate laundering, tombstone-as-record laundering.
 * 5. GOVERNED-FORGETTING RESURRECTION — every path back from expungement.
 * 6. RETENTION-BOUND ESCAPE — reading past a bounded retention expiry.
 *
 * FINDINGS (recorded, NOT fixed — the module is read-only for this mission):
 * - FINDING H3-074-F1: an expired bounded-retention record remains readable
 *   (`authorizedMemoryView`) and disclosable (`evaluateAiDisclosure`) behind a
 *   valid gate — the module's own posture header claims "expired retention …
 *   fail[s] closed with a typed reason", but no read surface compares
 *   `record.retention.expiresAt` to the injected `now`.
 * - FINDING H3-074-F2: the lifecycle path `archived → expunged`
 *   (`applyLifecycleTransition` with an approval-carrying revision) returns a
 *   record that STILL CARRIES `content` — contradicting the "forgetting is
 *   genuine" invariant; the produced record even fails the module's own
 *   `parseMemoryRecord`. Read surfaces contain it (parse-first denial), but the
 *   material is not stripped as it is on `executeForgettingAct`.
 * - FINDING H3-074-F3: a fully forged but schema-valid gate is
 *   indistinguishable from an issued gate at this layer; containment relies
 *   entirely on the documented server-side issuance boundary (AGENTS §15/§17 —
 *   this contract is one layer, never the only one).
 *
 * Hard law honored: no git, no database/network, no secrets, no `any`, strict
 * TypeScript, pure offline assertions only.
 */
import { describe, expect, it } from "vitest";
import {
  MEMORY_LIFECYCLE_STATES,
  applyLifecycleTransition,
  authorizedMemoryView,
  evaluateAiDisclosure,
  evaluateRecallRequest,
  executeForgettingAct,
  parseAuthorizationGate,
  parseMemoryRecord,
  type AiDisclosurePipeline,
  type AuthorizedMemoryView,
  type ForgettingAct,
  type KnowledgeRevision,
  type MemoryAuthorizationGate,
  type MemoryCallerContext,
  type MemoryLifecycleState,
  type MemoryRecord,
  type MemoryRecallRequest,
} from "../../frontend/src/lib/memory-knowledge/contracts";

const NOW = "2026-10-03T00:00:00.000Z";
const EARLIER = "2026-10-02T00:00:00.000Z";
const LATER = "2026-10-03T12:00:00.000Z";
const AFTER_EXPIRY = "2026-10-04T00:00:00.000Z";

/** Canary material planted in record content; no verdict may ever echo it. */
const CANARY = "CANARY-EXFIL-074-classified-material";

/* ─────────────── fixture builders (suite-local, H3-056-independent) ─────── */

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
    content: {
      summary: `Classified summary: ${CANARY}.`,
      payloadRefs: [`payload:${CANARY}`],
    },
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

function request(overrides: Partial<MemoryRecallRequest> = {}): MemoryRecallRequest {
  return {
    scopeKey: "scope-alpha",
    tenantRef: "tenant-1",
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
  overrides: Partial<KnowledgeRevision> = {},
): KnowledgeRevision {
  return {
    revisionId: "rev-0001",
    recordId: "record-alpha",
    reason: "adversarial revision",
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

/** Case-insensitive serialization scan for canary leakage. */
function leaksCanary(value: unknown): boolean {
  return (JSON.stringify(value) ?? "").toLowerCase().includes(CANARY.toLowerCase());
}

/* ─────────────── 1. recall-gate replay across principals/purposes ──────── */

describe("recall-gate replay across principals and purposes", () => {
  const validGate = gate();

  it("a successful ALLOW gate replayed by another principal opens nothing", () => {
    expect(evaluateRecallRequest(request(), validGate, NOW).outcome).toBe("allowed");
    expect(evaluateRecallRequest(request({ principalRef: "principal:beta" }), validGate, NOW)).toEqual({
      outcome: "denied",
      reason: "principal_mismatch",
    });
  });

  it("a successful ALLOW gate replayed under another purpose opens nothing", () => {
    expect(evaluateRecallRequest(request({ purposeRef: "purpose:audit" }), validGate, NOW)).toEqual({
      outcome: "denied",
      reason: "purpose_mismatch",
    });
  });

  it("replay across tenants and scopes is denied with the matching typed reason", () => {
    expect(evaluateRecallRequest(request({ tenantRef: "tenant-9" }), validGate, NOW)).toEqual({
      outcome: "denied",
      reason: "tenant_mismatch",
    });
    expect(evaluateRecallRequest(request({ scopeKey: "scope-beta" }), validGate, NOW)).toEqual({
      outcome: "denied",
      reason: "scope_mismatch",
    });
  });

  it("simultaneous principal+purpose+tenant replay is still denied (never clamped to allow)", () => {
    const replayed = evaluateRecallRequest(
      request({ principalRef: "principal:beta", purposeRef: "purpose:audit", tenantRef: "tenant-9" }),
      validGate,
      NOW,
    );
    expect(replayed.outcome).toBe("denied");
    if (replayed.outcome === "denied") {
      expect(["principal_mismatch", "purpose_mismatch", "tenant_mismatch"]).toContain(replayed.reason);
    }
  });

  it("a REDACT gate replayed under another purpose leaks no directives", () => {
    const redactGate = gate({ decision: "redact", redactionDirectives: ["strip-identifiers"] });
    const verdict = evaluateRecallRequest(request({ purposeRef: "purpose:audit" }), redactGate, NOW);
    expect(verdict).toEqual({ outcome: "denied", reason: "purpose_mismatch" });
    expect(leaksCanary(verdict)).toBe(false);
  });

  it("each binding dimension is re-verified on every replay — no stateful grant", () => {
    const dimensions: Array<Partial<MemoryRecallRequest>> = [
      { principalRef: "principal:beta" },
      { purposeRef: "purpose:audit" },
      { tenantRef: "tenant-9" },
      { scopeKey: "scope-beta" },
    ];
    for (const dim of dimensions) {
      const verdict = evaluateRecallRequest(request(dim), validGate, NOW);
      expect(verdict.outcome).toBe("denied");
    }
  });

  it("a gate replayed at the exact expiry instant is denied (no grace window)", () => {
    expect(evaluateRecallRequest(request(), validGate, LATER)).toEqual({
      outcome: "denied",
      reason: "gate_expired",
    });
    expect(evaluateRecallRequest(request(), validGate, AFTER_EXPIRY)).toEqual({
      outcome: "denied",
      reason: "gate_expired",
    });
  });

  it("caller-context replay against a record view denies swapped principals and purposes", () => {
    expect(authorizedMemoryView(record(), validGate, NOW, caller({ principalRef: "principal:beta" }))).toEqual({
      outcome: "denied",
      reason: "principal_mismatch",
    });
    expect(authorizedMemoryView(record(), validGate, NOW, caller({ purposeRef: "purpose:audit" }))).toEqual({
      outcome: "denied",
      reason: "purpose_mismatch",
    });
    expect(
      authorizedMemoryView(
        record(),
        validGate,
        NOW,
        caller({ principalRef: "principal:beta", purposeRef: "purpose:audit" }),
      ),
    ).toEqual({ outcome: "denied", reason: "principal_mismatch" });
  });

  it("a gate replayed into AI disclosure under a different purpose is denied", () => {
    expect(
      evaluateAiDisclosure(record(), validGate, pipeline({ purposeRef: "purpose:audit" }), NOW),
    ).toEqual({ outcome: "blocked", reason: "purpose_mismatch" });
  });
});

/* ───────────────────────── 2. gate forgery ─────────────────────────────── */

describe("gate forgery is contained with typed denials", () => {
  it("extra smuggled properties make the gate structurally invalid", () => {
    const forged = {
      ...gate(),
      exfilChannel: CANARY,
    } as unknown as MemoryAuthorizationGate;
    expect(parseAuthorizationGate(forged).ok).toBe(false);
    expect(evaluateRecallRequest(request(), forged, NOW)).toEqual({
      outcome: "denied",
      reason: "gate_malformed",
    });
    expect(authorizedMemoryView(record(), forged, NOW, caller())).toEqual({
      outcome: "denied",
      reason: "gate_malformed",
    });
  });

  it("redaction directives smuggled onto an ALLOW decision are rejected", () => {
    const smuggled = gate({ decision: "allow", redactionDirectives: ["strip-everything"] });
    expect(parseAuthorizationGate(smuggled).ok).toBe(false);
    expect(authorizedMemoryView(record(), smuggled, NOW, caller())).toEqual({
      outcome: "denied",
      reason: "gate_malformed",
    });
  });

  it("a REDACT decision without directives is rejected as a gate", () => {
    const directiveless = gate({ decision: "redact", redactionDirectives: [] });
    expect(parseAuthorizationGate(directiveless).ok).toBe(false);
    expect(evaluateRecallRequest(request(), directiveless, NOW)).toEqual({
      outcome: "denied",
      reason: "gate_malformed",
    });
  });

  it("DENY / ESCALATE / REQUIRE_APPROVAL decisions never open content", () => {
    for (const decision of ["deny", "escalate", "require_approval"] as const) {
      const forgedGate = gate({ decision });
      expect(authorizedMemoryView(record(), forgedGate, NOW, caller())).toEqual({
        outcome: "denied",
        reason: "decision_not_permitted",
      });
      expect(evaluateAiDisclosure(record(), forgedGate, pipeline(), NOW)).toEqual({
        outcome: "blocked",
        reason: "decision_not_permitted",
      });
    }
  });

  it("an unattributed or untraceable gate (blank authority/trace) is malformed", () => {
    expect(authorizedMemoryView(record(), gate({ authorityRef: "" }), NOW, caller())).toEqual({
      outcome: "denied",
      reason: "gate_malformed",
    });
    expect(authorizedMemoryView(record(), gate({ traceId: "" }), NOW, caller())).toEqual({
      outcome: "denied",
      reason: "gate_malformed",
    });
    expect(authorizedMemoryView(record(), gate({ gateId: "" }), NOW, caller())).toEqual({
      outcome: "denied",
      reason: "gate_malformed",
    });
  });

  it("a forged unknown sensitivity ceiling cannot be escalated into an allow", () => {
    const escalated = {
      ...gate(),
      sensitivityCeiling: "cosmic",
    } as unknown as MemoryAuthorizationGate;
    expect(evaluateRecallRequest(request(), escalated, NOW)).toEqual({
      outcome: "denied",
      reason: "gate_malformed",
    });
    expect(authorizedMemoryView(record(), escalated, NOW, caller())).toEqual({
      outcome: "denied",
      reason: "gate_malformed",
    });
  });

  it("a zero-length gate lifetime (decidedAt === expiresAt) is malformed — no eternal gate", () => {
    const eternal = gate({ decidedAt: LATER, expiresAt: LATER });
    expect(parseAuthorizationGate(eternal).ok).toBe(false);
    expect(authorizedMemoryView(record(), eternal, LATER, caller())).toEqual({
      outcome: "denied",
      reason: "gate_malformed",
    });
  });

  it("FINDING H3-074-F3 — a fully forged but schema-valid gate is indistinguishable from an issued gate", () => {
    const forgedGate: MemoryAuthorizationGate = gate({
      gateId: "gate-forged",
      authorityRef: "authority:self-attested",
      traceId: "trace:forged",
    });
    expect(parseAuthorizationGate(forgedGate).ok).toBe(true);
    const view = authorizedMemoryView(record(), forgedGate, NOW, caller());
    expect(view.outcome).toBe("allowed");
    if (view.outcome === "allowed") {
      expect(view.content).toEqual(record().content);
    }
    if (view.outcome === "allowed") {
      expect(leaksCanary(view)).toBe(true);
    }
  });
});

/* ─────────────── 3. content exfiltration via ALLOW verdicts ────────────── */

describe("ALLOW verdicts never carry record content (canary sweeps)", () => {
  const canaryRecord = record();

  it("an ALLOW recall verdict carries only the bounded scope — exact shape", () => {
    const verdict = evaluateRecallRequest(request(), gate(), NOW);
    expect(verdict.outcome).toBe("allowed");
    if (verdict.outcome === "allowed") {
      expect(Object.keys(verdict).sort()).toEqual(["boundedScope", "gateId", "outcome", "traceId"]);
      expect(Object.keys(verdict.boundedScope).sort()).toEqual([
        "principalRef",
        "purposeRef",
        "scopeKey",
        "tenantRef",
      ]);
    }
    expect(leaksCanary(verdict)).toBe(false);
  });

  it("a REDACT recall verdict carries only directives — exact shape, no canary", () => {
    const verdict = evaluateRecallRequest(
      request(),
      gate({ decision: "redact", redactionDirectives: ["strip-identifiers"] }),
      NOW,
    );
    expect(verdict.outcome).toBe("redacted");
    if (verdict.outcome === "redacted") {
      expect(Object.keys(verdict).sort()).toEqual([
        "gateId",
        "outcome",
        "redactionDirectives",
        "traceId",
      ]);
    }
    expect(leaksCanary(verdict)).toBe(false);
  });

  it("every recall DENIAL echoes no content", () => {
    const denials = [
      evaluateRecallRequest(request({ tenantRef: "tenant-2" }), gate(), NOW),
      evaluateRecallRequest(request(), undefined, NOW),
      evaluateRecallRequest(request(), gate(), AFTER_EXPIRY),
    ];
    for (const verdict of denials) {
      expect(verdict.outcome).toBe("denied");
      expect(leaksCanary(verdict)).toBe(false);
    }
  });

  it("an ALLOWED memory view carries content but no payloadRefs and no canary in metadata fields", () => {
    const view = authorizedMemoryView(canaryRecord, gate(), NOW, caller());
    expect(view.outcome).toBe("allowed");
    if (view.outcome === "allowed") {
      expect(Object.keys(view).sort()).toEqual([
        "abstractionLevel",
        "content",
        "gateId",
        "outcome",
        "recordId",
        "sensitivity",
        "traceId",
        "validationState",
      ]);
      expect(leaksCanary({ ...view, content: undefined })).toBe(false);
    }
  });

  it("a DISCLOSED verdict is metadata-only — canary never crosses the AI boundary", () => {
    const verdict = evaluateAiDisclosure(canaryRecord, gate(), pipeline(), NOW);
    expect(verdict.outcome).toBe("disclosed");
    if (verdict.outcome === "disclosed") {
      expect(Object.keys(verdict).sort()).toEqual([
        "abstractionLevel",
        "aiContextRef",
        "outcome",
        "recordId",
        "redacted",
        "validationState",
      ]);
    }
    expect(leaksCanary(verdict)).toBe(false);
  });

  it("a tombstone carries the fact of removal — never the removed material", () => {
    const result = executeForgettingAct(canaryRecord, forgettingAct());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tombstone.contentRemoved).toBe(true);
      expect(leaksCanary(result.value.tombstone)).toBe(false);
      expect(leaksCanary(result.value.record)).toBe(false);
    }
  });
});

/* ─────────────────── 4. disclosure-pipeline bypass ─────────────────────── */

describe("disclosure-pipeline bypass attempts are blocked", () => {
  it("every partial pipeline (any skipped stage of purpose/minimize/redact) is blocked", () => {
    const flags = [true, false] as const;
    let incompleteCombinations = 0;
    for (const purposeAllowed of flags) {
      for (const minimized of flags) {
        for (const redacted of flags) {
          const p = pipeline({ purposeAllowed, minimized, redacted });
          const verdict = evaluateAiDisclosure(record(), gate(), p, NOW);
          if (!purposeAllowed || !minimized || !redacted) {
            incompleteCombinations += 1;
            expect(verdict).toEqual({ outcome: "blocked", reason: "pipeline_incomplete" });
          } else {
            expect(verdict.outcome).toBe("disclosed");
          }
        }
      }
    }
    expect(incompleteCombinations).toBe(7);
  });

  it("the pipeline parser is shape-only: a stage-skipping pipeline still cannot disclose", () => {
    const skipped = pipeline({ minimized: false, redacted: false });
    expect(parseAuthorizationGate(gate()).ok).toBe(true);
    const verdict = evaluateAiDisclosure(record(), gate(), skipped, NOW);
    expect(verdict).toEqual({ outcome: "blocked", reason: "pipeline_incomplete" });
  });

  it("an under-classified pipeline (record above declared classification) is blocked", () => {
    const restrictedRecord = record({ sensitivity: "restricted" });
    const underclassified = pipeline({ classification: "public" });
    expect(
      evaluateAiDisclosure(restrictedRecord, gate({ sensitivityCeiling: "restricted" }), underclassified, NOW),
    ).toEqual({ outcome: "blocked", reason: "record_sensitivity_exceeds_classification" });
  });

  it("a pipeline classified above the gate ceiling is blocked even for a public record", () => {
    expect(
      evaluateAiDisclosure(
        record({ sensitivity: "public" }),
        gate({ sensitivityCeiling: "public" }),
        pipeline({ classification: "restricted" }),
        NOW,
      ),
    ).toEqual({ outcome: "blocked", reason: "classification_exceeds_clearance" });
  });

  it("bypassing the gate entirely blocks even with a perfect pipeline", () => {
    expect(evaluateAiDisclosure(record(), undefined, pipeline(), NOW)).toEqual({
      outcome: "blocked",
      reason: "no_gate_presented",
    });
  });

  it("pipeline-incomplete combined with a forged gate is still blocked (no order games)", () => {
    expect(
      evaluateAiDisclosure(record(), gate({ decision: "deny" }), pipeline({ minimized: false }), NOW),
    ).toEqual({ outcome: "blocked", reason: "pipeline_incomplete" });
    expect(
      evaluateAiDisclosure(record(), gate({ decision: "deny" }), pipeline(), NOW),
    ).toEqual({ outcome: "blocked", reason: "decision_not_permitted" });
  });

  it("an ALLOW recall verdict cannot be laundered into a gate", () => {
    const verdict = evaluateRecallRequest(request(), gate(), NOW);
    expect(verdict.outcome).toBe("allowed");
    const verdictAsGate = verdict as unknown as MemoryAuthorizationGate;
    expect(authorizedMemoryView(record(), verdictAsGate, NOW, caller())).toEqual({
      outcome: "denied",
      reason: "gate_malformed",
    });
    const boundedScopeAsGate = (verdict as { boundedScope: unknown }).boundedScope;
    expect(
      authorizedMemoryView(record(), boundedScopeAsGate as unknown as MemoryAuthorizationGate, NOW, caller()),
    ).toEqual({ outcome: "denied", reason: "gate_malformed" });
  });

  it("a tombstone cannot be laundered into a record or a gate", () => {
    const result = executeForgettingAct(record(), forgettingAct());
    expect(result.ok).toBe(true);
    if (result.ok) {
      const tombstone = result.value.tombstone;
      expect(
        authorizedMemoryView(tombstone as unknown as MemoryRecord, gate(), NOW, caller()),
      ).toEqual({ outcome: "denied", reason: "record_malformed" });
      expect(
        evaluateAiDisclosure(tombstone as unknown as MemoryRecord, gate(), pipeline(), NOW),
      ).toEqual({ outcome: "blocked", reason: "record_malformed" });
      expect(
        authorizedMemoryView(record(), tombstone as unknown as MemoryAuthorizationGate, NOW, caller()),
      ).toEqual({ outcome: "denied", reason: "gate_malformed" });
    }
  });
});

/* ─────────────────── 5. governed-forgetting resurrection ───────────────── */

describe("governed-forgetting resurrection attempts are contained", () => {
  function expungedFromAct(): { expunged: MemoryRecord } {
    const result = executeForgettingAct(record(), forgettingAct());
    if (!result.ok) {
      throw new Error("fixture failure: forgetting act unexpectedly denied");
    }
    return { expunged: result.value.record };
  }

  it("exhaustive transition sweep: no lifecycle state revives an expunged record", () => {
    const { expunged } = expungedFromAct();
    for (const target of MEMORY_LIFECYCLE_STATES as readonly MemoryLifecycleState[]) {
      const attempt = applyLifecycleTransition(
        expunged,
        target,
        revision({ previousLifecycle: "expunged", newLifecycle: target }),
      );
      if (target === "expunged") {
        // A self-referential expungement revision is malformed before the
        // transition table is even consulted (approvalRef mandatory).
        expect(attempt).toEqual({ ok: false, error: "revision_malformed" });
      } else {
        expect(attempt).toEqual({ ok: false, error: "unknown_transition" });
      }
    }
  });

  it("re-injecting content into an expunged record fails its own schema and every read surface", () => {
    const { expunged } = expungedFromAct();
    const resurrected = { ...expunged, content: record().content } as unknown as MemoryRecord;
    expect(parseMemoryRecord(resurrected).ok).toBe(false);
    expect(authorizedMemoryView(resurrected, gate(), NOW, caller())).toEqual({
      outcome: "denied",
      reason: "record_malformed",
    });
    expect(evaluateAiDisclosure(resurrected, gate(), pipeline(), NOW)).toEqual({
      outcome: "blocked",
      reason: "record_malformed",
    });
  });

  it("a second forgetting act on an expunged record is denied", () => {
    const { expunged } = expungedFromAct();
    expect(executeForgettingAct(expunged, forgettingAct())).toEqual({
      ok: false,
      error: "already_expunged",
    });
  });

  it("whitespace-only approval references are semantically denied", () => {
    for (const approvalRef of ["   ", "\t\n ", "\u00a0"]) {
      expect(executeForgettingAct(record(), forgettingAct({ approvalRef }))).toEqual({
        ok: false,
        error: "missing_approval",
      });
    }
  });

  it("a revision driving expungement without an approvalRef is malformed", () => {
    const archived = record({ lifecycle: "archived" });
    expect(
      applyLifecycleTransition(
        archived,
        "expunged",
        revision({ previousLifecycle: "archived", newLifecycle: "expunged", approvalRef: undefined }),
      ),
    ).toEqual({ ok: false, error: "revision_malformed" });
  });

  it("FINDING H3-074-F2 — the lifecycle expungement path retains content on the returned record", () => {
    const archived = record({ lifecycle: "archived" });
    const result = applyLifecycleTransition(
      archived,
      "expunged",
      revision({ previousLifecycle: "archived", newLifecycle: "expunged", approvalRef: "approval:forget-2" }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.lifecycle).toBe("expunged");
      expect(result.value.content).toBeDefined();
      expect(leaksCanary(result.value)).toBe(true);
      expect(parseMemoryRecord(result.value).ok).toBe(false);
      expect(authorizedMemoryView(result.value, gate(), NOW, caller())).toEqual({
        outcome: "denied",
        reason: "record_malformed",
      });
      expect(evaluateAiDisclosure(result.value, gate(), pipeline(), NOW)).toEqual({
        outcome: "blocked",
        reason: "record_malformed",
      });
    }
  });
});

/* ───────────────────── 6. retention-bound escape ───────────────────────── */

describe("retention-bound escape attempts", () => {
  const expiredRetentionRecord = record({
    createdAt: "2026-09-01T00:00:00.000Z",
    retention: { rule: "bounded", expiresAt: "2026-10-01T00:00:00.000Z" },
  });

  it("an expired-retention record is still schema-valid (shape layer only)", () => {
    expect(parseMemoryRecord(expiredRetentionRecord).ok).toBe(true);
  });

  it("FINDING H3-074-F1 — an expired-retention record remains readable behind a valid gate", () => {
    const view = authorizedMemoryView(expiredRetentionRecord, gate(), NOW, caller());
    expect(view.outcome).toBe("allowed");
    if (view.outcome === "allowed") {
      expect(view.content).toEqual(expiredRetentionRecord.content);
      expect(leaksCanary(view)).toBe(true);
    }
  });

  it("FINDING H3-074-F1 — an expired-retention record remains disclosable to AI behind a valid gate", () => {
    const verdict = evaluateAiDisclosure(expiredRetentionRecord, gate(), pipeline(), NOW);
    expect(verdict.outcome).toBe("disclosed");
  });

  it("containment that holds: an expired-retention record still requires a valid gate", () => {
    expect(authorizedMemoryView(expiredRetentionRecord, undefined, NOW, caller())).toEqual({
      outcome: "denied",
      reason: "no_gate_presented",
    });
    expect(authorizedMemoryView(expiredRetentionRecord, gate(), AFTER_EXPIRY, caller())).toEqual({
      outcome: "denied",
      reason: "gate_expired",
    });
    expect(evaluateRecallRequest(request(), undefined, NOW)).toEqual({
      outcome: "denied",
      reason: "no_gate_presented",
    });
  });

  it("containment that holds: unbounded retention without approval cannot parse as a record", () => {
    expect(
      parseMemoryRecord(record({ retention: { rule: "unbounded" } })).ok,
    ).toBe(false);
    expect(
      parseMemoryRecord(
        record({ retention: { rule: "unbounded", approvalRef: "approval:retain", expiresAt: LATER } }),
      ).ok,
    ).toBe(false);
  });
});

/* ───────────────────── type-level regression guard ─────────────────────── */

describe("verdict typing regression guard", () => {
  it("denial reasons stay in the documented typed unions", () => {
    const denied: AuthorizedMemoryView = authorizedMemoryView(
      record(),
      undefined,
      NOW,
      caller(),
    );
    expect(denied).toEqual({ outcome: "denied", reason: "no_gate_presented" });
  });
});
