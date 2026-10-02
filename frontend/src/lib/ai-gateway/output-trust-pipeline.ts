/**
 * CoreGrid — AI output trust pipeline + human approval chains (J-035 /
 * V1CAP-030/032, MISSION-R-34; Constitution §21 AI output trust).
 *
 * The mandatory lifecycle an AI proposal traverses before ANY execution:
 *
 *   proposed → validated → policy-checked → approval → executed → audited
 *
 * - proposed: the AI output enters the pipeline bound to its intelligence
 *   snapshot ref (J-015 provenance). The snapshot reference is re-validated
 *   fail-closed through `validateIntelligenceSnapshot` — an output without
 *   complete provenance never enters the pipeline.
 * - validated: schema/mechanical validation is recorded. When the raw output
 *   is supplied it is re-digested and must match the snapshot's outputDigest.
 * - policy-checked: the five-valued authorization decision (ALLOW | DENY |
 *   REDACT | ESCALATE | REQUIRE_APPROVAL) is recorded. A REQUIRE_APPROVAL
 *   decision is HONORED, never downgraded to allow: it forces the approval
 *   stage regardless of criticality tier. DENY, REDACT and ESCALATE are not
 *   executable here and fail closed.
 * - approval: an ORDERED, IDENTITY-BOUND human approval chain. Approvals are
 *   evidence-bearing, append-only, expirable and revocable. AI identities can
 *   never occupy an approver position (Part 13 law, reused from the workflow
 *   contract's `ApproverRef`), and the proposing AI identity can never approve
 *   its own output.
 * - executed: only after the full chain is satisfied. The pipeline emits an
 *   EXECUTION AUTHORIZATION RECEIPT binding the output digest + snapshot id +
 *   the approval set (content-addressed digests).
 * - audited: the execution is audited; "audited" is terminal.
 *
 * Fail-closed laws (no bypass path exists):
 * - Every stage function requires the exact predecessor stage; any attempt to
 *   skip a stage is a typed rejection naming the stage.
 * - A pipeline without its required approval stage cannot execute.
 * - An expired or revoked approval VOIDS the chain — enforcement is re-run at
 *   execution time against the supplied `at` instant, not trusted from the
 *   approval moment.
 * - Criticality tiers (the agent risk vocabulary, agent-core) declare the
 *   required chain depth: low/medium ≥ 1 approver, high ≥ 2, critical ≥ 3.
 *   A proposal whose declared approver set is shallower than its tier's depth
 *   is rejected at open; a chain with missing approvals cannot execute.
 *
 * Design laws honored here (mirroring the sibling gateway modules):
 * - Purity: no I/O, no environment reads, no wall-clock sampling — every
 *   instant is a supplied parameter.
 * - Immutability: pipelines are deep-frozen; every accepted act returns a NEW
 *   pipeline. There is no mutation path for an approval record — the only
 *   append is a new record, and revocations are a separate append-only ledger.
 * - Composition, not forking: approver vocabulary is the workflow contract's
 *   `ApproverRef`, decisions are the authorization engine's five-valued
 *   `AuthorizationResult`, risk tiers are the agent-core risk classes, and
 *   digests are the reasoning-provenance canonical digests.
 */

import type { AgentRiskClassification } from "../agent-core";
import type { AuthorizationDecision, AuthorizationResult } from "../identity";
import type { ApproverRef } from "../workflow/workflow-contract";
import {
  ReasoningProvenanceError,
  digestContent,
  validateIntelligenceSnapshot,
  type IntelligenceSnapshot,
} from "./reasoning-provenance";

/* ─────────────────────────────────────────────────────────────
 * Vocabulary
 * ────────────────────────────────────────────────────────────*/

export const TRUST_PIPELINE_SCHEMA_VERSION = "1.0";

/** The mandatory lifecycle stages, in traversal order. */
export type TrustPipelineStage =
  | "proposed"
  | "validated"
  | "policy_checked"
  | "approval"
  | "executed"
  | "audited";

export const TRUST_PIPELINE_STAGES: readonly TrustPipelineStage[] = [
  "proposed",
  "validated",
  "policy_checked",
  "approval",
  "executed",
  "audited",
] as const;

/**
 * Criticality tier of a proposal. The vocabulary is REUSED, not redefined:
 * it is the agent risk classification (agent-core) so a proposal's tier and
 * a worker's risk ceiling speak one language.
 */
export type TrustCriticalityTier = AgentRiskClassification;

/**
 * Required human-approval chain depth per tier. Every tier requires at least
 * one human approver — AI output never executes on AI authority alone — and
 * depth grows with criticality.
 */
export const CRITICALITY_CHAIN_DEPTHS: Readonly<Record<TrustCriticalityTier, number>> = {
  low: 1,
  medium: 1,
  high: 2,
  critical: 3,
};

/** Required chain depth for a tier (fail-closed: unknown tiers have no entry). */
export function requiredApprovalDepth(tier: TrustCriticalityTier): number {
  return CRITICALITY_CHAIN_DEPTHS[tier];
}

/**
 * One ordered, identity-bound approver requirement: EXACTLY the human
 * identity `approverRef` may occupy `position` of the chain.
 */
export interface TrustApprovalRequirement {
  readonly position: number;
  readonly approverRef: string;
}

/** The recorded five-valued authorization decision (AGENTS 21 policy check). */
export interface TrustPolicyDecisionRecord {
  readonly decision: AuthorizationDecision;
  readonly reason: string;
  readonly decidedAt: string;
}

/** An evidence-bearing, append-only approval record. */
export interface TrustApprovalRecord {
  readonly approvalId: string;
  readonly position: number;
  readonly approver: ApproverRef;
  readonly decidedAt: string;
  /** When the approval ceases to be valid; null means unbounded. */
  readonly expiresAt: string | null;
  /** Evidence-bearing: the approver's recorded rationale. Never empty. */
  readonly evidence: string;
}

/** Append-only revocation ledger entry; one per revoked approval. */
export interface TrustApprovalRevocation {
  readonly approvalId: string;
  readonly revokedAt: string;
  readonly revokedBy: string;
  readonly reason: string;
}

/** Append-only trail of every accepted pipeline act. */
export type TrustPipelineEvent =
  | { kind: "proposed"; at: string; detail: string }
  | { kind: "validated"; at: string; detail: string }
  | { kind: "policy_checked"; at: string; decision: AuthorizationDecision; detail: string }
  | { kind: "approval_recorded"; at: string; approvalId: string; position: number; detail: string }
  | { kind: "approval_revoked"; at: string; approvalId: string; detail: string }
  | { kind: "executed"; at: string; receiptId: string; detail: string }
  | { kind: "audited"; at: string; detail: string };

/* ─────────────────────────────────────────────────────────────
 * Execution authorization receipt
 * ────────────────────────────────────────────────────────────*/

/** Who signed off, per chain position — bound into the receipt. */
export interface ReceiptApprovalBinding {
  readonly position: number;
  readonly approvalId: string;
  readonly approverRef: string;
}

/**
 * The execution authorization receipt: the ONLY artifact a satisfied
 * pipeline emits, binding the executed output digest, the intelligence
 * snapshot id, and the satisfied human approval set. Content-addressed —
 * `receiptId` is the deterministic digest of the binding.
 */
export interface ExecutionReceipt {
  readonly receiptId: string;
  readonly pipelineId: string;
  readonly tier: TrustCriticalityTier;
  /** Digest of the exact AI output (from the snapshot). */
  readonly outputDigest: string;
  /** Identity of the intelligence snapshot backing the proposal. */
  readonly snapshotId: string;
  /** Digest of the satisfied approval set. */
  readonly approvalSetDigest: string;
  readonly approvedBy: readonly ReceiptApprovalBinding[];
  readonly executedAt: string;
  readonly executorRef: string;
}

/* ─────────────────────────────────────────────────────────────
 * The pipeline object (immutable; acts return a new pipeline)
 * ────────────────────────────────────────────────────────────*/

export interface TrustPipeline {
  readonly schemaVersion: string;
  readonly pipelineId: string;
  readonly tier: TrustCriticalityTier;
  /** Required chain depth resolved from the criticality tier. */
  readonly requiredDepth: number;
  /** The validated intelligence snapshot ref (J-015 interlock). */
  readonly snapshot: IntelligenceSnapshot;
  /** The proposing identity — an AI identity; never an approver. */
  readonly proposingIdentityRef: string;
  readonly approvalRequirements: readonly TrustApprovalRequirement[];
  readonly stage: TrustPipelineStage;
  readonly policyDecision: TrustPolicyDecisionRecord | null;
  readonly approvals: readonly TrustApprovalRecord[];
  readonly revocations: readonly TrustApprovalRevocation[];
  readonly receipt: ExecutionReceipt | null;
  readonly trail: readonly TrustPipelineEvent[];
  readonly openedAt: string;
}

/* ─────────────────────────────────────────────────────────────
 * Typed rejection (fail-closed, stage recorded)
 * ────────────────────────────────────────────────────────────*/

export type TrustPipelineErrorCode =
  | "invalid_input"
  | "invalid_snapshot_ref"
  | "invalid_stage"
  | "invalid_timestamp"
  | "validation_failed"
  | "output_digest_mismatch"
  | "policy_not_executable"
  | "unknown_position"
  | "position_out_of_order"
  | "ai_approver_rejected"
  | "self_approval_rejected"
  | "approver_identity_mismatch"
  | "approval_evidence_required"
  | "approval_expired"
  | "approval_revoked"
  | "chain_incomplete"
  | "criticality_depth_unmet"
  | "unknown_approval"
  | "append_only_violation";

export class TrustPipelineError extends Error {
  readonly code: TrustPipelineErrorCode;
  /** The pipeline stage at which the rejection occurred. */
  readonly stage: TrustPipelineStage;

  constructor(code: TrustPipelineErrorCode, stage: TrustPipelineStage, message: string) {
    super(message);
    this.name = "TrustPipelineError";
    this.code = code;
    this.stage = stage;
  }
}

function fail(code: TrustPipelineErrorCode, stage: TrustPipelineStage, message: string): never {
  throw new TrustPipelineError(code, stage, message);
}

/* ─────────────────────────────────────────────────────────────
 * Purity + immutability helpers
 * ────────────────────────────────────────────────────────────*/

function requireTimestamp(stage: TrustPipelineStage, field: string, value: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || Number.isNaN(Date.parse(value))) {
    fail("invalid_timestamp", stage, `${field} must be a parseable timestamp`);
  }
  return value;
}

function requireNonEmpty(stage: TrustPipelineStage, field: string, value: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail("invalid_input", stage, `${field} must be a non-empty string`);
  }
  return value.trim();
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const member of Object.values(value as Record<string, unknown>)) {
      deepFreeze(member);
    }
    return Object.freeze(value);
  }
  return value;
}

/* ─────────────────────────────────────────────────────────────
 * Stage 1 — proposed (AI output + snapshot ref, fail-closed interlock)
 * ────────────────────────────────────────────────────────────*/

export interface TrustPipelineProposeInput {
  pipelineId: string;
  tier: TrustCriticalityTier;
  /** The intelligence snapshot ref; validated fail-closed before entry. */
  snapshot: unknown;
  /** Ordered, identity-bound human approver requirements (position 0..n-1). */
  approvalRequirements: readonly TrustApprovalRequirement[];
  openedAt: string;
}

/**
 * Open a trust pipeline for an AI proposal. The snapshot ref is validated
 * through the J-015 gate — an output without complete provenance never
 * enters. The declared approver set must be at least as deep as the
 * criticality tier requires, or the pipeline is rejected at birth.
 */
export function openTrustPipeline(input: TrustPipelineProposeInput): TrustPipeline {
  const stage: TrustPipelineStage = "proposed";
  const pipelineId = requireNonEmpty(stage, "pipelineId", input.pipelineId);
  const tier = input.tier;
  if (CRITICALITY_CHAIN_DEPTHS[tier] === undefined) {
    fail("invalid_input", stage, `unknown criticality tier "${String(tier)}"`);
  }
  const openedAt = requireTimestamp(stage, "openedAt", input.openedAt);

  let snapshot: IntelligenceSnapshot;
  try {
    snapshot = validateIntelligenceSnapshot(input.snapshot);
  } catch (error) {
    if (error instanceof ReasoningProvenanceError) {
      fail(
        "invalid_snapshot_ref",
        stage,
        `proposal snapshot ref rejected: ${error.message}`,
      );
    }
    throw error;
  }

  const requirements = input.approvalRequirements;
  if (!Array.isArray(requirements) || requirements.length === 0) {
    fail("invalid_input", stage, "a trust pipeline declares at least one approval requirement");
  }
  const approverRefs = new Set<string>();
  requirements.forEach((requirement, index) => {
    if (requirement.position !== index) {
      fail(
        "invalid_input",
        stage,
        `approval requirements must be ordered positions 0..n-1 (position ${String(requirement.position)} at index ${index})`,
      );
    }
    if (typeof requirement.approverRef !== "string" || requirement.approverRef.trim().length === 0) {
      fail("invalid_input", stage, `approver requirement at position ${index} requires a non-empty approverRef`);
    }
    const ref = requirement.approverRef.trim();
    if (approverRefs.has(ref)) {
      fail("invalid_input", stage, `approver "${ref}" cannot occupy more than one chain position`);
    }
    approverRefs.add(ref);
  });

  const requiredDepth = requiredApprovalDepth(tier);
  if (requirements.length < requiredDepth) {
    fail(
      "criticality_depth_unmet",
      stage,
      `criticality tier "${tier}" requires a chain depth of ${requiredDepth}; ${requirements.length} approver(s) declared`,
    );
  }

  return deepFreeze({
    schemaVersion: TRUST_PIPELINE_SCHEMA_VERSION,
    pipelineId,
    tier,
    requiredDepth,
    snapshot,
    proposingIdentityRef: snapshot.attribution.agentRef ?? snapshot.attribution.actorRef,
    approvalRequirements: requirements.map((requirement) => ({
      position: requirement.position,
      approverRef: requirement.approverRef.trim(),
    })),
    stage,
    policyDecision: null,
    approvals: [],
    revocations: [],
    receipt: null,
    trail: [{ kind: "proposed", at: openedAt, detail: `snapshot ${snapshot.snapshotId} proposed` }],
    openedAt,
  });
}

/* ─────────────────────────────────────────────────────────────
 * Stage 2 — validated (schema/mechanical validation, recorded)
 * ────────────────────────────────────────────────────────────*/

export interface TrustValidationInput {
  at: string;
  /** Result of the caller's schema/mechanical validation. */
  schemaOk: boolean;
  /** What was validated and how — recorded on the trail. */
  detail: string;
  /**
   * The raw output when available: re-digested and checked against the
   * snapshot's outputDigest (mechanical interlock).
   */
  rawOutput?: unknown;
}

/** Record schema/mechanical validation of the proposal (proposed → validated). */
export function recordProposalValidation(pipeline: TrustPipeline, input: TrustValidationInput): TrustPipeline {
  const stage: TrustPipelineStage = "validated";
  if (pipeline.stage !== "proposed") {
    fail("invalid_stage", stage, `validation requires the proposed stage; pipeline is "${pipeline.stage}"`);
  }
  const at = requireTimestamp(stage, "at", input.at);
  const detail = requireNonEmpty(stage, "detail", input.detail);
  if (input.schemaOk !== true) {
    fail("validation_failed", stage, `proposal failed schema/mechanical validation: ${detail}`);
  }
  if (input.rawOutput !== undefined) {
    const rawDigest = digestContent(input.rawOutput);
    if (rawDigest !== pipeline.snapshot.outputDigest) {
      fail(
        "output_digest_mismatch",
        stage,
        `raw output digest ${rawDigest} does not match the snapshot outputDigest ${pipeline.snapshot.outputDigest}`,
      );
    }
  }
  return deepFreeze({
    ...pipeline,
    stage,
    trail: [...pipeline.trail, { kind: "validated", at, detail }],
  });
}

/* ─────────────────────────────────────────────────────────────
 * Stage 3 — policy-checked (five-valued decision recorded, honored)
 * ────────────────────────────────────────────────────────────*/

const AUTHORIZATION_DECISIONS: readonly AuthorizationDecision[] = [
  "ALLOW",
  "DENY",
  "REDACT",
  "ESCALATE",
  "REQUIRE_APPROVAL",
];

function isAuthorizationDecision(value: unknown): value is AuthorizationDecision {
  return (
    typeof value === "string" &&
    AUTHORIZATION_DECISIONS.includes(value as AuthorizationDecision)
  );
}

export interface TrustPolicyCheckInput {
  decision: AuthorizationResult;
  at: string;
}

/**
 * Record the authorization decision (validated → policy_checked). The
 * decision is honored, never downgraded:
 * - ALLOW: proceeds; the tier's required approval chain still applies.
 * - REQUIRE_APPROVAL: proceeds ONLY into the approval stage with a live
 *   chain requirement — never treated as allow.
 * - DENY / REDACT / ESCALATE: not executable through this pipeline; typed
 *   rejection carrying the policy_checked stage.
 */
export function recordPolicyDecision(pipeline: TrustPipeline, input: TrustPolicyCheckInput): TrustPipeline {
  const stage: TrustPipelineStage = "policy_checked";
  if (pipeline.stage !== "validated") {
    fail("invalid_stage", stage, `policy check requires the validated stage; pipeline is "${pipeline.stage}"`);
  }
  const at = requireTimestamp(stage, "at", input.at);
  const decision = input.decision as Partial<AuthorizationResult> | null | undefined;
  const decisionValue = decision?.decision;
  if (typeof decision !== "object" || decision === null || !isAuthorizationDecision(decisionValue)) {
    fail("invalid_input", stage, "policy check requires a five-valued authorization decision");
  }
  const reason = requireNonEmpty(stage, "decision.reason", decision.reason ?? "");
  if (decisionValue !== "ALLOW" && decisionValue !== "REQUIRE_APPROVAL") {
    fail(
      "policy_not_executable",
      stage,
      `authorization decision ${decisionValue} is not executable through the trust pipeline: ${reason}`,
    );
  }
  const recorded: TrustPolicyDecisionRecord = {
    decision: decisionValue,
    reason,
    decidedAt: at,
  };

  return deepFreeze({
    ...pipeline,
    stage: "approval",
    policyDecision: recorded,
    trail: [
      ...pipeline.trail,
      { kind: "policy_checked", at, decision: recorded.decision, detail: reason },
    ],
  });
}

/* ─────────────────────────────────────────────────────────────
 * Stage 4 — approval (ordered, identity-bound, evidence-bearing chain)
 * ────────────────────────────────────────────────────────────*/

export interface TrustApprovalInput {
  approvalId: string;
  position: number;
  approver: ApproverRef;
  decidedAt: string;
  expiresAt: string | null;
  evidence: string;
}

/**
 * Append one approval to the chain. Laws enforced at the append (fail
 * closed): the approval stage must be active; positions fill strictly in
 * order and each exactly once (append-only); the approver must be the
 * human identity bound to the position; an AI identity can never occupy an
 * approver position; the proposing AI identity can never approve its own
 * output; the approval must carry evidence; expiry, when declared, must be
 * in the future of the decision.
 */
export function recordApproval(pipeline: TrustPipeline, input: TrustApprovalInput): TrustPipeline {
  const stage: TrustPipelineStage = "approval";
  if (pipeline.stage !== "approval") {
    fail("invalid_stage", stage, `approvals require the approval stage; pipeline is "${pipeline.stage}"`);
  }
  const approvalId = requireNonEmpty(stage, "approvalId", input.approvalId);
  if (pipeline.approvals.some((record) => record.approvalId === approvalId)) {
    fail("append_only_violation", stage, `approval "${approvalId}" already exists — records are append-only`);
  }

  const position = input.position;
  if (!Number.isInteger(position) || position < 0 || position >= pipeline.approvalRequirements.length) {
    fail("unknown_position", stage, `approval position ${String(position)} is not a declared chain position`);
  }
  const nextPosition = pipeline.approvals.length;
  if (position !== nextPosition) {
    fail(
      "position_out_of_order",
      stage,
      `chain positions fill strictly in order: expected position ${nextPosition}, received ${position}`,
    );
  }

  const approver = input.approver as Partial<ApproverRef> | null | undefined;
  if (typeof approver !== "object" || approver === null) {
    fail("invalid_input", stage, "approval requires an approver reference");
  }
  if (approver.kind !== "human") {
    fail(
      "ai_approver_rejected",
      stage,
      "an AI identity can never occupy an approver position (Part 13 law)",
    );
  }
  const humanRef = requireNonEmpty(stage, "approver.humanRef", approver.humanRef ?? "");
  requireNonEmpty(stage, "approver.roleRef", approver.roleRef ?? "");

  if (humanRef === pipeline.proposingIdentityRef) {
    fail(
      "self_approval_rejected",
      stage,
      `the proposing identity "${humanRef}" cannot approve its own output`,
    );
  }

  const requirement = pipeline.approvalRequirements[position];
  if (requirement === undefined || humanRef !== requirement.approverRef) {
    fail(
      "approver_identity_mismatch",
      stage,
      `position ${position} is identity-bound to "${requirement?.approverRef ?? "<none>"}"; "${humanRef}" cannot occupy it`,
    );
  }

  const decidedAt = requireTimestamp(stage, "decidedAt", input.decidedAt);
  if (typeof input.evidence !== "string" || input.evidence.trim().length === 0) {
    fail(
      "approval_evidence_required",
      stage,
      "approvals are evidence-bearing: a non-empty evidence rationale is required",
    );
  }
  const evidence = input.evidence.trim();
  let expiresAt: string | null = null;
  if (input.expiresAt !== null && input.expiresAt !== undefined) {
    expiresAt = requireTimestamp(stage, "expiresAt", input.expiresAt);
    if (Date.parse(expiresAt) <= Date.parse(decidedAt)) {
      fail("approval_expired", stage, "approval expiry must be in the future of its decision");
    }
  }

  const record: TrustApprovalRecord = {
    approvalId,
    position,
    approver: { kind: "human", humanRef, roleRef: (approver.roleRef ?? "").trim() },
    decidedAt,
    expiresAt,
    evidence,
  };

  return deepFreeze({
    ...pipeline,
    approvals: [...pipeline.approvals, record],
    trail: [
      ...pipeline.trail,
      {
        kind: "approval_recorded",
        at: decidedAt,
        approvalId,
        position,
        detail: `human "${humanRef}" approved position ${position}: ${evidence}`,
      },
    ],
  });
}

/**
 * Revoke an approval (append-only ledger entry; the original record is never
 * altered or removed). A revoked approval voids the chain at execution.
 */
export function revokeApproval(
  pipeline: TrustPipeline,
  input: { approvalId: string; revokedAt: string; revokedBy: string; reason: string },
): TrustPipeline {
  const stage: TrustPipelineStage = "approval";
  if (pipeline.stage !== "approval") {
    fail("invalid_stage", stage, `revocation requires the approval stage; pipeline is "${pipeline.stage}"`);
  }
  const approvalId = requireNonEmpty(stage, "approvalId", input.approvalId);
  if (!pipeline.approvals.some((record) => record.approvalId === approvalId)) {
    fail("unknown_approval", stage, `approval "${approvalId}" does not exist in this chain`);
  }
  if (pipeline.revocations.some((revocation) => revocation.approvalId === approvalId)) {
    fail("append_only_violation", stage, `approval "${approvalId}" is already revoked`);
  }
  const revokedAt = requireTimestamp(stage, "revokedAt", input.revokedAt);
  const revokedBy = requireNonEmpty(stage, "revokedBy", input.revokedBy);
  const reason = requireNonEmpty(stage, "reason", input.reason);

  return deepFreeze({
    ...pipeline,
    revocations: [...pipeline.revocations, { approvalId, revokedAt, revokedBy, reason }],
    trail: [
      ...pipeline.trail,
      { kind: "approval_revoked", at: revokedAt, approvalId, detail: `revoked by "${revokedBy}": ${reason}` },
    ],
  });
}

/* ─────────────────────────────────────────────────────────────
 * Chain evaluation (fail-closed, re-run at execution time)
 * ────────────────────────────────────────────────────────────*/

/**
 * Every rejection the chain currently incurs at instant `at` (expiry and
 * revocation are evaluated against `at`, not the approval moment). Empty
 * list = satisfied.
 */
export function chainRejections(pipeline: TrustPipeline, at: string): readonly string[] {
  const rejections: string[] = [];
  const atMs = Date.parse(at);

  if (pipeline.approvalRequirements.length < pipeline.requiredDepth) {
    rejections.push(
      `criticality tier "${pipeline.tier}" requires chain depth ${pipeline.requiredDepth}; ` +
        `${pipeline.approvalRequirements.length} declared`,
    );
  }

  const revokedIds = new Set(pipeline.revocations.map((revocation) => revocation.approvalId));

  for (const requirement of pipeline.approvalRequirements) {
    const approval = pipeline.approvals.find((record) => record.position === requirement.position);
    if (approval === undefined) {
      rejections.push(`position ${requirement.position} has no approval from "${requirement.approverRef}"`);
      continue;
    }
    if (approval.approver.kind !== "human") {
      rejections.push(`position ${requirement.position} is occupied by a non-human approver`);
      continue;
    }
    if (approval.approver.humanRef !== requirement.approverRef) {
      rejections.push(
        `position ${requirement.position} is identity-bound to "${requirement.approverRef}" but approved by "${approval.approver.humanRef}"`,
      );
    }
    if (approval.approver.humanRef === pipeline.proposingIdentityRef) {
      rejections.push(`position ${requirement.position} was approved by the proposing AI identity`);
    }
    if (approval.evidence.trim().length === 0) {
      rejections.push(`position ${requirement.position} approval carries no evidence`);
    }
    if (revokedIds.has(approval.approvalId)) {
      rejections.push(`approval "${approval.approvalId}" at position ${requirement.position} is revoked`);
      continue;
    }
    if (approval.expiresAt !== null) {
      const expiryMs = Date.parse(approval.expiresAt);
      if (Number.isNaN(expiryMs) || expiryMs <= atMs) {
        rejections.push(
          `approval "${approval.approvalId}" at position ${requirement.position} expired at ${approval.expiresAt}`,
        );
      }
    }
  }

  return rejections;
}

/** True when the chain is fully satisfied at instant `at`. */
export function trustChainSatisfied(pipeline: TrustPipeline, at: string): boolean {
  return chainRejections(pipeline, at).length === 0;
}

/* ─────────────────────────────────────────────────────────────
 * Stage 5 — executed (receipt emission, chain re-verified)
 * ────────────────────────────────────────────────────────────*/

export interface TrustExecuteInput {
  at: string;
  executorRef: string;
}

/**
 * Execute the proposal. The full chain is RE-VERIFIED at `at` — expiry and
 * revocation between approval and execution void the chain — and the
 * pipeline emits the execution authorization receipt binding output digest
 * + snapshot id + approval set. There is no bypass: without the approval
 * stage reached and satisfied, no receipt exists.
 */
export function executeProposal(
  pipeline: TrustPipeline,
  input: TrustExecuteInput,
): { pipeline: TrustPipeline; receipt: ExecutionReceipt } {
  const stage: TrustPipelineStage = "executed";
  if (pipeline.stage !== "approval") {
    fail("invalid_stage", stage, `execution requires the approval stage; pipeline is "${pipeline.stage}" — no bypass path exists`);
  }
  const at = requireTimestamp(stage, "at", input.at);
  const executorRef = requireNonEmpty(stage, "executorRef", input.executorRef);

  // Snapshot-ref interlock, re-checked at execution time.
  try {
    validateIntelligenceSnapshot(pipeline.snapshot);
  } catch (error) {
    if (error instanceof ReasoningProvenanceError) {
      fail("invalid_snapshot_ref", stage, `snapshot ref no longer valid at execution: ${error.message}`);
    }
    throw error;
  }

  // REQUIRE_APPROVAL is honored, never downgraded: the decision forces a live
  // approval requirement even where a tier would declare none.
  const policyDecision = pipeline.policyDecision;
  if (policyDecision === null) {
    fail("invalid_stage", stage, "execution requires a recorded policy decision");
  }
  const requiredDepth = Math.max(
    pipeline.requiredDepth,
    policyDecision.decision === "REQUIRE_APPROVAL" ? 1 : 0,
  );
  if (pipeline.approvalRequirements.length < requiredDepth) {
    fail(
      "criticality_depth_unmet",
      stage,
      `chain depth ${pipeline.approvalRequirements.length} is shallower than the required depth ${requiredDepth}`,
    );
  }

  const rejections = chainRejections(pipeline, at);
  if (rejections.length > 0) {
    fail("chain_incomplete", stage, `approval chain is not satisfied: ${rejections.join("; ")}`);
  }

  const approvedBy: readonly ReceiptApprovalBinding[] = pipeline.approvals.map((approval) => ({
    position: approval.position,
    approvalId: approval.approvalId,
    approverRef: approval.approver.kind === "human" ? approval.approver.humanRef : "",
  }));
  const approvalSetDigest = digestContent(pipeline.approvals);
  const receipt: ExecutionReceipt = deepFreeze({
    receiptId: digestContent({
      pipelineId: pipeline.pipelineId,
      outputDigest: pipeline.snapshot.outputDigest,
      snapshotId: pipeline.snapshot.snapshotId,
      approvalSetDigest,
    }),
    pipelineId: pipeline.pipelineId,
    tier: pipeline.tier,
    outputDigest: pipeline.snapshot.outputDigest,
    snapshotId: pipeline.snapshot.snapshotId,
    approvalSetDigest,
    approvedBy,
    executedAt: at,
    executorRef,
  });

  const executed: TrustPipeline = deepFreeze({
    ...pipeline,
    stage,
    receipt,
    trail: [
      ...pipeline.trail,
      { kind: "executed", at, receiptId: receipt.receiptId, detail: `executed by "${executorRef}"` },
    ],
  });
  return { pipeline: executed, receipt };
}

/* ─────────────────────────────────────────────────────────────
 * Stage 6 — audited (terminal)
 * ────────────────────────────────────────────────────────────*/

/**
 * Record the audit of the execution (executed → audited). "audited" is
 * terminal; nothing transitions beyond it.
 */
export function recordPipelineAudit(
  pipeline: TrustPipeline,
  input: { at: string; auditRef: string; detail: string },
): TrustPipeline {
  const stage: TrustPipelineStage = "audited";
  if (pipeline.stage !== "executed") {
    fail("invalid_stage", stage, `audit requires the executed stage; pipeline is "${pipeline.stage}"`);
  }
  const at = requireTimestamp(stage, "at", input.at);
  const auditRef = requireNonEmpty(stage, "auditRef", input.auditRef);
  const detail = requireNonEmpty(stage, "detail", input.detail);

  return deepFreeze({
    ...pipeline,
    stage,
    trail: [
      ...pipeline.trail,
      { kind: "audited", at, detail: `audit ${auditRef}: ${detail}` },
    ],
  });
}
