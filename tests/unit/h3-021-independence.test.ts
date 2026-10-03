/**
 * CoreGrid — H3-021 (J-035) Independence Enforcer.
 *
 * Proof suite for the verification-independence enforcement contract in
 * `frontend/src/lib/assurance/independence-enforcement.ts` (Constitution
 * §7, §12, §15, §16, §18, §21). Invariants under test:
 *
 * - J-035 / E-050: a worker — AI or human — can never be the independent
 *   verifier of its own output. Self-verification is a PROVEN dependence
 *   ("dependent"), never a pass.
 * - Relationship independence: an ACTIVE authority or delegation
 *   relationship binding the verifier and the performer in either
 *   direction is a proven dependence; an EXPIRED or REVOKED one is proven
 *   dead and does not defeat independence.
 * - Fail closed on unknown relationships (§16): an unknown relationship
 *   type, an unparseable lifecycle instant on a binding-candidate record,
 *   a malformed record, and an evidence set the caller cannot certify as
 *   complete all BLOCK — "unresolvable" is never upgraded to "independent".
 * - Composition: performer-of-record resolution, the self-verification
 *   identity check and the classification vocabulary are the sibling
 *   assurance module's (`./verification-independence`); the relationship
 *   vocabulary is the identity model's (`../identity`). This suite proves
 *   the composition, not a fork: e.g. an ambiguous performer blocks, a
 *   single-candidate ambiguity resolves, and shared membership is NOT a
 *   dependence.
 * - Provenance and audit (§12/§18): every determination — confirmed AND
 *   denied — returns an audit record; classification ("was it AI?") is
 *   recorded on every path and is never an authority axis.
 *
 * All instants are fixed literals — the suite is offline and wall-clock
 * independent. No database, no network, no secrets.
 */
import { describe, expect, it } from "vitest";
import {
  BINDING_RELATIONSHIP_TYPES,
  classifyRelationshipType,
  enforceIndependence,
  independenceAllows,
  relationshipStatusAt,
  scanBindingRelationships,
  type IndependenceCheckInput,
  type RelationshipEvidence,
} from "@/lib/assurance/independence-enforcement";
import { isSelfVerification } from "@/lib/assurance/verification-independence";
import { RELATIONSHIP_TYPES } from "@/lib/identity";

/* ─────────────────────────────────────────────────────────────
 * Fixtures — fixed instants, offline and deterministic
 * ────────────────────────────────────────────────────────────*/

const TENANT = "tenant-1";
const POLICY = "policy:verification-independence:1.0";
const ITEM = "work-item-77";

const HUMAN_WORKER = "worker-human-001";
const AI_WORKER = "agent-worker-002";
const INDEPENDENT_HUMAN = "verifier-human-003";
const INDEPENDENT_AI = "agent-verifier-004";

const T0 = "2026-10-01T00:00:00.000Z";
const EVAL = "2026-10-03T00:00:00.000Z";
const PAST = "2026-10-02T00:00:00.000Z";
const FUTURE = "2026-10-04T00:00:00.000Z";

function relationship(overrides: Partial<RelationshipEvidence> = {}): RelationshipEvidence {
  return {
    relationshipId: "rel-001",
    subjectId: HUMAN_WORKER,
    type: "manages",
    targetId: INDEPENDENT_HUMAN,
    scope: null,
    createdAt: T0,
    expiresAt: null,
    revokedAt: null,
    version: 1,
    ...overrides,
  };
}

function baseInput(overrides: Partial<IndependenceCheckInput> = {}): IndependenceCheckInput {
  return {
    itemId: ITEM,
    tenantScope: TENANT,
    policyRef: POLICY,
    verifier: { identityRef: INDEPENDENT_HUMAN, classification: "human" },
    performerOfRecord: { status: "recorded", identityRef: HUMAN_WORKER },
    relationshipEvidence: [],
    evidenceCompleteness: "complete",
    evaluatedAt: EVAL,
    ...overrides,
  };
}

/* ─────────────────────────────────────────────────────────────
 * The invariant: no worker verifies its own output (J-035/E-050)
 * ────────────────────────────────────────────────────────────*/

describe("H3-021 — identity independence (J-035 / E-050)", () => {
  it("denies a human worker verifying its own output as a proven dependence", () => {
    const result = enforceIndependence(
      baseInput({ verifier: { identityRef: HUMAN_WORKER, classification: "human" } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.outcome).toBe("dependent");
      expect(result.denyReason).toBe("self_verification_denied");
      expect(result.audit.selfVerificationAttempt).toBe(true);
    }
  });

  it("denies an AI worker verifying its own output — the law binds kind, not just humans", () => {
    const result = enforceIndependence(
      baseInput({
        verifier: { identityRef: AI_WORKER, classification: "ai" },
        performerOfRecord: { status: "recorded", identityRef: AI_WORKER },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.outcome).toBe("dependent");
      expect(result.denyReason).toBe("self_verification_denied");
      expect(result.audit.verifierClassification).toBe("ai");
      expect(result.audit.selfVerificationAttempt).toBe(true);
    }
  });

  it("denies self-verification after identity whitespace normalization", () => {
    const result = enforceIndependence(
      baseInput({
        verifier: { identityRef: `  ${HUMAN_WORKER}  `, classification: "human" },
        performerOfRecord: { status: "recorded", identityRef: HUMAN_WORKER },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.denyReason).toBe("self_verification_denied");
  });

  it("composes the sibling module's identity check (no fork)", () => {
    expect(isSelfVerification(AI_WORKER, AI_WORKER)).toBe(true);
    expect(isSelfVerification(INDEPENDENT_AI, HUMAN_WORKER)).toBe(false);
  });

  it("confirms a distinct independent verifier with no relationship evidence", () => {
    const result = enforceIndependence(
      baseInput({ verifier: { identityRef: INDEPENDENT_AI, classification: "ai" } }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outcome).toBe("independent");
      expect(result.audit.eventKind).toBe("independence_confirmed");
      expect(result.audit.denyReason).toBeNull();
      expect(result.audit.verifierClassification).toBe("ai");
      expect(result.audit.performerOfRecordRef).toBe(HUMAN_WORKER);
      expect(result.audit.selfVerificationAttempt).toBe(false);
    }
  });

  it("treats classification as provenance only — an unclassified verifier is evaluable", () => {
    const result = enforceIndependence(
      baseInput({ verifier: { identityRef: INDEPENDENT_HUMAN, classification: "unclassified" } }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.audit.verifierClassification).toBe("unclassified");
  });
});

/* ─────────────────────────────────────────────────────────────
 * Performer of record must resolve before independence is evaluable
 * ────────────────────────────────────────────────────────────*/

describe("H3-021 — performer-of-record resolution (fail closed)", () => {
  it("blocks when the performer of record is unrecorded", () => {
    const result = enforceIndependence(
      baseInput({ performerOfRecord: { status: "unrecorded" } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.outcome).toBe("blocked");
      expect(result.denyReason).toBe("performer_of_record_unrecorded");
      expect(result.audit.performerOfRecordRef).toBeNull();
    }
  });

  it("blocks when the performer of record is ambiguous", () => {
    const result = enforceIndependence(
      baseInput({
        performerOfRecord: {
          status: "ambiguous",
          candidates: [HUMAN_WORKER, AI_WORKER],
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.denyReason).toBe("performer_of_record_ambiguous");
  });

  it("composes the sibling resolution: a recorded performer with a blank ref downgrades to unrecorded", () => {
    const result = enforceIndependence(
      baseInput({ performerOfRecord: { status: "recorded", identityRef: "   " } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.denyReason).toBe("performer_of_record_unrecorded");
  });

  it("composes the sibling resolution: a single-candidate ambiguity resolves to recorded", () => {
    const result = enforceIndependence(
      baseInput({
        performerOfRecord: { status: "ambiguous", candidates: [HUMAN_WORKER] },
        verifier: { identityRef: INDEPENDENT_AI, classification: "ai" },
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.audit.performerOfRecordRef).toBe(HUMAN_WORKER);
  });

  it("blocks a blank verifier reference", () => {
    const result = enforceIndependence(
      baseInput({ verifier: { identityRef: "   ", classification: "human" } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.denyReason).toBe("verifier_identity_unrecorded");
  });
});

/* ─────────────────────────────────────────────────────────────
 * Binding relationships defeat independence (both directions)
 * ────────────────────────────────────────────────────────────*/

describe("H3-021 — binding relationships defeat independence", () => {
  for (const type of BINDING_RELATIONSHIP_TYPES) {
    it(`denies independence under an active "${type}" relationship (verifier -> performer)`, () => {
      const result = enforceIndependence(
        baseInput({
          relationshipEvidence: [
            relationship({ subjectId: INDEPENDENT_HUMAN, targetId: HUMAN_WORKER, type }),
          ],
        }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.outcome).toBe("dependent");
        expect(result.denyReason).toBe("binding_relationship_denied");
        expect(result.audit.bindingRelationshipIds).toEqual(["rel-001"]);
      }
    });

    it(`denies independence under an active "${type}" relationship (performer -> verifier)`, () => {
      const result = enforceIndependence(
        baseInput({
          relationshipEvidence: [
            relationship({ subjectId: HUMAN_WORKER, targetId: INDEPENDENT_HUMAN, type }),
          ],
        }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.denyReason).toBe("binding_relationship_denied");
    });
  }

  it("denies independence for an AI verifier bound by delegation to the performer", () => {
    const result = enforceIndependence(
      baseInput({
        verifier: { identityRef: INDEPENDENT_AI, classification: "ai" },
        relationshipEvidence: [
          relationship({
            relationshipId: "rel-deleg",
            subjectId: HUMAN_WORKER,
            targetId: INDEPENDENT_AI,
            type: "agent_for",
          }),
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.denyReason).toBe("binding_relationship_denied");
  });

  it("treats an EXPIRED binding relationship as proven dead — independence confirmed", () => {
    const result = enforceIndependence(
      baseInput({
        relationshipEvidence: [
          relationship({ expiresAt: PAST, revokedAt: null }),
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.audit.bindingRelationshipIds).toEqual([]);
  });

  it("treats a REVOKED binding relationship as proven dead — independence confirmed", () => {
    const result = enforceIndependence(
      baseInput({
        relationshipEvidence: [relationship({ revokedAt: PAST })],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("treats a binding relationship expiring after the evaluation instant as active", () => {
    const result = enforceIndependence(
      baseInput({ relationshipEvidence: [relationship({ expiresAt: FUTURE })] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.denyReason).toBe("binding_relationship_denied");
  });

  it("ignores binding relationships between OTHER parties", () => {
    const result = enforceIndependence(
      baseInput({
        relationshipEvidence: [
          relationship({ subjectId: HUMAN_WORKER, targetId: AI_WORKER, type: "manages" }),
          relationship({
            relationshipId: "rel-002",
            subjectId: AI_WORKER,
            targetId: INDEPENDENT_HUMAN,
            type: "delegated_to",
          }),
        ],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("does NOT treat shared non-binding membership as a dependence", () => {
    const result = enforceIndependence(
      baseInput({
        relationshipEvidence: [
          relationship({ subjectId: HUMAN_WORKER, targetId: INDEPENDENT_HUMAN, type: "member_of" }),
        ],
      }),
    );
    expect(result.ok).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────────
 * Fail closed on UNKNOWN relationships (§16)
 * ────────────────────────────────────────────────────────────*/

describe("H3-021 — fail closed on unknown relationships", () => {
  it("blocks a relationship type outside the identity model's closed vocabulary", () => {
    const result = enforceIndependence(
      baseInput({
        relationshipEvidence: [
          relationship({ subjectId: HUMAN_WORKER, targetId: INDEPENDENT_HUMAN, type: "acquaintance_of" }),
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.outcome).toBe("blocked");
      expect(result.denyReason).toBe("unknown_relationship_type");
    }
  });

  it("blocks an unknown-typed record ANYWHERE in the evidence set — evidence must be classifiable", () => {
    const result = enforceIndependence(
      baseInput({
        relationshipEvidence: [
          relationship({ subjectId: HUMAN_WORKER, targetId: AI_WORKER, type: "mystery_link" }),
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.denyReason).toBe("unknown_relationship_type");
  });

  it("blocks an unparseable revocation instant on a binding-candidate record", () => {
    const result = enforceIndependence(
      baseInput({
        relationshipEvidence: [relationship({ revokedAt: "not-a-timestamp" })],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.outcome).toBe("blocked");
      expect(result.denyReason).toBe("unknown_relationship_status");
    }
  });

  it("blocks an unparseable expiry instant on a binding-candidate record", () => {
    const result = enforceIndependence(
      baseInput({
        relationshipEvidence: [relationship({ expiresAt: "2026-13-99T00:00:00.000Z" })],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.denyReason).toBe("unknown_relationship_status");
  });

  it("blocks a malformed record (unparseable creation instant) as invalid evidence", () => {
    const result = enforceIndependence(
      baseInput({ relationshipEvidence: [relationship({ createdAt: "yesterday-ish" })] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.outcome).toBe("blocked");
      expect(result.denyReason).toBe("invalid_relationship_evidence");
    }
  });

  it("blocks when the caller cannot certify the evidence set as complete", () => {
    const result = enforceIndependence(baseInput({ evidenceCompleteness: "partial" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.outcome).toBe("blocked");
      expect(result.denyReason).toBe("relationship_evidence_incomplete");
    }
  });

  it("never lets a partial-evidence certification produce a confirmation, even with zero records", () => {
    const allowed = independenceAllows(
      baseInput({ relationshipEvidence: [], evidenceCompleteness: "partial" }),
    );
    expect(allowed).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────
 * Input validation (fail closed, typed — no exceptions)
 * ────────────────────────────────────────────────────────────*/

describe("H3-021 — malformed input fails closed with a named reason", () => {
  const malformed: ReadonlyArray<{ name: string; input: IndependenceCheckInput }> = [
    { name: "blank itemId", input: baseInput({ itemId: "  " }) },
    { name: "blank tenantScope", input: baseInput({ tenantScope: "" }) },
    { name: "blank policyRef", input: baseInput({ policyRef: "" }) },
    {
      name: "unknown classification",
      input: baseInput({
        verifier: {
          identityRef: INDEPENDENT_HUMAN,
          classification: "android",
        } as unknown as IndependenceCheckInput["verifier"],
      }),
    },
    {
      name: "unparseable evaluatedAt",
      input: baseInput({ evaluatedAt: "the third of October" } as unknown as IndependenceCheckInput),
    },
    {
      name: "relationship with blank subjectId",
      input: baseInput({ relationshipEvidence: [relationship({ subjectId: "" })] }),
    },
    {
      name: "relationship with negative version",
      input: baseInput({ relationshipEvidence: [relationship({ version: -1 })] }),
    },
  ];

  for (const { name, input } of malformed) {
    it(`denies ${name}`, () => {
      const result = enforceIndependence(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.outcome).toBe("blocked");
        expect(result.denyReason).toBe("invalid_input");
        expect(result.audit.eventKind).toBe("independence_denied");
      }
    });
  }

  it("denies a null-ish input without throwing", () => {
    const result = enforceIndependence(undefined as unknown as IndependenceCheckInput);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.denyReason).toBe("invalid_input");
      expect(result.audit.itemId).toBe("unattributed");
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * Audit and provenance (§12 / §18) — every path is observable
 * ────────────────────────────────────────────────────────────*/

describe("H3-021 — audit record on every path", () => {
  it("produces a confirm audit with full provenance", () => {
    const result = enforceIndependence(
      baseInput({ verifier: { identityRef: INDEPENDENT_AI, classification: "ai" } }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.audit).toMatchObject({
        auditId: `audit:independence:${ITEM}:${INDEPENDENT_AI}`,
        eventKind: "independence_confirmed",
        itemId: ITEM,
        tenantScope: TENANT,
        policyRef: POLICY,
        performerOfRecordRef: HUMAN_WORKER,
        relationshipEvidenceCount: 0,
        evidenceCompleteness: "complete",
        evaluatedAt: EVAL,
        denyReason: null,
      });
    }
  });

  it("produces a deny audit with the binding relationship ids", () => {
    const result = enforceIndependence(
      baseInput({
        relationshipEvidence: [
          relationship({ relationshipId: "rel-bind-a" }),
          relationship({ relationshipId: "rel-bind-b", type: "owns" }),
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.audit.eventKind).toBe("independence_denied");
      expect(result.audit.denyReason).toBe("binding_relationship_denied");
      expect(result.audit.bindingRelationshipIds).toEqual(["rel-bind-a", "rel-bind-b"]);
      expect(result.audit.relationshipEvidenceCount).toBe(2);
    }
  });

  it("records the evaluation instant as null when unparseable on a denied malformed input", () => {
    const result = enforceIndependence({
      ...baseInput({ evidenceCompleteness: "partial" }),
      evaluatedAt: "never",
    } as unknown as IndependenceCheckInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.audit.evaluatedAt).toBeNull();
  });

  it("carries tenant scope for provenance without re-deciding the tenant gate", () => {
    const result = enforceIndependence(baseInput({ tenantScope: "tenant-2" }));
    expect(result.audit.tenantScope).toBe("tenant-2");
  });
});

/* ─────────────────────────────────────────────────────────────
 * Helpers — the typed vocabulary pieces, proven in isolation
 * ────────────────────────────────────────────────────────────*/

describe("H3-021 — helpers", () => {
  it("classifyRelationshipType: binding types are exactly the binding set", () => {
    for (const type of BINDING_RELATIONSHIP_TYPES) {
      expect(classifyRelationshipType(type)).toBe("binding");
      expect(classifyRelationshipType(` ${type} `)).toBe("binding");
    }
  });

  it("classifyRelationshipType: every other identity-model type is non-binding", () => {
    const nonBinding = RELATIONSHIP_TYPES.filter(
      (type) => !(BINDING_RELATIONSHIP_TYPES as readonly string[]).includes(type),
    );
    expect(nonBinding.length).toBeGreaterThan(0);
    for (const type of nonBinding) {
      expect(classifyRelationshipType(type)).toBe("non_binding");
    }
  });

  it("classifyRelationshipType: unknown types fail closed to 'unknown'", () => {
    expect(classifyRelationshipType("acquaintance_of")).toBe("unknown");
    expect(classifyRelationshipType("")).toBe("unknown");
  });

  it("relationshipStatusAt: unrevoked, unexpired (null expiry) is active", () => {
    const record = relationship({ expiresAt: null, revokedAt: null });
    expect(relationshipStatusAt(record, Date.parse(EVAL))).toBe("active");
  });

  it("relationshipStatusAt: expiry at the evaluation instant is inactive", () => {
    const record = relationship({ expiresAt: EVAL });
    expect(relationshipStatusAt(record, Date.parse(EVAL))).toBe("inactive");
  });

  it("relationshipStatusAt: unparseable revocation is unknown, never inactive", () => {
    const record = relationship({ revokedAt: "garbage" });
    expect(relationshipStatusAt(record, Date.parse(EVAL))).toBe("unknown");
  });

  it("relationshipStatusAt: unparseable expiry is unknown, never active-or-inactive", () => {
    const record = relationship({ expiresAt: "???" });
    expect(relationshipStatusAt(record, Date.parse(EVAL))).toBe("unknown");
  });

  it("scanBindingRelationships: finds bindings in either direction and names unresolvable records", () => {
    const evidence = [
      relationship({ relationshipId: "r1", subjectId: INDEPENDENT_HUMAN, targetId: HUMAN_WORKER }),
      relationship({
        relationshipId: "r2",
        subjectId: HUMAN_WORKER,
        targetId: INDEPENDENT_HUMAN,
        type: "unknown_type",
      }),
      relationship({ relationshipId: "r3", subjectId: AI_WORKER, targetId: INDEPENDENT_AI }),
    ];
    const findings = scanBindingRelationships(
      evidence,
      INDEPENDENT_HUMAN,
      HUMAN_WORKER,
      Date.parse(EVAL),
    );
    expect(findings).toHaveLength(3);
    expect(findings[0]).toEqual({
      relationshipId: "r1",
      finding: "binding",
      relationshipType: "manages",
    });
    expect(findings[1]).toMatchObject({
      relationshipId: "r2",
      finding: "unresolvable",
      denyReason: "unknown_relationship_type",
    });
    expect(findings[2]).toEqual({ relationshipId: "r3", finding: "no_binding" });
  });

  it("scanBindingRelationships: is symmetric over the party pair", () => {
    const evidence = [relationship({ subjectId: HUMAN_WORKER, targetId: INDEPENDENT_AI, type: "delegated_to" })];
    const forward = scanBindingRelationships(evidence, INDEPENDENT_AI, HUMAN_WORKER, Date.parse(EVAL));
    const backward = scanBindingRelationships(evidence, HUMAN_WORKER, INDEPENDENT_AI, Date.parse(EVAL));
    expect(forward).toEqual(backward);
    expect(forward[0]?.finding).toBe("binding");
  });
});