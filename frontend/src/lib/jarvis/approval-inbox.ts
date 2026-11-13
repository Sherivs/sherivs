/**
 * JARVIS durable approval inbox (SV1-JARVIS-02).
 *
 * A pure, deterministic state machine for approval requests raised by JARVIS
 * agents. It mirrors the append-only PostgreSQL model in migration
 * 20261103165000 and is the contract the server layer must satisfy; it does no
 * I/O and never reads the wall clock (callers pass `now`).
 *
 * Laws enforced here (all fail closed with a typed code):
 * - Only T2/T3 actions are approvable. T0/T1 need no approval, T4 and unmapped
 *   actions are never approvable.
 * - Requests carry an expiry and an idempotency key. Re-sending the same
 *   request returns the original; reusing the key for a different request is
 *   rejected.
 * - A request is decided at most once. A replayed decision is rejected.
 * - Only a verified human can decide; never the requesting agent identity.
 * - Phone channels (whatsapp, voice, sms) may only acknowledge or deny. They can
 *   never approve; T3 approval additionally requires console passkey step-up by
 *   a sheriff.
 * - Execution revalidates: the approval must still be approved, unexpired,
 *   unused, and bound to the same action and precondition digest. It is
 *   single-use.
 */

import {
  JARVIS_RISK_TIER_POLICY,
  type JarvisHumanApprovalEvidence,
  type JarvisRiskActionId,
} from "./risk-policy";

export const APPROVAL_CHANNELS = ["console", "whatsapp", "voice", "sms", "email"] as const;
export type ApprovalChannel = (typeof APPROVAL_CHANNELS)[number];

export const APPROVAL_STATUSES = ["pending", "approved", "denied", "expired", "executed"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export type ApprovalDecisionKind = "approve" | "deny" | "acknowledge";
export type ApprovalTier = "T2" | "T3";

export const MAX_APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

export interface ApprovalRequest {
  readonly approvalId: string;
  readonly idempotencyKey: string;
  readonly actionId: string;
  readonly actionRef: string;
  readonly agentDefinitionId: string;
  /** Identity of the requesting agent; it can never decide its own request. */
  readonly requesterRef: string;
  readonly platformRef: string;
  readonly riskTier: ApprovalTier;
  /** Digest of the preconditions the approval was granted against. */
  readonly preconditionsDigest: string;
  readonly requestedAt: string;
  readonly expiresAt: string;
  readonly status: ApprovalStatus;
  readonly decidedBy: string | null;
  readonly decidedRole: "platform_staff" | "sheriff" | null;
  readonly decidedAt: string | null;
  readonly passkeyStepUpVerified: boolean;
  readonly executedAt: string | null;
}

export interface ApprovalEvent {
  readonly eventSeq: number;
  readonly approvalId: string;
  readonly kind: "requested" | ApprovalDecisionKind | "expired" | "executed" | "rejected";
  readonly channel: ApprovalChannel | null;
  readonly actorRef: string | null;
  readonly code: string | null;
  readonly at: string;
}

/** Append-only inbox state; every transition returns a new value. */
export interface ApprovalInboxState {
  readonly requests: readonly ApprovalRequest[];
  readonly events: readonly ApprovalEvent[];
}

export const EMPTY_APPROVAL_INBOX: ApprovalInboxState = { requests: [], events: [] };

export type ApprovalErrorCode =
  | "invalid_input"
  | "unknown_action"
  | "tier_not_approvable"
  | "invalid_expiry"
  | "idempotency_conflict"
  | "not_found"
  | "expired"
  | "already_decided"
  | "ai_identity_cannot_decide"
  | "self_approval_forbidden"
  | "channel_cannot_approve"
  | "role_insufficient"
  | "passkey_step_up_required"
  | "not_approved"
  | "already_executed"
  | "action_mismatch"
  | "preconditions_changed";

export type ApprovalResult<T> =
  | ({ readonly ok: true; readonly state: ApprovalInboxState } & T)
  | {
      readonly ok: false;
      readonly code: ApprovalErrorCode;
      readonly reason: string;
      /** State with the rejection recorded (and any due expiry applied). */
      readonly state: ApprovalInboxState;
    };

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const instant = (v: unknown): number => (typeof v === "string" ? Date.parse(v) : Number.NaN);

function append(
  state: ApprovalInboxState,
  event: Omit<ApprovalEvent, "eventSeq">,
  patch?: ApprovalRequest,
): ApprovalInboxState {
  return {
    requests:
      patch === undefined
        ? state.requests
        : state.requests.map((r) => (r.approvalId === patch.approvalId ? patch : r)),
    events: [...state.events, { ...event, eventSeq: state.events.length + 1 }],
  };
}

function reject(
  state: ApprovalInboxState,
  code: ApprovalErrorCode,
  reason: string,
  ctx: {
    approvalId: string;
    channel: ApprovalChannel | null;
    actorRef: string | null;
    at: string;
    patch?: ApprovalRequest;
  },
): { ok: false; code: ApprovalErrorCode; reason: string; state: ApprovalInboxState } {
  return {
    ok: false,
    code,
    reason,
    state: append(
      state,
      {
        approvalId: ctx.approvalId,
        kind: "rejected",
        channel: ctx.channel,
        actorRef: ctx.actorRef,
        code,
        at: ctx.at,
      },
      ctx.patch,
    ),
  };
}

/** Apply expiry to a pending/approved request that is past its deadline. */
function withExpiry(
  state: ApprovalInboxState,
  request: ApprovalRequest,
  now: string,
): { state: ApprovalInboxState; request: ApprovalRequest } {
  if (
    (request.status === "pending" || request.status === "approved") &&
    instant(now) >= instant(request.expiresAt)
  ) {
    const expired: ApprovalRequest = { ...request, status: "expired" };
    return {
      state: append(
        state,
        {
          approvalId: request.approvalId,
          kind: "expired",
          channel: null,
          actorRef: null,
          code: null,
          at: now,
        },
        expired,
      ),
      request: expired,
    };
  }
  return { state, request };
}

export function expireDueApprovals(state: ApprovalInboxState, now: string): ApprovalInboxState {
  let next = state;
  for (const request of state.requests) {
    next = withExpiry(next, request, now).state;
  }
  return next;
}

export interface CreateApprovalInput {
  readonly approvalId: string;
  readonly idempotencyKey: string;
  readonly actionId: string;
  readonly actionRef: string;
  readonly agentDefinitionId: string;
  readonly requesterRef: string;
  readonly platformRef: string;
  readonly preconditionsDigest: string;
  readonly expiresAt: string;
}

function sameRequestPayload(r: ApprovalRequest, i: CreateApprovalInput): boolean {
  return (
    r.actionId === i.actionId &&
    r.actionRef === i.actionRef &&
    r.agentDefinitionId === i.agentDefinitionId &&
    r.requesterRef === i.requesterRef &&
    r.platformRef === i.platformRef &&
    r.preconditionsDigest === i.preconditionsDigest
  );
}

export function createApprovalRequest(
  state: ApprovalInboxState,
  input: CreateApprovalInput,
  now: string,
): ApprovalResult<{ request: ApprovalRequest; replayed: boolean }> {
  const ctx = { approvalId: input?.approvalId ?? "", channel: null, actorRef: null, at: now };
  if (
    !Number.isFinite(instant(now)) ||
    ![
      input?.approvalId,
      input?.idempotencyKey,
      input?.actionId,
      input?.actionRef,
      input?.agentDefinitionId,
      input?.requesterRef,
      input?.platformRef,
      input?.preconditionsDigest,
    ].every(nonEmpty)
  ) {
    return reject(state, "invalid_input", "All request fields and a valid time are required", ctx);
  }
  const existing = state.requests.find((r) => r.idempotencyKey === input.idempotencyKey);
  if (existing !== undefined) {
    if (sameRequestPayload(existing, input)) {
      return { ok: true, state, request: existing, replayed: true };
    }
    return reject(
      state,
      "idempotency_conflict",
      "Idempotency key was already used for a different request",
      { ...ctx, approvalId: existing.approvalId },
    );
  }
  if (state.requests.some((r) => r.approvalId === input.approvalId)) {
    return reject(state, "idempotency_conflict", "approvalId already exists", ctx);
  }
  if (!Object.hasOwn(JARVIS_RISK_TIER_POLICY, input.actionId)) {
    return reject(state, "unknown_action", "Action is unmapped; approvals fail closed", ctx);
  }
  const tier = JARVIS_RISK_TIER_POLICY[input.actionId as JarvisRiskActionId];
  if (tier !== "T2" && tier !== "T3") {
    return reject(
      state,
      "tier_not_approvable",
      `${tier} actions do not use the approval inbox (T0/T1 need none, T4 is always denied)`,
      ctx,
    );
  }
  const requestedAt = instant(now);
  const expiresAt = instant(input.expiresAt);
  if (
    !Number.isFinite(expiresAt) ||
    expiresAt <= requestedAt ||
    expiresAt - requestedAt > MAX_APPROVAL_TTL_MS
  ) {
    return reject(state, "invalid_expiry", "Expiry must be in the future and within 24 hours", ctx);
  }
  const request: ApprovalRequest = {
    approvalId: input.approvalId,
    idempotencyKey: input.idempotencyKey,
    actionId: input.actionId,
    actionRef: input.actionRef,
    agentDefinitionId: input.agentDefinitionId,
    requesterRef: input.requesterRef,
    platformRef: input.platformRef,
    riskTier: tier,
    preconditionsDigest: input.preconditionsDigest,
    requestedAt: now,
    expiresAt: input.expiresAt,
    status: "pending",
    decidedBy: null,
    decidedRole: null,
    decidedAt: null,
    passkeyStepUpVerified: false,
    executedAt: null,
  };
  return {
    ok: true,
    request,
    replayed: false,
    state: {
      requests: [...state.requests, request],
      events: [
        ...state.events,
        {
          eventSeq: state.events.length + 1,
          approvalId: request.approvalId,
          kind: "requested",
          channel: null,
          actorRef: request.requesterRef,
          code: null,
          at: now,
        },
      ],
    },
  };
}

export interface DecideApprovalInput {
  readonly approvalId: string;
  readonly decision: ApprovalDecisionKind;
  readonly channel: ApprovalChannel;
  readonly approverId: string;
  readonly approverRole: "platform_staff" | "sheriff";
  readonly identityKind: "human" | "ai";
  readonly humanIdentityVerified: boolean;
  readonly passkeyStepUpVerified: boolean;
}

export function decideApproval(
  state: ApprovalInboxState,
  input: DecideApprovalInput,
  now: string,
): ApprovalResult<{ request: ApprovalRequest }> {
  const ctx = {
    approvalId: input?.approvalId ?? "",
    channel: APPROVAL_CHANNELS.includes(input?.channel) ? input.channel : null,
    actorRef: nonEmpty(input?.approverId) ? input.approverId : null,
    at: now,
  };
  if (
    !Number.isFinite(instant(now)) ||
    !nonEmpty(input?.approvalId) ||
    !nonEmpty(input?.approverId) ||
    !["approve", "deny", "acknowledge"].includes(input.decision) ||
    !APPROVAL_CHANNELS.includes(input.channel) ||
    !["platform_staff", "sheriff"].includes(input.approverRole)
  ) {
    return reject(state, "invalid_input", "Malformed decision", ctx);
  }
  const found = state.requests.find((r) => r.approvalId === input.approvalId);
  if (found === undefined) {
    return reject(state, "not_found", "Approval request does not exist", ctx);
  }
  const { state: afterExpiry, request } = withExpiry(state, found, now);
  const rctx = { ...ctx };
  if (request.status === "expired") {
    return reject(afterExpiry, "expired", "Approval request has expired", rctx);
  }
  if (request.status !== "pending") {
    return reject(
      afterExpiry,
      "already_decided",
      "Approval request was already decided; replays are rejected",
      rctx,
    );
  }
  if (input.identityKind !== "human" || input.humanIdentityVerified !== true) {
    return reject(
      afterExpiry,
      "ai_identity_cannot_decide",
      "Only a verified human identity can decide an approval",
      rctx,
    );
  }
  if (input.approverId === request.requesterRef) {
    return reject(
      afterExpiry,
      "self_approval_forbidden",
      "The requester cannot decide its own request",
      rctx,
    );
  }

  if (input.decision === "acknowledge") {
    // Records receipt only; the request stays pending. Any channel may acknowledge.
    return {
      ok: true,
      request,
      state: append(afterExpiry, {
        approvalId: request.approvalId,
        kind: "acknowledge",
        channel: input.channel,
        actorRef: input.approverId,
        code: null,
        at: now,
      }),
    };
  }
  if (input.decision === "approve") {
    if (input.channel !== "console") {
      return reject(
        afterExpiry,
        "channel_cannot_approve",
        "Phone and message channels may only acknowledge or deny, never approve",
        rctx,
      );
    }
    if (request.riskTier === "T3") {
      if (input.approverRole !== "sheriff") {
        return reject(afterExpiry, "role_insufficient", "T3 approval requires a sheriff", rctx);
      }
      if (input.passkeyStepUpVerified !== true) {
        return reject(
          afterExpiry,
          "passkey_step_up_required",
          "T3 approval requires console passkey step-up",
          rctx,
        );
      }
    }
  }
  const decided: ApprovalRequest = {
    ...request,
    status: input.decision === "approve" ? "approved" : "denied",
    decidedBy: input.approverId,
    decidedRole: input.approverRole,
    decidedAt: now,
    passkeyStepUpVerified: input.decision === "approve" && input.passkeyStepUpVerified === true,
  };
  return {
    ok: true,
    request: decided,
    state: append(
      afterExpiry,
      {
        approvalId: request.approvalId,
        kind: input.decision,
        channel: input.channel,
        actorRef: input.approverId,
        code: null,
        at: now,
      },
      decided,
    ),
  };
}

export interface AuthorizeExecutionInput {
  readonly approvalId: string;
  readonly actionId: string;
  readonly actionRef: string;
  /** Digest of the preconditions as they are right now, at execution time. */
  readonly currentPreconditionsDigest: string;
}

/**
 * Execution-time revalidation. On success the approval is consumed (single
 * use) and evidence is returned in the shape `evaluateJarvisRiskPolicy`
 * requires for the `execution` phase.
 */
export function authorizeExecution(
  state: ApprovalInboxState,
  input: AuthorizeExecutionInput,
  now: string,
): ApprovalResult<{ evidence: JarvisHumanApprovalEvidence; request: ApprovalRequest }> {
  const ctx = {
    approvalId: input?.approvalId ?? "",
    channel: null,
    actorRef: null,
    at: now,
  };
  if (
    !Number.isFinite(instant(now)) ||
    !nonEmpty(input?.approvalId) ||
    !nonEmpty(input?.actionId) ||
    !nonEmpty(input?.actionRef) ||
    !nonEmpty(input?.currentPreconditionsDigest)
  ) {
    return reject(state, "invalid_input", "Malformed execution request", ctx);
  }
  const found = state.requests.find((r) => r.approvalId === input.approvalId);
  if (found === undefined) {
    return reject(state, "not_found", "Approval request does not exist", ctx);
  }
  const { state: afterExpiry, request } = withExpiry(state, found, now);
  if (request.status === "expired") {
    return reject(afterExpiry, "expired", "Approval has expired and cannot execute", ctx);
  }
  if (request.status === "executed") {
    return reject(afterExpiry, "already_executed", "Approval was already used (replay)", ctx);
  }
  if (request.status !== "approved" || request.decidedBy === null || request.decidedRole === null) {
    return reject(afterExpiry, "not_approved", "Approval is not in the approved state", ctx);
  }
  if (request.actionId !== input.actionId || request.actionRef !== input.actionRef) {
    return reject(afterExpiry, "action_mismatch", "Approval is bound to a different action", ctx);
  }
  if (request.preconditionsDigest !== input.currentPreconditionsDigest) {
    return reject(
      afterExpiry,
      "preconditions_changed",
      "Preconditions changed since approval; a new approval is required",
      ctx,
    );
  }
  const executed: ApprovalRequest = { ...request, status: "executed", executedAt: now };
  const evidence: JarvisHumanApprovalEvidence = {
    approvalId: request.approvalId,
    actionId: request.actionId,
    actionRef: request.actionRef,
    agentDefinitionId: request.agentDefinitionId,
    platformRef: request.platformRef,
    decision: "approved",
    identityKind: "human",
    humanIdentityVerified: true,
    approverId: request.decidedBy,
    approverRole: request.decidedRole,
    channel: "console",
    passkeyStepUpVerified: request.passkeyStepUpVerified,
    recordedAt: request.decidedAt ?? request.requestedAt,
    expiresAt: request.expiresAt,
    revalidatedAt: now,
  };
  return {
    ok: true,
    request: executed,
    evidence,
    state: append(
      afterExpiry,
      {
        approvalId: request.approvalId,
        kind: "executed",
        channel: "console",
        actorRef: request.decidedBy,
        code: null,
        at: now,
      },
      executed,
    ),
  };
}
