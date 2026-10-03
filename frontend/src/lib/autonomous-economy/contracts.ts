/**
 * CoreGrid — phase 49 substrate surface: autonomous-economy contracts
 * (H3 wave Squad G, mission G-069; Contract Architect, phase 49).
 *
 * WHAT: Zod-validated contracts for the phase-49 substrate — governed
 * exchange and settlement orchestration records, market and settlement
 * rules, proposal-only economic intelligence, ownership-validated
 * settlement instructions, and an append-only audit trail. This module owns
 * the STRUCTURE of that surface; it does not own money truth (phase 13) or
 * listings (phase 27), and it never executes value movement.
 *
 * Laws of this module:
 * - Never money truth (phase-49 boundary statement, D13): the economy
 *   orchestrates exchange over the canonical ledger; it never computes,
 *   caches, or overrides balances. Every settlement instruction must cite a
 *   canonical ledger record; a settlement without a ledger reference is
 *   rejected, not defaulted.
 * - Proposal-only posture (AGENTS §21, §7): AI economic actions are AI
 *   proposals — never autonomous execution. Proposal records carry
 *   `authorizes: false` and `requiresHumanApproval: true` as schema-level
 *   literals; the surface is structurally unable to express an authorization
 *   or an execution. Release-for-execution requires, in order: a passed
 *   validation, an allowed policy check, and a validated human approval
 *   record. Machine-authored approvals fail closed (AGENTS §8).
 * - Payment security (AGENTS §36): every settlement instruction carries
 *   mandatory idempotency, replay protection (duplicate idempotency keys are
 *   a cross-record rejection, not a warning), signature validation inputs
 *   (algorithm + key reference + verification digest), ownership validation,
 *   and audit attribution. Key material never enters this surface — keys are
 *   referenced, never embedded.
 * - Canonical truth (AGENTS §9): derived economic intelligence is structurally
 *   non-canonical (`isCanonical: false` literal); it cites the reality it was
 *   derived from and can never overwrite a canonical record. Sub-threshold
 *   confidence flags for human review — it is never silently actioned.
 * - Fail-closed parsing: any invariant violation yields a typed failure with
 *   structured issues; a failed parse never yields a partial result.
 * - Bounded inputs: statements, identifiers, amounts, batches, evidence sets
 *   and audit trails all carry hard ceilings. No unbounded structures.
 *
 * Neutral vocabulary only (J-037 shrink-only): a "rule" is any declared,
 * checkable constraint on governed exchange; an "actor" is any identity or
 * process; an "instruction" is any settlement-orchestration record. No
 * domain vocabulary appears here.
 *
 * Pure contract module: no I/O, no persistence, no vendor imports, no
 * wall-clock reads, no secrets, no network, no database.
 */

import { z } from "zod";

/* ─────────────────────────────────────────────────────────────
 * Ceilings (no unbounded structures)
 * ────────────────────────────────────────────────────────────*/

/** Hard ceiling on statements of rule, rationale, or gap. */
export const STATEMENT_MAX_LENGTH = 2_000;

/** Hard ceiling on rules in one parsed rule set. */
export const MAX_RULES_PER_SET = 512;

/** Hard ceiling on settlement instructions in one parsed batch. */
export const MAX_INSTRUCTIONS_PER_BATCH = 256;

/** Hard ceiling on audit events in one parsed trail. */
export const MAX_AUDIT_EVENTS_PER_TRAIL = 10_000;

/** Hard ceiling on reference/evidence items attached to one record. */
export const MAX_REFS_PER_RECORD = 64;

/** Hard ceiling on a single settlement amount in minor currency units. */
export const MAX_AMOUNT_MINOR_UNITS = 1_000_000_000_000_000;

/** Hard ceiling on idempotency-key length. */
export const IDEMPOTENCY_KEY_MAX_LENGTH = 128;

/** Hard ceiling on opaque signature digests. */
export const SIGNATURE_DIGEST_MAX_LENGTH = 512;

/**
 * Derived intelligence below this confidence never auto-actions: it is
 * flagged for human review (fail-closed floor, AGENTS §21).
 */
export const MIN_CONFIDENCE_FOR_ACTIONABLE = 0.5;

/**
 * The phase-49 boundary, exported as a constant so downstream surfaces can
 * cite it rather than paraphrase it. The economy orchestrates exchange; it
 * never owns money truth.
 */
export const ECONOMY_BOUNDARY =
  "the economy orchestrates exchange; it never owns money truth — balances and payment records remain with the canonical ledger owner (phase 13) and listings with phase 27, and no economic rule may move value outside the ledger";

/**
 * The proposal-only posture this surface encodes (AGENTS §21, §7): economic
 * proposals are structurally unable to authorize or execute; release for
 * execution requires validation, a policy check, and a validated human
 * approval record, and execution itself belongs to the owning execution
 * surface, never to this contract module.
 */
export const PROPOSAL_ONLY_POSTURE =
  "autonomous economic intelligence produces proposals only: proposal records can never authorize or execute, and release for execution requires validation, a policy check, and a validated human approval record";

/* ─────────────────────────────────────────────────────────────
 * Shared primitives
 * ────────────────────────────────────────────────────────────*/

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

export const identifierSchema = z
  .string()
  .regex(
    IDENTIFIER_PATTERN,
    "identifier must be a lowercase snake_case identifier (letters, digits, underscore; starts with a letter; at most 64 characters)",
  );

export type Identifier = z.infer<typeof identifierSchema>;

function nonEmptyBounded(label: string, maxLength: number) {
  return z
    .string()
    .min(1, `${label} must be a non-empty string`)
    .refine((value) => value.trim().length > 0, `${label} must not be blank`)
    .max(
      maxLength,
      `${label} exceeds the bounded maximum of ${maxLength} characters`,
    );
}

export const timestampSchema = z.string().datetime();

export type Timestamp = z.infer<typeof timestampSchema>;

export const currencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, "currency must be a three-letter uppercase code");

export type CurrencyCode = z.infer<typeof currencyCodeSchema>;

export const amountMinorUnitsSchema = z
  .number()
  .int("amount must be an integer count of minor currency units")
  .positive("amount must be strictly positive")
  .max(
    MAX_AMOUNT_MINOR_UNITS,
    `amount exceeds the bounded maximum of ${MAX_AMOUNT_MINOR_UNITS} minor units`,
  );

export type AmountMinorUnits = z.infer<typeof amountMinorUnitsSchema>;

export const actorKindSchema = z.enum([
  "autonomous_agent",
  "automated_process",
  "human_initiated",
]);

export type ActorKind = z.infer<typeof actorKindSchema>;

export const actorSchema = z.strictObject({
  /** Stable reference to the acting identity or process (not a secret). */
  actorRef: nonEmptyBounded("actor.actorRef", 256),
  actorKind: actorKindSchema,
});

export type Actor = z.infer<typeof actorSchema>;

export const provenanceSchema = z.strictObject({
  /** Who declared the record (role or identity reference, not a secret). */
  declaredBy: nonEmptyBounded("provenance.declaredBy", 256),
  /** Under which authority the declaration was made (AGENTS §43). */
  authority: nonEmptyBounded("provenance.authority", 256),
  declaredAt: timestampSchema,
});

export type Provenance = z.infer<typeof provenanceSchema>;

/* ─────────────────────────────────────────────────────────────
 * Market and settlement rules (canonical truth owned by phase 49)
 * ────────────────────────────────────────────────────────────*/

/**
 * Rule kinds. A rule constrains how exchange and settlement may proceed;
 * rules never move value themselves.
 */
export const marketRuleKindSchema = z.enum([
  "exchange_rule",
  "settlement_rule",
  "participation_rule",
  "price_policy",
]);

export type MarketRuleKind = z.infer<typeof marketRuleKindSchema>;

export const marketRuleSchema = z
  .strictObject({
    ruleId: identifierSchema,
    kind: marketRuleKindSchema,
    /** The declared, checkable constraint. Bounded; no free-form sprawl. */
    statement: nonEmptyBounded("rule.statement", STATEMENT_MAX_LENGTH),
    /** Monotonic version. Changes produce a new version; never silent edits. */
    version: z.number().int().positive().max(1_000_000),
    status: z.enum(["active", "retired"]),
    /** Required when status is `retired`; a retirement without a named reason
     * is rejected (fail-closed). */
    retiredReason: nonEmptyBounded("rule.retiredReason", STATEMENT_MAX_LENGTH).optional(),
    /**
     * Literal `true`, enforced by the schema: every rule change is an
     * approval-gated action — no rule may be created, changed, or retired
     * without a validated human approval record (phase-49 requiresApprovalFor).
     */
    changeRequiresHumanApproval: z.literal(true),
    provenance: provenanceSchema,
  })
  .superRefine((value, ctx) => {
    if (value.status === "retired" && (value.retiredReason === undefined || value.retiredReason.trim().length === 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["retiredReason"],
        message: "a retired rule must carry a retiredReason — fail-closed: no silent retirements",
      });
    }
  });

export type MarketRule = z.infer<typeof marketRuleSchema>;

/* ─────────────────────────────────────────────────────────────
 * Rule-set parsing (fail-closed: no partial rule sets)
 * ────────────────────────────────────────────────────────────*/

export type RuleSetParseFailureReason =
  /** The input does not match the schema at all. */
  | "invalid_shape"
  /** A cross-record invariant failed (duplicate rule ids). */
  | "cross_record_invariant";

export interface ContractParseIssue {
  readonly path: string;
  readonly message: string;
}

export type RuleSetParseResult =
  | { readonly ok: true; readonly rules: readonly MarketRule[] }
  | {
      readonly ok: false;
      readonly reason: RuleSetParseFailureReason;
      readonly issues: readonly ContractParseIssue[];
    };

function issuePath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return "(root)";
  return path.map((segment) => String(segment)).join(".");
}

/**
 * Parse an untrusted input into a set of market and settlement rules. Any
 * violation — shape, bounds, duplicates, silent retirement — yields
 * `ok: false` with structured issues; a failed parse never yields a partial
 * set.
 */
export function parseMarketRules(input: unknown): RuleSetParseResult {
  const listSchema = z.array(marketRuleSchema).max(MAX_RULES_PER_SET);
  const parsed = listSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid_shape",
      issues: parsed.error.issues.map((issue) => ({
        path: issuePath(issue.path),
        message: issue.message,
      })),
    };
  }

  const issues: ContractParseIssue[] = [];
  const seen = new Set<Identifier>();
  for (const rule of parsed.data) {
    if (seen.has(rule.ruleId)) {
      issues.push({
        path: `[ruleId=${rule.ruleId}]`,
        message: `duplicate rule id "${rule.ruleId}" — one id carries exactly one declared rule`,
      });
    } else {
      seen.add(rule.ruleId);
    }
  }

  if (issues.length > 0) {
    return { ok: false, reason: "cross_record_invariant", issues };
  }

  return { ok: true, rules: parsed.data };
}

/* ─────────────────────────────────────────────────────────────
 * Economic proposals (AI actions are AI proposals — AGENTS §21)
 * ────────────────────────────────────────────────────────────*/

/**
 * Proposal kinds. Every kind is an approval-gated action per the phase-49
 * seed (`requiresApprovalFor`): market-rule changes, autonomous settlement
 * activation, cross-organization exchange, and price overrides.
 */
export const proposalKindSchema = z.enum([
  "exchange_directive",
  "settlement_directive",
  "price_adjustment",
  "market_rule_change",
]);

export type ProposalKind = z.infer<typeof proposalKindSchema>;

export const gatedActionSchema = z.enum([
  "market_rule_change",
  "autonomous_settlement_activation",
  "cross_organization_exchange",
  "price_override",
]);

export type GatedAction = z.infer<typeof gatedActionSchema>;

export const proposalValidationSchema = z.strictObject({
  validatorRef: nonEmptyBounded("validation.validatorRef", 256),
  outcome: z.enum(["passed", "failed"]),
  validatedAt: timestampSchema,
  /** Required when outcome is `failed`: the named defect. */
  failureDetail: nonEmptyBounded("validation.failureDetail", STATEMENT_MAX_LENGTH).optional(),
});

export type ProposalValidation = z.infer<typeof proposalValidationSchema>;

export const policyCheckSchema = z.strictObject({
  checkerRef: nonEmptyBounded("policyCheck.checkerRef", 256),
  outcome: z.enum(["allowed", "denied", "escalated"]),
  checkedAt: timestampSchema,
});

export type PolicyCheck = z.infer<typeof policyCheckSchema>;

/**
 * Human approval record. `approvedBy` must reference a human identity via
 * the `human:` reference prefix — machine-authored approvals (agent,
 * process, or self references) fail closed in `decideProposalRelease`
 * (AGENTS §8: AI improvement is not AI permission expansion).
 */
export const humanApprovalSchema = z
  .strictObject({
    approvedBy: nonEmptyBounded("approval.approvedBy", 256),
    authority: nonEmptyBounded("approval.authority", 256),
    decidedAt: timestampSchema,
  })
  .refine(
    (value) => value.approvedBy.trim().toLowerCase().startsWith("human:"),
    "approvedBy must reference a human identity via the 'human:' prefix — machine-authored approvals fail closed (AGENTS §8)",
  );

export type HumanApproval = z.infer<typeof humanApprovalSchema>;

/**
 * Economic proposal record. Structural literals make the §21 posture
 * unforgeable:
 * - `authorizes: false` — a proposal is never an authorization; the surface
 *   cannot even express one.
 * - `requiresHumanApproval: true` — no proposal class is exempt.
 * - `basisRefs` is mandatory: a proposal must cite the canonical records it
 *   was derived from (AGENTS §9 — intelligence never appears from nowhere).
 */
export const economicProposalSchema = z
  .strictObject({
    proposalId: identifierSchema,
    kind: proposalKindSchema,
    gatedAction: gatedActionSchema,
    proposedBy: actorSchema,
    proposedAt: timestampSchema,
    rationale: nonEmptyBounded("proposal.rationale", STATEMENT_MAX_LENGTH),
    basisRefs: z
      .array(identifierSchema)
      .min(1, "a proposal requires at least one canonical basis reference — intelligence is derived, never conjured")
      .max(MAX_REFS_PER_RECORD),
    /** Literal `false`: proposals authorize nothing (AGENTS §21). */
    authorizes: z.literal(false),
    /** Literal `true`: every proposal requires human approval — no exempt class. */
    requiresHumanApproval: z.literal(true),
    validation: proposalValidationSchema.optional(),
    policyCheck: policyCheckSchema.optional(),
    humanApproval: humanApprovalSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.validation?.outcome === "failed" && (value.validation.failureDetail === undefined || value.validation.failureDetail.trim().length === 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["validation", "failureDetail"],
        message: "a failed validation must name the defect — fail-closed: failures are named, never silent",
      });
    }
  });

export type EconomicProposal = z.infer<typeof economicProposalSchema>;

/* ─────────────────────────────────────────────────────────────
 * Release decision (validation → policy check → human approval)
 * ────────────────────────────────────────────────────────────*/

export type ProposalReleaseRejectionReason =
  /** The mandatory validation step is missing. */
  | "validation_missing"
  /** Validation ran and failed. */
  | "validation_failed"
  /** The mandatory policy check is missing. */
  | "policy_check_missing"
  /** The policy check denied or escalated the proposal. */
  | "policy_check_denied"
  | "policy_check_escalated"
  /** The mandatory human approval record is missing. */
  | "human_approval_missing"
  /** The approval record failed validation (malformed or machine-authored). */
  | "human_approval_invalid";

export type ProposalReleaseDecision =
  | {
      readonly ok: true;
      readonly proposalId: Identifier;
      readonly gatedAction: GatedAction;
      /** Detail statement; execution itself remains downstream of this surface. */
      readonly detail: string;
    }
  | {
      readonly ok: false;
      readonly proposalId: Identifier;
      readonly reason: ProposalReleaseRejectionReason;
      readonly detail: string;
    };

/**
 * Decide whether a proposal may be RELEASED for execution by the owning
 * execution surface.
 *
 * Fail-closed by construction (AGENTS §21 pipeline order):
 * - validation must be present and `passed` — an unvalidated proposal is
 *   rejected, never defaulted;
 * - the policy check must be present and `allowed` — `denied` and
 *   `escalated` both stop release here;
 * - a VALID human approval record must be present; the approval input is
 *   parsed here, so a malformed or machine-shaped approval is rejected
 *   rather than trusted (AGENTS §8: AI improvement is not AI permission
 *   expansion).
 *
 * A positive decision releases the proposal for execution downstream; it
 * does not execute anything — this module has no execution capability.
 */
export function decideProposalRelease(proposal: EconomicProposal): ProposalReleaseDecision {
  if (proposal.validation === undefined) {
    return {
      ok: false,
      proposalId: proposal.proposalId,
      reason: "validation_missing",
      detail: "release requires a recorded validation — fail-closed: unvalidated proposals are never released",
    };
  }
  if (proposal.validation.outcome === "failed") {
    return {
      ok: false,
      proposalId: proposal.proposalId,
      reason: "validation_failed",
      detail: `validation failed${proposal.validation.failureDetail ? `: ${proposal.validation.failureDetail}` : ""}`,
    };
  }
  if (proposal.policyCheck === undefined) {
    return {
      ok: false,
      proposalId: proposal.proposalId,
      reason: "policy_check_missing",
      detail: "release requires a recorded policy check — fail-closed: unchecked proposals are never released",
    };
  }
  if (proposal.policyCheck.outcome === "denied") {
    return {
      ok: false,
      proposalId: proposal.proposalId,
      reason: "policy_check_denied",
      detail: "the policy check denied this proposal — it cannot be released",
    };
  }
  if (proposal.policyCheck.outcome === "escalated") {
    return {
      ok: false,
      proposalId: proposal.proposalId,
      reason: "policy_check_escalated",
      detail: "the policy check escalated this proposal — release is stopped pending human review",
    };
  }

  const parsed = humanApprovalSchema.safeParse(proposal.humanApproval);
  if (!parsed.success) {
    return {
      ok: false,
      proposalId: proposal.proposalId,
      reason: "human_approval_invalid",
      detail:
        "release requires a valid human approval record (approvedBy, authority, decidedAt) — machine-authored or malformed approvals fail closed (AGENTS §8)",
    };
  }

  return {
    ok: true,
    proposalId: proposal.proposalId,
    gatedAction: proposal.gatedAction,
    detail:
      "proposal released for execution by the owning execution surface — this decision authorizes the handoff, it does not execute; value movement remains ledger-bound (ECONOMY_BOUNDARY)",
  };
}

/* ─────────────────────────────────────────────────────────────
 * Settlement instructions (AGENTS §36 payment security)
 * ────────────────────────────────────────────────────────────*/

export const signatureAlgorithmSchema = z.enum([
  "ed25519",
  "ecdsa_p256",
  "hmac_sha256",
]);

export type SignatureAlgorithm = z.infer<typeof signatureAlgorithmSchema>;

/**
 * Signature envelope. Keys are REFERENCED (`keyRef`), never embedded; the
 * digest is an opaque bounded verification artifact. Any input resembling
 * embedded key material is rejected — secrets never enter this surface
 * (AGENTS §30, §36).
 */
export const signatureEnvelopeSchema = z
  .strictObject({
    algorithm: signatureAlgorithmSchema,
    /** Reference to the verifying key held by the key owner — never a key. */
    keyRef: identifierSchema,
    /** Opaque verification digest (hex or base64 alphabet only). */
    digest: z
      .string()
      .min(32, "digest must be at least 32 characters")
      .max(
        SIGNATURE_DIGEST_MAX_LENGTH,
        `digest exceeds the bounded maximum of ${SIGNATURE_DIGEST_MAX_LENGTH} characters`,
      )
      .regex(
        /^[A-Za-z0-9+/=]+$/,
        "digest must contain only hex/base64 alphabet characters — opaque verification artifact",
      ),
  });

export type SignatureEnvelope = z.infer<typeof signatureEnvelopeSchema>;

/**
 * Settlement instruction. Every §36 control is schema-mandatory:
 * - `idempotencyKey` — mandatory, bounded; duplicates are a cross-record
 *   rejection in `parseSettlementBatch` (replay protection).
 * - `signature` — mandatory validated-signature inputs.
 * - `ledgerRecordRef` — mandatory: money truth lives with the canonical
 *   ledger; an instruction without a ledger reference is rejected, not
 *   defaulted (never money truth).
 * - `replayProtected: true` — literal; replay protection cannot be opted out.
 * - ownership fields (`tenantRef`, `ownerRef`, `counterpartyRef`) are
 *   validated against an ownership claim by `validateSettlementOwnership`.
 */
export const settlementInstructionSchema = z.strictObject({
  instructionId: identifierSchema,
  idempotencyKey: z
    .string()
    .min(16, "idempotencyKey must be at least 16 characters")
    .max(
      IDEMPOTENCY_KEY_MAX_LENGTH,
      `idempotencyKey exceeds the bounded maximum of ${IDEMPOTENCY_KEY_MAX_LENGTH} characters`,
    ),
  /** Reference to the governed exchange this instruction settles. */
  exchangeRef: identifierSchema,
  /** Reference to the canonical ledger record — money truth stays external. */
  ledgerRecordRef: nonEmptyBounded("instruction.ledgerRecordRef", 256),
  amount: amountMinorUnitsSchema,
  currency: currencyCodeSchema,
  tenantRef: nonEmptyBounded("instruction.tenantRef", 256),
  ownerRef: nonEmptyBounded("instruction.ownerRef", 256),
  counterpartyRef: nonEmptyBounded("instruction.counterpartyRef", 256),
  signature: signatureEnvelopeSchema,
  createdAt: timestampSchema,
  /** Literal `true`: replay protection is structural, not optional. */
  replayProtected: z.literal(true),
});

export type SettlementInstruction = z.infer<typeof settlementInstructionSchema>;

/* ─────────────────────────────────────────────────────────────
 * Settlement batch parsing (replay protection at the boundary)
 * ────────────────────────────────────────────────────────────*/

export type SettlementBatchParseFailureReason =
  /** The input does not match the schema at all. */
  | "invalid_shape"
  /** Two instructions carry the same idempotency key — replay rejected. */
  | "duplicate_idempotency_key"
  /** Two instructions carry the same instruction id. */
  | "duplicate_instruction_id";

export type SettlementBatchParseResult =
  | { readonly ok: true; readonly instructions: readonly SettlementInstruction[] }
  | {
      readonly ok: false;
      readonly reason: SettlementBatchParseFailureReason;
      readonly issues: readonly ContractParseIssue[];
    };

/**
 * Parse an untrusted batch of settlement instructions. Duplicate idempotency
 * keys are REJECTED as a replay attempt (AGENTS §36) — never deduplicated,
 * never absorbed; duplicate instruction ids are likewise rejected. A failed
 * parse never yields a partial batch.
 */
export function parseSettlementBatch(input: unknown): SettlementBatchParseResult {
  const listSchema = z.array(settlementInstructionSchema).max(MAX_INSTRUCTIONS_PER_BATCH);
  const parsed = listSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid_shape",
      issues: parsed.error.issues.map((issue) => ({
        path: issuePath(issue.path),
        message: issue.message,
      })),
    };
  }

  const issues: ContractParseIssue[] = [];
  const seenIds = new Set<Identifier>();
  const seenKeys = new Set<string>();
  for (const instruction of parsed.data) {
    if (seenIds.has(instruction.instructionId)) {
      issues.push({
        path: `[instructionId=${instruction.instructionId}]`,
        message: `duplicate instruction id "${instruction.instructionId}" — one id carries exactly one settlement instruction`,
      });
    } else {
      seenIds.add(instruction.instructionId);
    }
    if (seenKeys.has(instruction.idempotencyKey)) {
      issues.push({
        path: `[instructionId=${instruction.instructionId}]`,
        message: `duplicate idempotency key on instruction "${instruction.instructionId}" — replay attempt rejected (AGENTS §36: idempotency is mandatory, replay is never absorbed)`,
      });
    } else {
      seenKeys.add(instruction.idempotencyKey);
    }
  }

  if (issues.length > 0) {
    if (issues.some((issue) => issue.message.includes("idempotency key"))) {
      return { ok: false, reason: "duplicate_idempotency_key", issues };
    }
    return { ok: false, reason: "duplicate_instruction_id", issues };
  }

  return { ok: true, instructions: parsed.data };
}

/* ─────────────────────────────────────────────────────────────
 * Ownership validation (AGENTS §36: ownership validation)
 * ────────────────────────────────────────────────────────────*/

export const ownershipClaimSchema = z.strictObject({
  tenantRef: nonEmptyBounded("claim.tenantRef", 256),
  ownerRef: nonEmptyBounded("claim.ownerRef", 256),
  /** Reference to the attestation backing the claim (evidence, not trust). */
  attestationRef: identifierSchema,
  claimedAt: timestampSchema,
});

export type OwnershipClaim = z.infer<typeof ownershipClaimSchema>;

export type OwnershipValidationFailureReason =
  /** The claim input failed validation. */
  | "claim_invalid"
  /** The claim's tenant does not match the instruction's tenant. */
  | "tenant_mismatch"
  /** The claim's owner does not match the instruction's owner. */
  | "owner_mismatch";

export type OwnershipValidationDecision =
  | {
      readonly ok: true;
      readonly instructionId: Identifier;
      readonly detail: string;
    }
  | {
      readonly ok: false;
      readonly instructionId: Identifier;
      readonly reason: OwnershipValidationFailureReason;
      readonly detail: string;
    };

/**
 * Validate that an ownership claim covers a settlement instruction.
 *
 * Fail-closed: the claim is parsed here (a malformed claim is rejected, not
 * defaulted), and both tenant and owner must match exactly — a mismatch on
 * either dimension stops the settlement instruction from proceeding.
 * This is ownership validation (§36); authorization itself remains with the
 * phases that own it.
 */
export function validateSettlementOwnership(
  instruction: SettlementInstruction,
  claim: unknown,
): OwnershipValidationDecision {
  const parsed = ownershipClaimSchema.safeParse(claim);
  if (!parsed.success) {
    return {
      ok: false,
      instructionId: instruction.instructionId,
      reason: "claim_invalid",
      detail:
        "ownership validation requires a valid claim (tenantRef, ownerRef, attestationRef, claimedAt) — malformed claims fail closed",
    };
  }

  if (parsed.data.tenantRef !== instruction.tenantRef) {
    return {
      ok: false,
      instructionId: instruction.instructionId,
      reason: "tenant_mismatch",
      detail: `claim tenant "${parsed.data.tenantRef}" does not match instruction tenant "${instruction.tenantRef}" — fail-closed: cross-tenant settlement is rejected`,
    };
  }

  if (parsed.data.ownerRef !== instruction.ownerRef) {
    return {
      ok: false,
      instructionId: instruction.instructionId,
      reason: "owner_mismatch",
      detail: `claim owner "${parsed.data.ownerRef}" does not match instruction owner "${instruction.ownerRef}" — fail-closed: settlement proceeds only for the validated owner`,
    };
  }

  return {
    ok: true,
    instructionId: instruction.instructionId,
    detail: `ownership validated against attestation "${parsed.data.attestationRef}" — tenant and owner match`,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Derived economic intelligence (canonical truth — AGENTS §9)
 * ────────────────────────────────────────────────────────────*/

/**
 * Derived intelligence kinds. These are the phase-49 `derived` classes from
 * the seed canonicalTruth declaration; none of them is ever canonical.
 */
export const derivedKindSchema = z.enum([
  "price_suggestion",
  "liquidity_forecast",
  "economic_recommendation",
  "resource_insight",
]);

export type DerivedKind = z.infer<typeof derivedKindSchema>;

/**
 * Derived observation record. Structural literals make the canonical-truth
 * separation unforgeable:
 * - `isCanonical: false` — derived intelligence can never overwrite a
 *   canonical record (AGENTS §9);
 * - `basisRefs` is mandatory — every derived item cites the canonical
 *   records it was derived from (AGENTS §11, §12 provenance).
 */
export const derivedObservationSchema = z.strictObject({
  observationId: identifierSchema,
  kind: derivedKindSchema,
  /** Confidence in [0, 1]; below MIN_CONFIDENCE_FOR_ACTIONABLE flags review. */
  confidence: z.number().min(0).max(1),
  basisRefs: z
    .array(identifierSchema)
    .min(1, "a derived observation requires at least one canonical basis reference — provenance is mandatory (AGENTS §12)")
    .max(MAX_REFS_PER_RECORD),
  generatedBy: actorSchema,
  generatedAt: timestampSchema,
  /** Literal `false`: derived intelligence is never canonical truth. */
  isCanonical: z.literal(false),
});

export type DerivedObservation = z.infer<typeof derivedObservationSchema>;

/**
 * Flag derived observations whose confidence is below the actionable floor.
 * Fail-closed posture: sub-threshold intelligence is never silently
 * actioned — it is routed to human review (AGENTS §21).
 */
export function requiresHumanReview(observation: DerivedObservation): boolean {
  return observation.confidence < MIN_CONFIDENCE_FOR_ACTIONABLE;
}

/* ─────────────────────────────────────────────────────────────
 * Append-only audit trail (AGENTS §29, §36: audit)
 * ────────────────────────────────────────────────────────────*/

export const auditEventKindSchema = z.enum([
  "proposal_recorded",
  "proposal_release_rejected",
  "proposal_released",
  "rule_change_recorded",
  "settlement_recorded",
  "ownership_validated",
  "ownership_rejected",
  "replay_rejected",
  "derived_recorded",
]);

export type AuditEventKind = z.infer<typeof auditEventKindSchema>;

/**
 * Audit event. Records are append-only facts: no status field exists to
 * mutate, and `parseAuditTrail` enforces non-decreasing occurrence order so
 * a trail cannot be reordered after the fact.
 */
export const economicAuditEventSchema = z.strictObject({
  eventId: identifierSchema,
  eventKind: auditEventKindSchema,
  actor: actorSchema,
  occurredAt: timestampSchema,
  /** References to the records this event is about. */
  subjectRefs: z
    .array(identifierSchema)
    .min(1, "an audit event requires at least one subject reference")
    .max(MAX_REFS_PER_RECORD),
  outcome: z.enum(["recorded", "rejected", "released"]),
  detail: nonEmptyBounded("event.detail", STATEMENT_MAX_LENGTH),
});

export type EconomicAuditEvent = z.infer<typeof economicAuditEventSchema>;

export type AuditTrailParseFailureReason =
  /** The input does not match the schema at all. */
  | "invalid_shape"
  /** A cross-record invariant failed (duplicates or ordering). */
  | "cross_record_invariant";

export type AuditTrailParseResult =
  | { readonly ok: true; readonly events: readonly EconomicAuditEvent[] }
  | {
      readonly ok: false;
      readonly reason: AuditTrailParseFailureReason;
      readonly issues: readonly ContractParseIssue[];
    };

/**
 * Parse an untrusted audit trail. Cross-record invariants (fail-closed):
 * - duplicate event ids are rejected;
 * - events must be in non-decreasing `occurredAt` order — an append-only
 *   trail cannot be reordered after the fact.
 * A failed parse never yields a partial trail.
 */
export function parseAuditTrail(input: unknown): AuditTrailParseResult {
  const listSchema = z.array(economicAuditEventSchema).max(MAX_AUDIT_EVENTS_PER_TRAIL);
  const parsed = listSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid_shape",
      issues: parsed.error.issues.map((issue) => ({
        path: issuePath(issue.path),
        message: issue.message,
      })),
    };
  }

  const issues: ContractParseIssue[] = [];
  const seen = new Set<Identifier>();
  let previousAt: string | null = null;
  for (const event of parsed.data) {
    if (seen.has(event.eventId)) {
      issues.push({
        path: `[eventId=${event.eventId}]`,
        message: `duplicate audit event id "${event.eventId}" — one id carries exactly one recorded event`,
      });
    } else {
      seen.add(event.eventId);
    }
    if (previousAt !== null && event.occurredAt < previousAt) {
      issues.push({
        path: `[eventId=${event.eventId}]`,
        message: `audit event "${event.eventId}" occurs before its predecessor — the trail is append-only and cannot be reordered`,
      });
    }
    previousAt = event.occurredAt;
  }

  if (issues.length > 0) {
    return { ok: false, reason: "cross_record_invariant", issues };
  }

  return { ok: true, events: parsed.data };
}