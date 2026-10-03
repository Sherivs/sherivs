/**
 * CoreGrid — H3-069 autonomous-economy contract tests (mission G-069).
 * Zod validation of the phase-49 substrate surface: governed rules,
 * proposal-only economic intelligence (AGENTS §21), §36 payment-security
 * settlement instructions (idempotency, replay protection, signatures,
 * ownership validation, audit), derived-intelligence canonical separation
 * (AGENTS §9), and the append-only audit trail. Pure offline: no network,
 * no database, no secrets.
 */
import { describe, expect, it } from "vitest";
import {
  ECONOMY_BOUNDARY,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  MAX_AMOUNT_MINOR_UNITS,
  MAX_AUDIT_EVENTS_PER_TRAIL,
  MAX_INSTRUCTIONS_PER_BATCH,
  MAX_REFS_PER_RECORD,
  MAX_RULES_PER_SET,
  MIN_CONFIDENCE_FOR_ACTIONABLE,
  PROPOSAL_ONLY_POSTURE,
  SIGNATURE_DIGEST_MAX_LENGTH,
  STATEMENT_MAX_LENGTH,
  decideProposalRelease,
  derivedObservationSchema,
  economicAuditEventSchema,
  economicProposalSchema,
  marketRuleSchema,
  ownershipClaimSchema,
  parseAuditTrail,
  parseMarketRules,
  parseSettlementBatch,
  requiresHumanReview,
  settlementInstructionSchema,
  signatureEnvelopeSchema,
  validateSettlementOwnership,
  type DerivedObservation,
  type EconomicProposal,
  type SettlementInstruction,
} from "../../frontend/src/lib/autonomous-economy/contracts";

const DECLARED_AT = "2026-10-03T00:00:00.000Z";
const ACTION_AT = "2026-10-03T01:00:00.000Z";

const PROVENANCE = {
  declaredBy: "role:contract-architect",
  authority: "AGENTS.md §42 / H3 wave mission G-069",
  declaredAt: DECLARED_AT,
};

function rule(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ruleId: "settlement_requires_ledger_record",
    kind: "settlement_rule",
    statement:
      "a settlement instruction proceeds only when it cites a canonical ledger record",
    version: 1,
    status: "active",
    changeRequiresHumanApproval: true,
    provenance: PROVENANCE,
    ...overrides,
  };
}

const AGENT = { actorRef: "agent:economic-worker-7", actorKind: "autonomous_agent" };

function proposal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    proposalId: "adjust_price_band",
    kind: "price_adjustment",
    gatedAction: "price_override",
    proposedBy: AGENT,
    proposedAt: DECLARED_AT,
    rationale: "observed participation trend suggests a narrower price band",
    basisRefs: ["market_observation_001"],
    authorizes: false,
    requiresHumanApproval: true,
    ...overrides,
  };
}

const APPROVAL = {
  approvedBy: "human:platform-steward",
  authority: "governance review board",
  decidedAt: ACTION_AT,
};

function instruction(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    instructionId: "settle_exchange_001",
    idempotencyKey: "idem-2026-10-03-000001",
    exchangeRef: "exchange_001",
    ledgerRecordRef: "ledger:record:abc123",
    amount: 12_500,
    currency: "USD",
    tenantRef: "tenant:org-a",
    ownerRef: "owner:org-a-treasury",
    counterpartyRef: "owner:vendor-b",
    signature: {
      algorithm: "ed25519",
      keyRef: "key_treasury_signing_01",
      digest: "AA".repeat(32),
    },
    createdAt: ACTION_AT,
    replayProtected: true,
    ...overrides,
  };
}

const CLAIM = {
  tenantRef: "tenant:org-a",
  ownerRef: "owner:org-a-treasury",
  attestationRef: "attestation_001",
  claimedAt: DECLARED_AT,
};

function observation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    observationId: "price_suggestion_band_narrow",
    kind: "price_suggestion",
    confidence: 0.8,
    basisRefs: ["market_observation_001"],
    generatedBy: AGENT,
    generatedAt: ACTION_AT,
    isCanonical: false,
    ...overrides,
  };
}

function auditEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    eventId: "evt_001",
    eventKind: "proposal_recorded",
    actor: AGENT,
    occurredAt: DECLARED_AT,
    subjectRefs: ["adjust_price_band"],
    outcome: "recorded",
    detail: "proposal recorded from an autonomous economic actor",
    ...overrides,
  };
}

function typedProposal(overrides: Record<string, unknown> = {}): EconomicProposal {
  const parsed = economicProposalSchema.safeParse(proposal(overrides));
  if (!parsed.success) throw new Error("fixture must parse");
  return parsed.data;
}

/**
 * Attach a raw approval to a parsed proposal, simulating an untrusted record
 * reaching `decideProposalRelease` (defense in depth): the schema rejects
 * malformed approvals at parse time, so this is the only way to prove the
 * decision function independently re-validates them (fail-closed).
 */
function withRawApproval(p: EconomicProposal, approval: unknown): EconomicProposal {
  return { ...p, humanApproval: approval as EconomicProposal["humanApproval"] };
}

function typedInstruction(overrides: Record<string, unknown> = {}): SettlementInstruction {
  const parsed = settlementInstructionSchema.safeParse(instruction(overrides));
  if (!parsed.success) throw new Error("fixture must parse");
  return parsed.data;
}

function typedObservation(overrides: Record<string, unknown> = {}): DerivedObservation {
  const parsed = derivedObservationSchema.safeParse(observation(overrides));
  if (!parsed.success) throw new Error("fixture must parse");
  return parsed.data;
}

describe("market and settlement rules", () => {
  it("accepts a complete, approval-gated, provenance-backed rule", () => {
    const parsed = marketRuleSchema.safeParse(rule());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.kind).toBe("settlement_rule");
      expect(parsed.data.changeRequiresHumanApproval).toBe(true);
    }
  });

  it("binds every rule to human-approval gating — the literal cannot be false or absent", () => {
    expect(marketRuleSchema.safeParse(rule({ changeRequiresHumanApproval: false })).success).toBe(false);
    const ungated = rule();
    delete ungated.changeRequiresHumanApproval;
    expect(marketRuleSchema.safeParse(ungated).success).toBe(false);
  });

  it("rejects anonymous declarations — provenance is mandatory (AGENTS §12)", () => {
    const anonymous = rule();
    delete anonymous.provenance;
    expect(marketRuleSchema.safeParse(anonymous).success).toBe(false);
  });

  it("rejects silent retirements — a retired rule must name its reason", () => {
    expect(marketRuleSchema.safeParse(rule({ status: "retired" })).success).toBe(false);
    expect(
      marketRuleSchema.safeParse(rule({ status: "retired", retiredReason: "superseded by version 2" })).success,
    ).toBe(true);
  });

  it("rejects malformed identifiers and overlong statements (bounded inputs)", () => {
    expect(marketRuleSchema.safeParse(rule({ ruleId: "NoGood" })).success).toBe(false);
    expect(
      marketRuleSchema.safeParse(rule({ statement: "x".repeat(STATEMENT_MAX_LENGTH + 1) })).success,
    ).toBe(false);
  });

  it("rejects unknown keys (strict shape) so permissive semantics cannot leak in", () => {
    expect(marketRuleSchema.safeParse(rule({ autoEnforce: true })).success).toBe(false);
  });

  it("parses rule sets fail-closed: duplicates are rejected, never deduplicated", () => {
    const parsed = parseMarketRules([rule(), rule({ version: 2 })]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toBe("cross_record_invariant");
      expect(parsed.issues[0].message).toContain("duplicate rule id");
    }
    const valid = parseMarketRules([rule(), rule({ ruleId: "participation_requires_active_status", kind: "participation_rule" })]);
    expect(valid.ok).toBe(true);
    if (valid.ok) expect(valid.rules).toHaveLength(2);
  });

  it("rejects malformed rule-set inputs with structured issues", () => {
    for (const bad of [null, undefined, 42, "rules", {}, [[]]]) {
      const parsed = parseMarketRules(bad);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.reason).toBe("invalid_shape");
        expect(parsed.issues.length).toBeGreaterThan(0);
        expect(typeof parsed.issues[0].path).toBe("string");
        expect(typeof parsed.issues[0].message).toBe("string");
      }
    }
  });

  it("rejects rule sets above the bounded count", () => {
    const many = Array.from({ length: MAX_RULES_PER_SET + 1 }, (_, i) =>
      rule({ ruleId: `rule_${i}` }),
    );
    const parsed = parseMarketRules(many);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("invalid_shape");
  });
});

describe("economic proposals (AI actions are AI proposals — AGENTS §21)", () => {
  it("accepts a proposal citing canonical basis with the structural posture literals", () => {
    const parsed = economicProposalSchema.safeParse(proposal());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.authorizes).toBe(false);
      expect(parsed.data.requiresHumanApproval).toBe(true);
    }
  });

  it("binds proposals to authorizes:false — the surface cannot express an authorization", () => {
    expect(economicProposalSchema.safeParse(proposal({ authorizes: true })).success).toBe(false);
  });

  it("binds proposals to requiresHumanApproval:true — no exempt proposal class", () => {
    expect(economicProposalSchema.safeParse(proposal({ requiresHumanApproval: false })).success).toBe(false);
  });

  it("rejects proposals without canonical basis references — intelligence is derived, never conjured (AGENTS §9)", () => {
    const conjured = proposal();
    delete conjured.basisRefs;
    expect(economicProposalSchema.safeParse(conjured).success).toBe(false);
    expect(economicProposalSchema.safeParse(proposal({ basisRefs: [] })).success).toBe(false);
  });

  it("rejects failed validations without a named defect — failures are never silent", () => {
    expect(
      economicProposalSchema.safeParse(
        proposal({
          validation: { validatorRef: "validator:core", outcome: "failed", validatedAt: ACTION_AT },
        }),
      ).success,
    ).toBe(false);
    expect(
      economicProposalSchema.safeParse(
        proposal({
          validation: {
            validatorRef: "validator:core",
            outcome: "failed",
            validatedAt: ACTION_AT,
            failureDetail: "declared amount does not match the cited exchange record",
          },
        }),
      ).success,
    ).toBe(true);
  });
});

describe("proposal release decision (validation → policy check → human approval)", () => {
  it("rejects an unvalidated proposal — validation is mandatory, never defaulted", () => {
    const decision = decideProposalRelease(typedProposal());
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toBe("validation_missing");
  });

  it("rejects a failed validation even with approval attached", () => {
    const decision = decideProposalRelease(
      typedProposal({
        validation: { validatorRef: "validator:core", outcome: "failed", validatedAt: ACTION_AT, failureDetail: "amount mismatch" },
        policyCheck: { checkerRef: "policy:core", outcome: "allowed", checkedAt: ACTION_AT },
        humanApproval: APPROVAL,
      }),
    );
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.reason).toBe("validation_failed");
      expect(decision.detail).toContain("amount mismatch");
    }
  });

  it("rejects a proposal without a policy check", () => {
    const decision = decideProposalRelease(
      typedProposal({
        validation: { validatorRef: "validator:core", outcome: "passed", validatedAt: ACTION_AT },
      }),
    );
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toBe("policy_check_missing");
  });

  it("stops release on denied and escalated policy checks", () => {
    const validated = {
      validation: { validatorRef: "validator:core", outcome: "passed", validatedAt: ACTION_AT },
      humanApproval: APPROVAL,
    };
    const denied = decideProposalRelease(typedProposal({ ...validated, policyCheck: { checkerRef: "policy:core", outcome: "denied", checkedAt: ACTION_AT } }));
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.reason).toBe("policy_check_denied");

    const escalated = decideProposalRelease(typedProposal({ ...validated, policyCheck: { checkerRef: "policy:core", outcome: "escalated", checkedAt: ACTION_AT } }));
    expect(escalated.ok).toBe(false);
    if (!escalated.ok) expect(escalated.reason).toBe("policy_check_escalated");
  });

  it("rejects missing, malformed, and machine-authored approvals — fail closed (AGENTS §8)", () => {
    const validated = typedProposal({
      validation: { validatorRef: "validator:core", outcome: "passed", validatedAt: ACTION_AT },
      policyCheck: { checkerRef: "policy:core", outcome: "allowed", checkedAt: ACTION_AT },
    });
    for (const badApproval of [
      undefined,
      {},
      { approvedBy: "agent:self" },
      { ...APPROVAL, approvedBy: "" },
      { ...APPROVAL, decidedAt: "not-a-timestamp" },
      { approvedBy: "agent:self", authority: "self-granted", decidedAt: ACTION_AT },
    ]) {
      const decision = decideProposalRelease(withRawApproval(validated, badApproval));
      expect(decision.ok).toBe(false);
      if (!decision.ok) expect(decision.reason).toBe("human_approval_invalid");
    }
  });

  it("releases a fully validated, policy-checked, human-approved proposal for downstream execution only", () => {
    const decision = decideProposalRelease(
      typedProposal({
        validation: { validatorRef: "validator:core", outcome: "passed", validatedAt: ACTION_AT },
        policyCheck: { checkerRef: "policy:core", outcome: "allowed", checkedAt: ACTION_AT },
        humanApproval: APPROVAL,
      }),
    );
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.gatedAction).toBe("price_override");
      expect(decision.detail).toContain("does not execute");
      expect(decision.detail).toContain("ledger-bound");
    }
  });

  it("publishes the proposal-only posture as a citable constant", () => {
    expect(PROPOSAL_ONLY_POSTURE).toContain("proposals only");
    expect(PROPOSAL_ONLY_POSTURE).toContain("validated human approval record");
  });
});

describe("settlement instructions (AGENTS §36 payment security)", () => {
  it("accepts a complete instruction with signature, idempotency, and ledger reference", () => {
    const parsed = settlementInstructionSchema.safeParse(instruction());
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.replayProtected).toBe(true);
  });

  it("requires a signature envelope — unsigned settlements are rejected, not defaulted", () => {
    const unsigned = instruction();
    delete unsigned.signature;
    expect(settlementInstructionSchema.safeParse(unsigned).success).toBe(false);
  });

  it("requires the idempotency key and enforces its bounds", () => {
    const noKey = instruction();
    delete noKey.idempotencyKey;
    expect(settlementInstructionSchema.safeParse(noKey).success).toBe(false);
    expect(settlementInstructionSchema.safeParse(instruction({ idempotencyKey: "short" })).success).toBe(false);
    expect(
      settlementInstructionSchema.safeParse(instruction({ idempotencyKey: "k".repeat(IDEMPOTENCY_KEY_MAX_LENGTH + 1) })).success,
    ).toBe(false);
  });

  it("binds replay protection to a literal true — it cannot be opted out", () => {
    expect(settlementInstructionSchema.safeParse(instruction({ replayProtected: false })).success).toBe(false);
    const missing = instruction();
    delete missing.replayProtected;
    expect(settlementInstructionSchema.safeParse(missing).success).toBe(false);
  });

  it("requires a canonical ledger record reference — never money truth (ECONOMY_BOUNDARY)", () => {
    const noLedger = instruction();
    delete noLedger.ledgerRecordRef;
    expect(settlementInstructionSchema.safeParse(noLedger).success).toBe(false);
    expect(settlementInstructionSchema.safeParse(instruction({ ledgerRecordRef: "  " })).success).toBe(false);
  });

  it("rejects non-positive, fractional, and over-bounded amounts", () => {
    expect(settlementInstructionSchema.safeParse(instruction({ amount: 0 })).success).toBe(false);
    expect(settlementInstructionSchema.safeParse(instruction({ amount: -5 })).success).toBe(false);
    expect(settlementInstructionSchema.safeParse(instruction({ amount: 10.5 })).success).toBe(false);
    expect(settlementInstructionSchema.safeParse(instruction({ amount: MAX_AMOUNT_MINOR_UNITS + 1 })).success).toBe(false);
  });

  it("rejects malformed currency codes", () => {
    expect(settlementInstructionSchema.safeParse(instruction({ currency: "usd" })).success).toBe(false);
    expect(settlementInstructionSchema.safeParse(instruction({ currency: "USDD" })).success).toBe(false);
  });

  it("accepts only recognized signature algorithms with key references and opaque digests", () => {
    expect(signatureEnvelopeSchema.safeParse({ algorithm: "md5", keyRef: "key_01", digest: "AA".repeat(32) }).success).toBe(false);
    const keyEmbedded = { algorithm: "ed25519", keyRef: "key_01", digest: "-----BEGIN PRIVATE KEY-----AA" };
    expect(signatureEnvelopeSchema.safeParse(keyEmbedded).success).toBe(false);
    const shortDigest = { algorithm: "ed25519", keyRef: "key_01", digest: "AA" };
    expect(signatureEnvelopeSchema.safeParse(shortDigest).success).toBe(false);
    const longDigest = { algorithm: "ed25519", keyRef: "key_01", digest: "A".repeat(SIGNATURE_DIGEST_MAX_LENGTH + 1) };
    expect(signatureEnvelopeSchema.safeParse(longDigest).success).toBe(false);
  });
});

describe("settlement batch parsing (replay protection at the boundary)", () => {
  it("parses a valid batch of distinct instructions", () => {
    const parsed = parseSettlementBatch([
      instruction(),
      instruction({ instructionId: "settle_exchange_002", idempotencyKey: "idem-2026-10-03-000002", exchangeRef: "exchange_002" }),
    ]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.instructions).toHaveLength(2);
  });

  it("rejects a duplicate idempotency key as a replay attempt — never absorbed (AGENTS §36)", () => {
    const parsed = parseSettlementBatch([
      instruction(),
      instruction({ instructionId: "settle_exchange_002", exchangeRef: "exchange_002" }),
    ]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toBe("duplicate_idempotency_key");
      expect(parsed.issues[0].message).toContain("replay attempt rejected");
    }
  });

  it("rejects duplicate instruction ids", () => {
    const parsed = parseSettlementBatch([
      instruction(),
      instruction({ idempotencyKey: "idem-2026-10-03-000003" }),
    ]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toBe("duplicate_instruction_id");
      expect(parsed.issues[0].message).toContain("duplicate instruction id");
    }
  });

  it("rejects malformed batch inputs with structured issues", () => {
    for (const bad of [null, undefined, 42, "instructions", {}, [[]]]) {
      const parsed = parseSettlementBatch(bad);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.reason).toBe("invalid_shape");
        expect(parsed.issues.length).toBeGreaterThan(0);
      }
    }
  });

  it("rejects batches above the bounded count", () => {
    const many = Array.from({ length: MAX_INSTRUCTIONS_PER_BATCH + 1 }, (_, i) =>
      instruction({ instructionId: `settle_${i}`, idempotencyKey: `idem-2026-10-03-${String(i).padStart(6, "0")}`, exchangeRef: `exchange_${i}` }),
    );
    const parsed = parseSettlementBatch(many);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("invalid_shape");
  });
});

describe("ownership validation (AGENTS §36)", () => {
  it("accepts a claim whose tenant and owner exactly match the instruction", () => {
    const decision = validateSettlementOwnership(typedInstruction(), CLAIM);
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.detail).toContain("attestation_001");
  });

  it("rejects malformed claims — a bad claim fails closed, it is never defaulted", () => {
    for (const bad of [undefined, null, {}, { tenantRef: "tenant:org-a" }, { ...CLAIM, attestationRef: "Not-An-Identifier" }, { ...CLAIM, claimedAt: "yesterday" }]) {
      const decision = validateSettlementOwnership(typedInstruction(), bad);
      expect(decision.ok).toBe(false);
      if (!decision.ok) expect(decision.reason).toBe("claim_invalid");
    }
  });

  it("rejects a tenant mismatch — cross-tenant settlement is rejected (tenant isolation)", () => {
    const decision = validateSettlementOwnership(typedInstruction(), {
      ...CLAIM,
      tenantRef: "tenant:org-b",
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.reason).toBe("tenant_mismatch");
      expect(decision.detail).toContain("cross-tenant settlement is rejected");
    }
  });

  it("rejects an owner mismatch — settlement proceeds only for the validated owner", () => {
    const decision = validateSettlementOwnership(typedInstruction(), {
      ...CLAIM,
      ownerRef: "owner: impostor",
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toBe("owner_mismatch");
  });
});

describe("derived economic intelligence (canonical truth — AGENTS §9)", () => {
  it("accepts a provenance-backed, non-canonical observation", () => {
    const parsed = derivedObservationSchema.safeParse(observation());
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.isCanonical).toBe(false);
  });

  it("binds observations to isCanonical:false — derived intelligence can never be canonical truth", () => {
    expect(derivedObservationSchema.safeParse(observation({ isCanonical: true })).success).toBe(false);
    const missing = observation();
    delete missing.isCanonical;
    expect(derivedObservationSchema.safeParse(missing).success).toBe(false);
  });

  it("requires basis references — provenance is mandatory (AGENTS §12)", () => {
    const noBasis = observation();
    delete noBasis.basisRefs;
    expect(derivedObservationSchema.safeParse(noBasis).success).toBe(false);
    expect(derivedObservationSchema.safeParse(observation({ basisRefs: [] })).success).toBe(false);
  });

  it("rejects out-of-range confidence and bounds reference sets", () => {
    expect(derivedObservationSchema.safeParse(observation({ confidence: -0.1 })).success).toBe(false);
    expect(derivedObservationSchema.safeParse(observation({ confidence: 1.1 })).success).toBe(false);
    const many = Array.from({ length: MAX_REFS_PER_RECORD + 1 }, (_, i) => `basis_${i}`);
    expect(derivedObservationSchema.safeParse(observation({ basisRefs: many })).success).toBe(false);
  });

  it("flags sub-floor confidence for human review — low confidence is never silently actioned", () => {
    expect(MIN_CONFIDENCE_FOR_ACTIONABLE).toBe(0.5);
    expect(requiresHumanReview(typedObservation({ confidence: 0.49 }))).toBe(true);
    expect(requiresHumanReview(typedObservation({ confidence: 0.5 }))).toBe(false);
    expect(requiresHumanReview(typedObservation({ confidence: 0.9 }))).toBe(false);
  });
});

describe("append-only audit trail (AGENTS §29, §36)", () => {
  it("accepts a valid, ordered trail", () => {
    const parsed = parseAuditTrail([
      auditEvent(),
      auditEvent({ eventId: "evt_002", eventKind: "proposal_released", occurredAt: ACTION_AT, outcome: "released", subjectRefs: ["adjust_price_band"], detail: "released after human approval" }),
    ]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.events).toHaveLength(2);
  });

  it("rejects duplicate event ids", () => {
    const parsed = parseAuditTrail([auditEvent(), auditEvent({ occurredAt: ACTION_AT })]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toBe("cross_record_invariant");
      expect(parsed.issues[0].message).toContain("duplicate audit event id");
    }
  });

  it("rejects reordering — an append-only trail cannot be reordered after the fact", () => {
    const parsed = parseAuditTrail([
      auditEvent({ eventId: "evt_002", occurredAt: ACTION_AT }),
      auditEvent({ eventId: "evt_001", occurredAt: DECLARED_AT }),
    ]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issues[0].message).toContain("append-only");
  });

  it("rejects events without subject references or actor attribution", () => {
    const noRefs = auditEvent();
    delete noRefs.subjectRefs;
    expect(economicAuditEventSchema.safeParse(noRefs).success).toBe(false);
    const noActor = auditEvent();
    delete noActor.actor;
    expect(economicAuditEventSchema.safeParse(noActor).success).toBe(false);
  });

  it("rejects malformed trail inputs and over-bounded trails", () => {
    for (const bad of [null, undefined, 42, "trail", {}]) {
      const parsed = parseAuditTrail(bad);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.reason).toBe("invalid_shape");
    }
    const many = Array.from({ length: MAX_AUDIT_EVENTS_PER_TRAIL + 1 }, (_, i) =>
      auditEvent({ eventId: `evt_${i}`, occurredAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString() }),
    );
    const parsed = parseAuditTrail(many);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("invalid_shape");
  });
});

describe("module hygiene", () => {
  it("carries bounded ceilings that are positive integers", () => {
    for (const ceiling of [
      STATEMENT_MAX_LENGTH,
      MAX_RULES_PER_SET,
      MAX_INSTRUCTIONS_PER_BATCH,
      MAX_AUDIT_EVENTS_PER_TRAIL,
      MAX_REFS_PER_RECORD,
      MAX_AMOUNT_MINOR_UNITS,
      IDEMPOTENCY_KEY_MAX_LENGTH,
      SIGNATURE_DIGEST_MAX_LENGTH,
    ]) {
      expect(ceiling).toBeGreaterThan(0);
      expect(Number.isInteger(ceiling)).toBe(true);
    }
  });

  it("exposes the economy boundary as a citable constant — never money truth", () => {
    expect(ECONOMY_BOUNDARY).toContain("never owns money truth");
    expect(ECONOMY_BOUNDARY).toContain("phase 13");
    expect(ECONOMY_BOUNDARY).toContain("no economic rule may move value outside the ledger");
  });

  it("exposes every contract schema for downstream phase-49 consumers", () => {
    for (const schema of [
      marketRuleSchema,
      economicProposalSchema,
      settlementInstructionSchema,
      signatureEnvelopeSchema,
      ownershipClaimSchema,
      derivedObservationSchema,
      economicAuditEventSchema,
    ]) {
      expect(typeof schema.safeParse).toBe("function");
    }
  });
});