/**
 * Personal twin proposals (SV1-TWIN-04).
 *
 * Everything a twin offers a person is a PROPOSAL: a recommendation, a playbook
 * step, a prediction, an away-brief item or a growth-ledger entry. A proposal
 * never changes a canonical record. This module has no way to write anything:
 * no database client, no network call, no import of a server function. The only
 * outward path is `prepareExecution`, which returns a request description for
 * the EXISTING authorized operation contract; the server re-authorizes it.
 *
 * Rules enforced here:
 * - Every proposal carries a label (what it is) and a source (where it came from).
 * - A proposal that targets an operation must name a declared operation contract,
 *   the contract must be a command that requires authorization, and the AI safety
 *   boundary (`decideAiAction`) must allow a "propose" action by the lens role.
 * - Predictions are information only. They can be acknowledged or dismissed,
 *   never approved for execution.
 * - Only the owning user can approve or dismiss, and approval requires that the
 *   permission the operation needs is currently held (supplied by the server).
 * - Handoff happens once per proposal (idempotency key), and every step is audited.
 *
 * Pure functions: no I/O, no clock, no hidden state.
 */

import { decideAiAction } from "../ai-safety";
import { resolveOperationContract, type OperationContract } from "../api-contracts";

/* ─────────────────────────────────────────────────────────────
 * Types
 * ────────────────────────────────────────────────────────────*/

export type ProposalKind = "recommendation" | "playbook_step" | "prediction" | "away_brief_item";

/** What the person sees on the card. A prediction is never shown as a recommendation. */
export const PROPOSAL_LABEL: Readonly<Record<ProposalKind, string>> = Object.freeze({
  recommendation: "Recommendation",
  playbook_step: "Playbook suggestion",
  prediction: "Prediction",
  away_brief_item: "While you were away",
});

export type ProposalSourceKind = "record" | "rule" | "playbook" | "model" | "history";

export interface ProposalSource {
  readonly kind: ProposalSourceKind;
  /** Opaque reference to what the proposal was derived from. Never the content itself. */
  readonly ref: string;
  /** When the source data was current. Used to label stale proposals. */
  readonly asOfMs: number;
  /** One line a person can read: "Attendance below 80% for 3 weeks". */
  readonly description: string;
}

export type ProposalStatus =
  | "proposed"
  | "approved"
  | "dismissed"
  | "acknowledged"
  | "expired"
  | "handed_off"
  | "executed"
  | "execution_failed";

export interface Proposal {
  readonly proposalId: string;
  readonly kind: ProposalKind;
  readonly label: string;
  readonly tenantRef: string;
  readonly userRef: string;
  /** The role code the twin is acting under (from the active lens). */
  readonly roleCode: string;
  readonly summary: string;
  readonly source: ProposalSource;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly correlationId: string;
  /** Operation this would run if approved; null for information-only items. */
  readonly operationId: string | null;
  /** Opaque reference to the input for the operation; never the input itself. */
  readonly inputRef: string | null;
  /** The permission the operation needs; checked again at approval. */
  readonly requiredPermission: string | null;
  /** Predictions only: 0..1. */
  readonly confidence: number | null;
  readonly status: ProposalStatus;
}

export type ProposalAuditKind =
  | "created"
  | "rejected"
  | "approved"
  | "dismissed"
  | "acknowledged"
  | "expired"
  | "handed_off"
  | "execution_outcome";

export interface ProposalAuditRecord {
  readonly seq: number;
  readonly atMs: number;
  readonly kind: ProposalAuditKind;
  readonly proposalId: string | null;
  readonly actorUserRef: string | null;
  readonly correlationId: string | null;
  readonly detail: string;
}

export interface ProposalStore {
  readonly proposals: readonly Proposal[];
  readonly audit: readonly ProposalAuditRecord[];
  readonly nextSeq: number;
}

export const EMPTY_PROPOSAL_STORE: ProposalStore = Object.freeze({
  proposals: Object.freeze([]),
  audit: Object.freeze([]),
  nextSeq: 1,
});

export const MAX_PROPOSAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_SUMMARY_LENGTH = 280;

/* ─────────────────────────────────────────────────────────────
 * Helpers
 * ────────────────────────────────────────────────────────────*/

const nonEmpty = (s: unknown): s is string => typeof s === "string" && s.trim().length > 0;

function audit(
  store: ProposalStore,
  atMs: number,
  kind: ProposalAuditKind,
  detail: string,
  ctx: { proposalId?: string | null; actorUserRef?: string | null; correlationId?: string | null },
): ProposalStore {
  const rec: ProposalAuditRecord = Object.freeze({
    seq: store.nextSeq,
    atMs,
    kind,
    proposalId: ctx.proposalId ?? null,
    actorUserRef: ctx.actorUserRef ?? null,
    correlationId: ctx.correlationId ?? null,
    detail,
  });
  return { ...store, audit: [...store.audit, rec], nextSeq: store.nextSeq + 1 };
}

function replace(store: ProposalStore, next: Proposal): ProposalStore {
  return {
    ...store,
    proposals: store.proposals.map((p) => (p.proposalId === next.proposalId ? next : p)),
  };
}

/* ─────────────────────────────────────────────────────────────
 * Create
 * ────────────────────────────────────────────────────────────*/

export interface NewProposal {
  readonly proposalId: string;
  readonly kind: ProposalKind;
  readonly tenantRef: string;
  readonly userRef: string;
  readonly roleCode: string;
  readonly summary: string;
  readonly source: ProposalSource;
  readonly ttlMs: number;
  readonly correlationId: string;
  readonly operationId?: string | null;
  readonly inputRef?: string | null;
  readonly requiredPermission?: string | null;
  readonly confidence?: number | null;
}

export type CreateRejection =
  | "invalid_proposal"
  | "duplicate_proposal"
  | "source_required"
  | "summary_too_long"
  | "ttl_out_of_range"
  | "prediction_cannot_target_operation"
  | "prediction_needs_confidence"
  | "operation_not_declared"
  | "operation_not_a_command"
  | "operation_needs_permission"
  | "safety_boundary_denied";

export type CreateResult =
  | { readonly ok: true; readonly store: ProposalStore; readonly proposal: Proposal }
  | { readonly ok: false; readonly store: ProposalStore; readonly reason: CreateRejection };

export function createProposal(
  store: ProposalStore,
  input: NewProposal,
  contracts: readonly OperationContract[],
  nowMs: number,
): CreateResult {
  const fail = (reason: CreateRejection): CreateResult => ({
    ok: false,
    reason,
    store: audit(store, nowMs, "rejected", reason, {
      proposalId: nonEmpty(input?.proposalId) ? input.proposalId : null,
      actorUserRef: nonEmpty(input?.userRef) ? input.userRef : null,
      correlationId: nonEmpty(input?.correlationId) ? input.correlationId : null,
    }),
  });

  if (
    !input ||
    !nonEmpty(input.proposalId) ||
    !nonEmpty(input.tenantRef) ||
    !nonEmpty(input.userRef) ||
    !nonEmpty(input.roleCode) ||
    !nonEmpty(input.summary) ||
    !nonEmpty(input.correlationId) ||
    !(input.kind in PROPOSAL_LABEL)
  ) {
    return fail("invalid_proposal");
  }
  if (store.proposals.some((p) => p.proposalId === input.proposalId)) {
    return fail("duplicate_proposal");
  }
  if (input.summary.length > MAX_SUMMARY_LENGTH) return fail("summary_too_long");
  const src = input.source;
  if (
    !src ||
    !nonEmpty(src.ref) ||
    !nonEmpty(src.description) ||
    !Number.isFinite(src.asOfMs) ||
    src.asOfMs < 0
  ) {
    return fail("source_required");
  }
  if (!Number.isFinite(input.ttlMs) || input.ttlMs <= 0 || input.ttlMs > MAX_PROPOSAL_TTL_MS) {
    return fail("ttl_out_of_range");
  }

  const operationId = input.operationId ?? null;
  const requiredPermission = input.requiredPermission ?? null;
  const confidence = input.confidence ?? null;

  if (input.kind === "prediction") {
    if (operationId !== null || input.inputRef) return fail("prediction_cannot_target_operation");
    if (confidence === null || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      return fail("prediction_needs_confidence");
    }
  }

  if (operationId !== null) {
    const contract = resolveOperationContract(contracts, operationId);
    if (!contract) return fail("operation_not_declared");
    if (contract.kind !== "command" || !contract.requiresAuthorization) {
      return fail("operation_not_a_command");
    }
    if (!nonEmpty(requiredPermission)) return fail("operation_needs_permission");
    // The twin may only ever PROPOSE, and only under an explicit authorizing role.
    const decision = decideAiAction({
      action: "propose",
      targetKind: contract.surface,
      summary: input.summary,
      authorizedByRole: input.roleCode,
    });
    if (!decision.allowed) return fail("safety_boundary_denied");
  }

  const proposal: Proposal = Object.freeze({
    proposalId: input.proposalId,
    kind: input.kind,
    label: PROPOSAL_LABEL[input.kind],
    tenantRef: input.tenantRef,
    userRef: input.userRef,
    roleCode: input.roleCode,
    summary: input.summary.trim(),
    source: Object.freeze({ ...src }),
    createdAtMs: nowMs,
    expiresAtMs: nowMs + input.ttlMs,
    correlationId: input.correlationId,
    operationId,
    inputRef: input.inputRef ?? null,
    requiredPermission,
    confidence,
    status: "proposed" as const,
  });
  const next: ProposalStore = { ...store, proposals: [...store.proposals, proposal] };
  return {
    ok: true,
    proposal,
    store: audit(next, nowMs, "created", `${proposal.kind}:${proposal.label}`, {
      proposalId: proposal.proposalId,
      actorUserRef: proposal.userRef,
      correlationId: proposal.correlationId,
    }),
  };
}

/* ─────────────────────────────────────────────────────────────
 * Decide: approve, dismiss, acknowledge
 * ────────────────────────────────────────────────────────────*/

/** Who is acting, as resolved by the server. Never taken from the client. */
export interface Actor {
  readonly tenantRef: string;
  readonly userRef: string;
  /** Permissions the person holds right now in the active role context. */
  readonly heldPermissions: readonly string[];
}

export type DecisionRejection =
  | "unknown_proposal"
  | "not_owner"
  | "tenant_mismatch"
  | "not_open"
  | "proposal_expired"
  | "prediction_not_actionable"
  | "information_only"
  | "permission_not_held";

export type DecisionResult =
  | { readonly ok: true; readonly store: ProposalStore; readonly proposal: Proposal }
  | { readonly ok: false; readonly store: ProposalStore; readonly reason: DecisionRejection };

function open(
  store: ProposalStore,
  proposalId: string,
  actor: Actor,
  nowMs: number,
): { p: Proposal } | { reason: DecisionRejection; store: ProposalStore } {
  const p = store.proposals.find((x) => x.proposalId === proposalId);
  if (!p) return { reason: "unknown_proposal", store };
  if (p.tenantRef !== actor.tenantRef) return { reason: "tenant_mismatch", store };
  if (p.userRef !== actor.userRef) return { reason: "not_owner", store };
  if (p.status !== "proposed") return { reason: "not_open", store };
  if (nowMs > p.expiresAtMs) {
    const expired = { ...p, status: "expired" as const };
    return {
      reason: "proposal_expired",
      store: audit(replace(store, expired), nowMs, "expired", "decision_after_expiry", {
        proposalId: p.proposalId,
        actorUserRef: actor.userRef,
        correlationId: p.correlationId,
      }),
    };
  }
  return { p };
}

function decide(
  store: ProposalStore,
  proposalId: string,
  actor: Actor,
  nowMs: number,
  to: "approved" | "dismissed" | "acknowledged",
  check?: (p: Proposal) => DecisionRejection | null,
): DecisionResult {
  const o = open(store, proposalId, actor, nowMs);
  if ("reason" in o) return { ok: false, reason: o.reason, store: o.store };
  const rejection = check?.(o.p) ?? null;
  if (rejection) {
    return {
      ok: false,
      reason: rejection,
      store: audit(store, nowMs, "rejected", `${to}:${rejection}`, {
        proposalId,
        actorUserRef: actor.userRef,
        correlationId: o.p.correlationId,
      }),
    };
  }
  const next: Proposal = { ...o.p, status: to };
  return {
    ok: true,
    proposal: next,
    store: audit(replace(store, next), nowMs, to, to, {
      proposalId,
      actorUserRef: actor.userRef,
      correlationId: o.p.correlationId,
    }),
  };
}

/** Approve a proposal. Approval is consent only; it does not run anything. */
export function approveProposal(
  store: ProposalStore,
  proposalId: string,
  actor: Actor,
  nowMs: number,
): DecisionResult {
  return decide(store, proposalId, actor, nowMs, "approved", (p) => {
    if (p.kind === "prediction") return "prediction_not_actionable";
    if (p.operationId === null) return "information_only";
    if (!p.requiredPermission || !actor.heldPermissions.includes(p.requiredPermission)) {
      return "permission_not_held";
    }
    return null;
  });
}

export function dismissProposal(
  store: ProposalStore,
  proposalId: string,
  actor: Actor,
  nowMs: number,
): DecisionResult {
  return decide(store, proposalId, actor, nowMs, "dismissed");
}

/** Acknowledge an information-only item (prediction, brief item, or a proposal with no operation). */
export function acknowledgeProposal(
  store: ProposalStore,
  proposalId: string,
  actor: Actor,
  nowMs: number,
): DecisionResult {
  return decide(store, proposalId, actor, nowMs, "acknowledged", (p) =>
    p.operationId !== null ? "information_only" : null,
  );
}

/** Mark every open proposal past its expiry. The host calls this; nothing polls. */
export function expireProposals(store: ProposalStore, nowMs: number): ProposalStore {
  let next = store;
  for (const p of store.proposals) {
    if (p.status === "proposed" && nowMs > p.expiresAtMs) {
      next = audit(replace(next, { ...p, status: "expired" }), nowMs, "expired", "ttl", {
        proposalId: p.proposalId,
        correlationId: p.correlationId,
      });
    }
  }
  return next;
}

/* ─────────────────────────────────────────────────────────────
 * Hand-off to the existing authorized API
 * ────────────────────────────────────────────────────────────*/

/** A description of a call the HOST may make to the existing operation. Nothing is called here. */
export interface ExecutionRequest {
  readonly operationId: string;
  readonly inputRef: string | null;
  readonly onBehalfOf: { readonly tenantRef: string; readonly userRef: string };
  readonly proposalId: string;
  readonly correlationId: string;
  /** The receiving operation must treat a repeat of this key as the same request. */
  readonly idempotencyKey: string;
}

export type HandoffRejection =
  | "unknown_proposal"
  | "not_owner"
  | "tenant_mismatch"
  | "not_approved"
  | "operation_not_declared"
  | "operation_not_a_command"
  | "permission_not_held";

export type HandoffResult =
  | { readonly ok: true; readonly store: ProposalStore; readonly request: ExecutionRequest }
  | { readonly ok: false; readonly store: ProposalStore; readonly reason: HandoffRejection };

/**
 * Turn an approved proposal into a one-time request for the existing authorized
 * operation. The contract and the held permission are checked again, so a
 * permission revoked after approval stops the handoff.
 */
export function prepareExecution(
  store: ProposalStore,
  proposalId: string,
  actor: Actor,
  contracts: readonly OperationContract[],
  nowMs: number,
): HandoffResult {
  const p = store.proposals.find((x) => x.proposalId === proposalId);
  const fail = (reason: HandoffRejection): HandoffResult => ({
    ok: false,
    reason,
    store: audit(store, nowMs, "rejected", `handoff:${reason}`, {
      proposalId,
      actorUserRef: actor.userRef,
      correlationId: p?.correlationId ?? null,
    }),
  });
  if (!p) return fail("unknown_proposal");
  if (p.tenantRef !== actor.tenantRef) return fail("tenant_mismatch");
  if (p.userRef !== actor.userRef) return fail("not_owner");
  if (p.status !== "approved" || p.operationId === null) return fail("not_approved");
  const contract = resolveOperationContract(contracts, p.operationId);
  if (!contract) return fail("operation_not_declared");
  if (contract.kind !== "command" || !contract.requiresAuthorization) {
    return fail("operation_not_a_command");
  }
  if (!p.requiredPermission || !actor.heldPermissions.includes(p.requiredPermission)) {
    return fail("permission_not_held");
  }
  const handed: Proposal = { ...p, status: "handed_off" };
  const request: ExecutionRequest = Object.freeze({
    operationId: p.operationId,
    inputRef: p.inputRef,
    onBehalfOf: Object.freeze({ tenantRef: p.tenantRef, userRef: p.userRef }),
    proposalId: p.proposalId,
    correlationId: p.correlationId,
    idempotencyKey: `twin-proposal:${p.proposalId}`,
  });
  return {
    ok: true,
    request,
    store: audit(replace(store, handed), nowMs, "handed_off", p.operationId, {
      proposalId,
      actorUserRef: actor.userRef,
      correlationId: p.correlationId,
    }),
  };
}

export type ExecutionOutcome = "succeeded" | "failed" | "denied";

/** Record what the authorized operation reported. The twin never decides success itself. */
export function recordExecutionOutcome(
  store: ProposalStore,
  proposalId: string,
  outcome: ExecutionOutcome,
  nowMs: number,
): { ok: boolean; store: ProposalStore } {
  const p = store.proposals.find((x) => x.proposalId === proposalId);
  if (!p || p.status !== "handed_off") return { ok: false, store };
  const next: Proposal = {
    ...p,
    status: outcome === "succeeded" ? "executed" : "execution_failed",
  };
  return {
    ok: true,
    store: audit(replace(store, next), nowMs, "execution_outcome", outcome, {
      proposalId,
      correlationId: p.correlationId,
    }),
  };
}

/* ─────────────────────────────────────────────────────────────
 * Presentation helpers
 * ────────────────────────────────────────────────────────────*/

export type Freshness = "fresh" | "stale";

export interface ProposalCard {
  readonly proposalId: string;
  readonly label: string;
  readonly summary: string;
  readonly sourceDescription: string;
  readonly sourceKind: ProposalSourceKind;
  readonly sourceAgeMs: number;
  readonly freshness: Freshness;
  readonly confidence: number | null;
  readonly actionable: boolean;
  readonly status: ProposalStatus;
}

/** What the UI shows: always a label, always a source, and a stale mark when the source is old. */
export function toCard(p: Proposal, nowMs: number, staleAfterMs: number): ProposalCard {
  const age = Math.max(0, nowMs - p.source.asOfMs);
  return Object.freeze({
    proposalId: p.proposalId,
    label: p.label,
    summary: p.summary,
    sourceDescription: p.source.description,
    sourceKind: p.source.kind,
    sourceAgeMs: age,
    freshness: age > staleAfterMs ? ("stale" as const) : ("fresh" as const),
    confidence: p.confidence,
    actionable: p.status === "proposed" && p.operationId !== null && p.kind !== "prediction",
    status: p.status,
  });
}

export interface AwayBrief {
  readonly sinceMs: number;
  readonly untilMs: number;
  readonly items: readonly ProposalCard[];
  readonly omitted: number;
  readonly counts: Readonly<Record<ProposalKind, number>>;
  /** Always true: a brief only ever lists proposals and never reports a completed action. */
  readonly proposalsOnly: true;
}

/**
 * The brief for a person who was away: open proposals created since they were
 * last here, newest source first, bounded, each with its source and freshness.
 */
export function composeAwayBrief(
  store: ProposalStore,
  owner: { readonly tenantRef: string; readonly userRef: string },
  sinceMs: number,
  nowMs: number,
  opts: { readonly maxItems: number; readonly staleAfterMs: number },
): AwayBrief {
  const mine = store.proposals
    .filter(
      (p) =>
        p.tenantRef === owner.tenantRef &&
        p.userRef === owner.userRef &&
        p.status === "proposed" &&
        p.createdAtMs >= sinceMs &&
        nowMs <= p.expiresAtMs,
    )
    .sort((a, b) => b.source.asOfMs - a.source.asOfMs || (a.proposalId < b.proposalId ? -1 : 1));
  const counts: Record<ProposalKind, number> = {
    recommendation: 0,
    playbook_step: 0,
    prediction: 0,
    away_brief_item: 0,
  };
  for (const p of mine) counts[p.kind] += 1;
  const shown = mine.slice(0, Math.max(0, opts.maxItems));
  return Object.freeze({
    sinceMs,
    untilMs: nowMs,
    items: shown.map((p) => toCard(p, nowMs, opts.staleAfterMs)),
    omitted: mine.length - shown.length,
    counts: Object.freeze(counts),
    proposalsOnly: true as const,
  });
}

/* ─────────────────────────────────────────────────────────────
 * Role playbooks
 * ────────────────────────────────────────────────────────────*/

export interface PlaybookStep {
  readonly stepId: string;
  readonly summary: string;
  /** Null for a reminder with no operation behind it. */
  readonly operationId: string | null;
  readonly requiredPermission: string | null;
}

export interface RolePlaybook {
  readonly playbookId: string;
  readonly roleCodes: readonly string[];
  readonly steps: readonly PlaybookStep[];
}

/**
 * Instantiate the steps a person's role and permissions allow. A step that needs
 * a permission the lens does not hold is skipped: a playbook can only narrow.
 */
export function instantiatePlaybook(
  playbook: RolePlaybook,
  ctx: {
    readonly tenantRef: string;
    readonly userRef: string;
    readonly roleCode: string;
    readonly heldPermissions: readonly string[];
    readonly correlationId: string;
    readonly asOfMs: number;
    readonly ttlMs: number;
  },
): readonly NewProposal[] {
  if (!playbook.roleCodes.includes(ctx.roleCode)) return [];
  return playbook.steps
    .filter(
      (s) => s.requiredPermission === null || ctx.heldPermissions.includes(s.requiredPermission),
    )
    .map((s) => ({
      proposalId: `${playbook.playbookId}:${s.stepId}:${ctx.correlationId}`,
      kind: "playbook_step" as const,
      tenantRef: ctx.tenantRef,
      userRef: ctx.userRef,
      roleCode: ctx.roleCode,
      summary: s.summary,
      source: {
        kind: "playbook" as const,
        ref: `${playbook.playbookId}#${s.stepId}`,
        asOfMs: ctx.asOfMs,
        description: `Playbook ${playbook.playbookId}, step ${s.stepId}`,
      },
      ttlMs: ctx.ttlMs,
      correlationId: ctx.correlationId,
      operationId: s.operationId,
      requiredPermission: s.requiredPermission,
    }));
}

/* ─────────────────────────────────────────────────────────────
 * Growth ledger
 * ────────────────────────────────────────────────────────────*/

export type GrowthEntryKind =
  "recommendation_accepted" | "recommendation_dismissed" | "prediction_acknowledged" | "user_note";

export interface GrowthEntry {
  readonly seq: number;
  readonly atMs: number;
  readonly kind: GrowthEntryKind;
  readonly tenantRef: string;
  readonly userRef: string;
  /** The proposal this entry records, or null for a note the person wrote. */
  readonly proposalId: string | null;
  /** A short note written by the person. Never copied from a canonical record. */
  readonly note: string | null;
}

export interface GrowthLedger {
  readonly entries: readonly GrowthEntry[];
}

export const EMPTY_GROWTH_LEDGER: GrowthLedger = Object.freeze({ entries: Object.freeze([]) });
export const MAX_GROWTH_NOTE_LENGTH = 500;

export type GrowthResult =
  | { readonly ok: true; readonly ledger: GrowthLedger }
  | {
      readonly ok: false;
      readonly ledger: GrowthLedger;
      readonly reason:
        | "unknown_proposal"
        | "not_owner"
        | "proposal_still_open"
        | "already_recorded"
        | "note_required"
        | "note_too_long";
    };

/**
 * Append a growth entry for a proposal the person has decided on, or a note they
 * wrote themselves. The ledger is append-only and owned by one person.
 */
export function appendGrowthEntry(
  ledger: GrowthLedger,
  store: ProposalStore,
  owner: { readonly tenantRef: string; readonly userRef: string },
  entry: { readonly proposalId: string | null; readonly note: string | null },
  nowMs: number,
): GrowthResult {
  const fail = (reason: Extract<GrowthResult, { ok: false }>["reason"]): GrowthResult => ({
    ok: false,
    ledger,
    reason,
  });
  const note = entry.note?.trim() ?? null;
  if (note !== null && note.length > MAX_GROWTH_NOTE_LENGTH) return fail("note_too_long");

  let kind: GrowthEntryKind = "user_note";
  if (entry.proposalId === null) {
    if (!note) return fail("note_required");
  } else {
    const p = store.proposals.find((x) => x.proposalId === entry.proposalId);
    if (!p) return fail("unknown_proposal");
    if (p.tenantRef !== owner.tenantRef || p.userRef !== owner.userRef) return fail("not_owner");
    if (ledger.entries.some((e) => e.proposalId === p.proposalId)) return fail("already_recorded");
    if (p.status === "proposed") return fail("proposal_still_open");
    if (p.status === "dismissed") kind = "recommendation_dismissed";
    else if (p.status === "acknowledged") kind = "prediction_acknowledged";
    else if (p.status === "expired") return fail("proposal_still_open");
    else kind = "recommendation_accepted";
  }
  const e: GrowthEntry = Object.freeze({
    seq: ledger.entries.length + 1,
    atMs: nowMs,
    kind,
    tenantRef: owner.tenantRef,
    userRef: owner.userRef,
    proposalId: entry.proposalId,
    note,
  });
  return { ok: true, ledger: { entries: [...ledger.entries, e] } };
}

/** True when the sequence is 1..n with no gaps and no entry belongs to another owner. */
export function verifyGrowthLedger(
  ledger: GrowthLedger,
  owner: { readonly tenantRef: string; readonly userRef: string },
): boolean {
  return ledger.entries.every(
    (e, i) =>
      e.seq === i + 1 &&
      e.tenantRef === owner.tenantRef &&
      e.userRef === owner.userRef &&
      (i === 0 || e.atMs >= ledger.entries[i - 1].atMs),
  );
}
