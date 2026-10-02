/**
 * CoreGrid — human approval chains wired to high-risk actions (J-032,
 * MISSION H2-20; Constitution §7, §12, §16, §21).
 *
 * This module closes the REQUIRE_APPROVAL gap in the completeness loop
 * (Decision → Action): the authorization engine can emit REQUIRE_APPROVAL
 * and the trust pipeline (J-035) can walk an AI proposal to approval, but
 * neither guarantees that a HIGH-RISK ACTION carries a valid, unexpired,
 * independent human approval chain at the moment an executor picks it up.
 * This module is that guarantee: a typed, risk-classified approval contract
 * plus a fail-closed executor gate.
 *
 * Laws encoded structurally:
 * - §7 / §21 — AI proposes, humans approve. Every action risk class mandates
 *   an approval depth (single-approver / two-person / quorum); AI identities
 *   can never occupy an approver position, and a proposer can never approve
 *   its own action (independence, complementing J-035's proposing-identity
 *   law on the AI-output side).
 * - §16 — the authorization decision vocabulary's REQUIRE_APPROVAL outcome
 *   resolves here: an action whose chain is unmet is DENIED, never downgraded
 *   to allow, and never silently dropped.
 * - §12 — approval records are evidence-bearing provenance: who approved,
 *   what (content-addressed action digest), under which policy, when, with
 *   what capability and tenant evidence, and when the approval expires.
 * - Fail-closed executor gate: the gate NEVER throws on an unmet chain —
 *   it returns DENIED plus an audit record naming every rejection reason.
 *   Denial is a decision, not an exception; a bypass path does not exist.
 *   Chain validity is re-evaluated at the gate against the supplied `at`
 *   instant — an approval that expired between approval time and execution
 *   time voids the chain.
 *
 * Boundary: pure data + pure functions. No I/O, no vendor, no wall-clock —
 * every instant is a supplied parameter. Vocabulary composes, not forks:
 * digests are the reasoning-provenance canonical digests, and identity kinds
 * follow the workflow contract's ApproverRef human/ai split.
 */

import { digestContent } from "../ai-gateway/reasoning-provenance";

/* ─────────────────────────────────────────────────────────────
 * Vocabulary — risk classes and mandated approval depth
 * ────────────────────────────────────────────────────────────*/

export const APPROVAL_CHAINS_SCHEMA_VERSION = "1.0";

/**
 * Mandated approval depth classes. The depth is the governance mandate:
 * how many independent, eligible human approvers an action requires.
 */
export const APPROVAL_DEPTH_CLASSES = [
  "single-approver",
  "two-person",
  "quorum",
] as const;
export type ApprovalDepthClass = (typeof APPROVAL_DEPTH_CLASSES)[number];

export const DEPTH_CLASS_MINIMUM_APPROVERS: Readonly<
  Record<ApprovalDepthClass, number>
> = {
  "single-approver": 1,
  "two-person": 2,
  quorum: 3,
};

/** Risk classes for actions. Each class mandates exactly one depth class. */
export const ACTION_RISK_CLASSES = ["standard", "high-risk", "critical"] as const;
export type ActionRiskClass = (typeof ACTION_RISK_CLASSES)[number];

/**
 * The risk → depth mandate. There is no risk class without a mandated human
 * approval depth: no action executes on AI authority alone (§7).
 */
export const MANDATED_APPROVAL_DEPTH: Readonly<
  Record<ActionRiskClass, ApprovalDepthClass>
> = {
  standard: "single-approver",
  "high-risk": "two-person",
  critical: "quorum",
};

/** Mandated approval depth class for an action risk class (fail-closed: unknown classes have no entry). */
export function mandatedApprovalDepth(riskClass: ActionRiskClass): ApprovalDepthClass {
  return MANDATED_APPROVAL_DEPTH[riskClass];
}

/** Minimum number of independent human approvers an action risk class requires. */
export function mandatedApproverCount(riskClass: ActionRiskClass): number {
  return DEPTH_CLASS_MINIMUM_APPROVERS[mandatedApprovalDepth(riskClass)];
}

/** The capability an approver must hold to approve a high-risk action. */
export const APPROVER_CAPABILITY = "governance:approve-high-risk" as const;

/* ─────────────────────────────────────────────────────────────
 * Contracts
 * ────────────────────────────────────────────────────────────*/

/** Identity kind follows the workflow contract's ApproverRef split. */
export type IdentityKind = "human" | "ai";

/**
 * The high-risk action an executor would run. `actionDigest` is the
 * content-addressed binding of the exact action payload — an approval is
 * for THIS digest, not for the action's title.
 */
export interface HighRiskAction {
  readonly actionId: string;
  /** What kind of action this is (executor-facing reference). */
  readonly actionRef: string;
  /** Tenant the action executes in (§13 — every request has tenant context). */
  readonly tenantId: string;
  readonly riskClass: ActionRiskClass;
  /** The proposing identity — human or AI (AI proposes, §7). */
  readonly proposerRef: string;
  readonly actionDigest: string;
  /** The policy under which approval is routed (§16 — under which policy?). */
  readonly policyId: string;
  readonly proposedAt: string;
}

/**
 * An approver's eligibility evidence, snapshotted at approval time. The
 * record carries the evidence itself so provenance survives identity or
 * capability drift after the fact (§12).
 */
export interface ApproverIdentity {
  readonly approverRef: string;
  readonly identityKind: IdentityKind;
  /** The approver's tenant scope at approval time. */
  readonly tenantId: string;
  readonly capabilities: readonly string[];
}

/**
 * The append-only approval record — full §12 provenance for one approval:
 * who approved what, under which policy, when, and until when.
 */
export interface ApprovalRecord {
  readonly approvalId: string;
  /** What: the action id AND its exact content digest. */
  readonly actionId: string;
  readonly actionDigest: string;
  /** Who: the human approver's identity + eligibility evidence at approval time. */
  readonly approverRef: string;
  readonly identityKind: IdentityKind;
  readonly approverTenantId: string;
  readonly approverCapabilities: readonly string[];
  /** Under which policy. */
  readonly policyId: string;
  readonly decidedAt: string;
  /** When the approval ceases to be valid; null means unbounded. */
  readonly expiresAt: string | null;
  /** Evidence-bearing: the approver's recorded rationale. Never empty. */
  readonly evidence: string;
}

/* ─────────────────────────────────────────────────────────────
 * Typed rejection (fail-closed)
 * ────────────────────────────────────────────────────────────*/

export type ApprovalChainErrorCode =
  | "invalid_input"
  | "unknown_risk_class"
  | "invalid_timestamp"
  | "invalid_digest"
  | "approval_expired"
  | "approver_not_human"
  | "self_approval_rejected"
  | "tenant_scope_mismatch"
  | "capability_missing"
  | "evidence_required"
  | "action_mismatch"
  | "digest_mismatch"
  | "policy_mismatch"
  | "duplicate_approver"
  | "duplicate_approval"
  | "chain_depth_unmet";

export class ApprovalChainError extends Error {
  readonly code: ApprovalChainErrorCode;

  constructor(code: ApprovalChainErrorCode, message: string) {
    super(message);
    this.name = "ApprovalChainError";
    this.code = code;
  }
}

function fail(code: ApprovalChainErrorCode, message: string): never {
  throw new ApprovalChainError(code, message);
}

/* ─────────────────────────────────────────────────────────────
 * Purity + immutability helpers
 * ────────────────────────────────────────────────────────────*/

function requireNonEmpty(field: string, value: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail("invalid_input", `${field} must be a non-empty string`);
  }
  return value.trim();
}

function requireTimestamp(field: string, value: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || Number.isNaN(Date.parse(value))) {
    fail("invalid_timestamp", `${field} must be a parseable timestamp`);
  }
  return value;
}

function requireDigest(field: string, value: string): string {
  requireNonEmpty(field, value);
  if (!value.startsWith("sha256:")) {
    fail("invalid_digest", `${field} must be a canonical sha256 digest`);
  }
  return value;
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
 * Action construction (risk classification binding)
 * ────────────────────────────────────────────────────────────*/

export interface HighRiskActionInput {
  actionId: string;
  actionRef: string;
  tenantId: string;
  riskClass: ActionRiskClass;
  proposerRef: string;
  policyId: string;
  proposedAt: string;
  /** The exact action payload; digested content-addressed into `actionDigest`. */
  payload: unknown;
}

/**
 * Bind a high-risk action to its risk class, tenant, proposer, policy and
 * content digest. The digest is canonical — approvals bind to it, so any
 * change to the payload voids every prior approval.
 */
export function declareHighRiskAction(input: HighRiskActionInput): HighRiskAction {
  const actionId = requireNonEmpty("actionId", input.actionId);
  const actionRef = requireNonEmpty("actionRef", input.actionRef);
  const tenantId = requireNonEmpty("tenantId", input.tenantId);
  if (MANDATED_APPROVAL_DEPTH[input.riskClass] === undefined) {
    fail("unknown_risk_class", `unknown action risk class "${String(input.riskClass)}"`);
  }
  const proposerRef = requireNonEmpty("proposerRef", input.proposerRef);
  const policyId = requireNonEmpty("policyId", input.policyId);
  const proposedAt = requireTimestamp("proposedAt", input.proposedAt);

  return deepFreeze({
    actionId,
    actionRef,
    tenantId,
    riskClass: input.riskClass,
    proposerRef,
    actionDigest: digestContent(input.payload),
    policyId,
    proposedAt,
  });
}

/* ─────────────────────────────────────────────────────────────
 * Approver eligibility (capability + tenant scope + independence)
 * ────────────────────────────────────────────────────────────*/

export interface EligibilityRejection {
  readonly code: ApprovalChainErrorCode;
  readonly detail: string;
}

export interface EligibilityResult {
  readonly eligible: boolean;
  readonly rejections: readonly EligibilityRejection[];
}

/**
 * Evaluate approver eligibility against an action. Fail-closed laws:
 * - human only: an AI identity can never approve (§7);
 * - capability: the approver must hold APPROVER_CAPABILITY;
 * - tenant scope: the approver's scope must match the action's tenant (§13);
 * - independence: the approver must not be the proposer (§7/§21; complements
 *   J-035's proposing-identity law on the AI-output side).
 */
export function evaluateApproverEligibility(
  action: HighRiskAction,
  approver: ApproverIdentity,
): EligibilityResult {
  const rejections: EligibilityRejection[] = [];

  if (approver.identityKind !== "human") {
    rejections.push({
      code: "approver_not_human",
      detail: `approver "${approver.approverRef}" is an AI identity — AI can never approve (§7)`,
    });
  }
  if (!approver.capabilities.includes(APPROVER_CAPABILITY)) {
    rejections.push({
      code: "capability_missing",
      detail: `approver "${approver.approverRef}" does not hold "${APPROVER_CAPABILITY}"`,
    });
  }
  if (approver.tenantId !== action.tenantId) {
    rejections.push({
      code: "tenant_scope_mismatch",
      detail: `approver "${approver.approverRef}" is scoped to tenant "${approver.tenantId}", not the action's tenant "${action.tenantId}"`,
    });
  }
  if (approver.approverRef === action.proposerRef) {
    rejections.push({
      code: "self_approval_rejected",
      detail: `approver "${approver.approverRef}" is the proposer of action "${action.actionId}" — self-approval is denied`,
    });
  }

  return { eligible: rejections.length === 0, rejections: deepFreeze(rejections) };
}

/* ─────────────────────────────────────────────────────────────
 * Recording an approval (provenance captured at decision time)
 * ────────────────────────────────────────────────────────────*/

export interface ApprovalDecisionInput {
  approvalId: string;
  decidedAt: string;
  /** When the approval ceases to be valid; null means unbounded. */
  expiresAt: string | null;
  evidence: string;
}

/**
 * Record one human approval of a high-risk action. Eligibility is enforced
 * fail-closed at record time; the returned record carries the full §12
 * provenance (who, what, which policy, when, expiry, capability + tenant
 * evidence).
 */
export function approveHighRiskAction(
  action: HighRiskAction,
  approver: ApproverIdentity,
  input: ApprovalDecisionInput,
): ApprovalRecord {
  const approvalId = requireNonEmpty("approvalId", input.approvalId);
  const decidedAt = requireTimestamp("decidedAt", input.decidedAt);

  const eligibility = evaluateApproverEligibility(action, approver);
  if (!eligibility.eligible) {
    const first = eligibility.rejections[0];
    fail(first.code, first.detail);
  }

  if (typeof input.evidence !== "string" || input.evidence.trim().length === 0) {
    fail("evidence_required", "approvals are evidence-bearing: a non-empty rationale is required");
  }

  let expiresAt: string | null = null;
  if (input.expiresAt !== null && input.expiresAt !== undefined) {
    expiresAt = requireTimestamp("expiresAt", input.expiresAt);
    if (Date.parse(expiresAt) <= Date.parse(decidedAt)) {
      fail("approval_expired", "approval expiry must be in the future of its decision");
    }
  }

  return deepFreeze({
    approvalId,
    actionId: action.actionId,
    actionDigest: action.actionDigest,
    approverRef: approver.approverRef,
    identityKind: approver.identityKind,
    approverTenantId: approver.tenantId,
    approverCapabilities: [...approver.capabilities],
    policyId: action.policyId,
    decidedAt,
    expiresAt,
    evidence: input.evidence.trim(),
  });
}

/** The §12 provenance view of an approval record: who, what, which policy, until when. */
export function approvalProvenance(record: ApprovalRecord): {
  readonly approvedBy: string;
  readonly approvedWhat: { readonly actionId: string; readonly actionDigest: string };
  readonly underPolicy: string;
  readonly decidedAt: string;
  readonly expiresAt: string | null;
} {
  return deepFreeze({
    approvedBy: record.approverRef,
    approvedWhat: { actionId: record.actionId, actionDigest: record.actionDigest },
    underPolicy: record.policyId,
    decidedAt: record.decidedAt,
    expiresAt: record.expiresAt,
  });
}

/* ─────────────────────────────────────────────────────────────
 * Chain evaluation (fail-closed, re-run at execution time)
 * ────────────────────────────────────────────────────────────*/

export interface ChainRejection {
  readonly code: ApprovalChainErrorCode;
  readonly detail: string;
}

export interface ChainEvaluation {
  readonly satisfied: boolean;
  readonly requiredApprovers: number;
  readonly eligibleApprovals: readonly ApprovalRecord[];
  readonly rejections: readonly ChainRejection[];
}

/**
 * Evaluate an approval chain for an action at instant `at`. Expiry is
 * evaluated against `at`, not the approval moment — an approval that
 * expired between approval and execution voids the chain. Every rejection
 * names its reason; an empty rejection list means the chain is satisfied.
 */
export function evaluateApprovalChain(
  action: HighRiskAction,
  approvals: readonly ApprovalRecord[],
  at: string,
): ChainEvaluation {
  const atMs = Date.parse(requireTimestamp("at", at));
  const rejections: ChainRejection[] = [];
  const eligible: ApprovalRecord[] = [];

  const requiredApprovers = mandatedApproverCount(action.riskClass);

  // Append-only + uniqueness of the record set.
  const seenApprovalIds = new Set<string>();
  for (const approval of approvals) {
    if (seenApprovalIds.has(approval.approvalId)) {
      rejections.push({
        code: "duplicate_approval",
        detail: `approval "${approval.approvalId}" appears more than once — records are append-only`,
      });
    }
    seenApprovalIds.add(approval.approvalId);
  }

  // Independence: one approver may occupy at most one chain position.
  const approvalsByRef = new Map<string, ApprovalRecord[]>();
  for (const approval of approvals) {
    const list = approvalsByRef.get(approval.approverRef) ?? [];
    list.push(approval);
    approvalsByRef.set(approval.approverRef, list);
  }
  for (const [approverRef, list] of approvalsByRef) {
    if (list.length > 1) {
      rejections.push({
        code: "duplicate_approver",
        detail: `approver "${approverRef}" occupies more than one approval position — approvals must be independent`,
      });
    }
  }

  for (const approval of approvals) {
    // Binding: the approval must be for THIS action, THIS content, THIS policy.
    if (approval.actionId !== action.actionId) {
      rejections.push({
        code: "action_mismatch",
        detail: `approval "${approval.approvalId}" is for action "${approval.actionId}", not "${action.actionId}"`,
      });
      continue;
    }
    if (approval.actionDigest !== action.actionDigest) {
      rejections.push({
        code: "digest_mismatch",
        detail: `approval "${approval.approvalId}" binds digest ${approval.actionDigest}, but the action digest is ${action.actionDigest} — the action changed since approval`,
      });
      continue;
    }
    if (approval.policyId !== action.policyId) {
      rejections.push({
        code: "policy_mismatch",
        detail: `approval "${approval.approvalId}" was granted under policy "${approval.policyId}", not "${action.policyId}"`,
      });
      continue;
    }

    // Eligibility is RE-DERIVED from the record's own evidence snapshot, so
    // capability or tenant drift after approval cannot launder validity.
    const eligibility = evaluateApproverEligibility(action, {
      approverRef: approval.approverRef,
      identityKind: approval.identityKind,
      tenantId: approval.approverTenantId,
      capabilities: approval.approverCapabilities,
    });
    if (!eligibility.eligible) {
      for (const rejection of eligibility.rejections) {
        rejections.push(rejection);
      }
      continue;
    }

    if (approval.evidence.trim().length === 0) {
      rejections.push({
        code: "evidence_required",
        detail: `approval "${approval.approvalId}" carries no evidence`,
      });
      continue;
    }

    if (approval.expiresAt !== null) {
      const expiryMs = Date.parse(approval.expiresAt);
      if (Number.isNaN(expiryMs) || expiryMs <= atMs) {
        rejections.push({
          code: "approval_expired",
          detail: `approval "${approval.approvalId}" expired at ${approval.expiresAt}, evaluated at ${at}`,
        });
        continue;
      }
    }

    eligible.push(approval);
  }

  if (eligible.length < requiredApprovers) {
    rejections.push({
      code: "chain_depth_unmet",
      detail:
        `risk class "${action.riskClass}" mandates depth "${mandatedApprovalDepth(action.riskClass)}" ` +
        `(${requiredApprovers} independent approver(s)); ${eligible.length} valid approval(s) present`,
    });
  }

  return deepFreeze({
    satisfied: rejections.length === 0,
    requiredApprovers,
    eligibleApprovals: eligible,
    rejections,
  });
}

/** True when the action's approval chain is valid, unexpired and independent at instant `at`. */
export function approvalChainSatisfied(
  action: HighRiskAction,
  approvals: readonly ApprovalRecord[],
  at: string,
): boolean {
  return evaluateApprovalChain(action, approvals, at).satisfied;
}

/* ─────────────────────────────────────────────────────────────
 * The fail-closed executor gate (Decision → Action closure, J-032)
 * ────────────────────────────────────────────────────────────*/

export type GateDecision = "ALLOWED" | "DENIED";

/**
 * The audit artifact the gate ALWAYS emits — allowed or denied. For denials
 * it names every rejection reason; for approvals it binds the satisfied
 * chain (who approved what, under which policy). This is the audit trail
 * the executor leaves behind, per §29.
 */
export interface ExecutionGateAuditRecord {
  readonly auditId: string;
  readonly at: string;
  readonly actionId: string;
  readonly actionRef: string;
  readonly actionDigest: string;
  readonly tenantId: string;
  readonly riskClass: ActionRiskClass;
  readonly mandatedDepth: ApprovalDepthClass;
  readonly requiredApprovers: number;
  readonly decision: GateDecision;
  readonly reasons: readonly string[];
  readonly policyId: string;
  readonly proposerRef: string;
  readonly approvalRefs: readonly string[];
  readonly approverRefs: readonly string[];
}

export interface ExecutionGateResult {
  readonly decision: GateDecision;
  readonly audit: ExecutionGateAuditRecord;
}

/**
 * The executor gate: the LAST check before a high-risk action runs. An
 * action without a valid, unexpired, independent approval chain at `at` is
 * DENIED and audited — denial is a recorded decision, not a thrown error,
 * so a bypass path cannot exist. A satisfied chain is ALLOWED and the
 * execution audit binds the full approval provenance.
 */
export function gateHighRiskActionExecution(
  action: HighRiskAction,
  approvals: readonly ApprovalRecord[],
  at: string,
): ExecutionGateResult {
  const atStamp = requireTimestamp("at", at);
  const evaluation = evaluateApprovalChain(action, approvals, at);
  const decision: GateDecision = evaluation.satisfied ? "ALLOWED" : "DENIED";

  const audit: ExecutionGateAuditRecord = deepFreeze({
    auditId: digestContent({
      domain: "governance.approval-chains",
      actionId: action.actionId,
      actionDigest: action.actionDigest,
      decision,
      at: atStamp,
      approvalSet: evaluation.eligibleApprovals.map((approval) => approval.approvalId),
    }),
    at: atStamp,
    actionId: action.actionId,
    actionRef: action.actionRef,
    actionDigest: action.actionDigest,
    tenantId: action.tenantId,
    riskClass: action.riskClass,
    mandatedDepth: mandatedApprovalDepth(action.riskClass),
    requiredApprovers: evaluation.requiredApprovers,
    decision,
    reasons: evaluation.rejections.map((rejection) => `${rejection.code}: ${rejection.detail}`),
    policyId: action.policyId,
    proposerRef: action.proposerRef,
    approvalRefs: evaluation.eligibleApprovals.map((approval) => approval.approvalId),
    approverRefs: evaluation.eligibleApprovals.map((approval) => approval.approverRef),
  });

  return deepFreeze({ decision, audit });
}
