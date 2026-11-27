/**
 * WF-07: shared shapes for the tenant approval inbox (ADR-122). Pure and dependency-light: the
 * server operations, the server functions and the inbox screen all use these types, and the
 * safe user messages for every refusal live here so no screen invents its own wording.
 *
 * Nothing here decides anything. Who may decide, how many people must approve, whether a passkey
 * is needed and whether the content changed are all decided by the database
 * (`wf_decide_approval`); this module only parses what the database returns and explains it.
 */
import { z } from "zod";
import { renderApprovalPreview, type ApprovalPreview } from "./approval-preview";

const uuid = z.string().uuid();
const isoTime = z.string().min(10).max(40);

export const APPROVAL_DECISIONS = ["approve", "reject"] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

export const APPROVAL_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "expired",
  "cancelled",
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const APPROVAL_INBOX_FILTERS = ["pending", "decided"] as const;
export type ApprovalInboxFilter = (typeof APPROVAL_INBOX_FILTERS)[number];

/** Reasons the database may give for refusing a decision (`wf07:<code>`). */
export const APPROVAL_BLOCKER_CODES = [
  "not_found",
  "not_pending",
  "expired",
  "not_authorized",
  "requester",
  "author",
  "already_voted",
  "actor_unbound",
] as const;
export type ApprovalBlockerCode = (typeof APPROVAL_BLOCKER_CODES)[number];

/** Every refusal code the operations can raise. */
export const APPROVAL_ERROR_CODES = [
  ...APPROVAL_BLOCKER_CODES,
  "stale_content",
  "step_up_invalid",
  "step_up_not_required",
  "step_up_failed",
  "passkey_unavailable",
  "rate_limited",
  "draft_not_approvable",
  "template_unavailable",
  "invalid_request",
  "unavailable",
] as const;
export type ApprovalErrorCode = (typeof APPROVAL_ERROR_CODES)[number];

const SAFE_MESSAGES: Readonly<Record<ApprovalErrorCode, string>> = Object.freeze({
  not_found: "This approval could not be found.",
  not_pending: "This approval has already been decided.",
  expired: "This approval has expired and can no longer be decided.",
  not_authorized: "You do not have permission to decide approvals for this organisation.",
  requester: "You started this workflow, so someone else needs to decide this.",
  author: "You wrote or changed this workflow, so someone else needs to decide this.",
  already_voted: "You have already recorded your decision on this approval.",
  actor_unbound: "Your session could not be confirmed. Sign in again and retry.",
  stale_content: "This item changed after you opened it. Reopen it to review the new version.",
  step_up_invalid:
    "Your passkey confirmation was missing or has expired. Confirm again to approve.",
  step_up_not_required: "This approval does not need a passkey confirmation.",
  step_up_failed: "Passkey confirmation did not succeed. You can try again.",
  passkey_unavailable: "Add a passkey to your account before approving high-risk items.",
  rate_limited: "Too many attempts. Please wait a moment and try again.",
  draft_not_approvable: "This drafted action cannot be approved.",
  template_unavailable: "The approved message template is no longer available.",
  invalid_request: "That request was not valid.",
  unavailable: "Approvals are not available right now. Please try again shortly.",
});

export function approvalErrorMessage(code: ApprovalErrorCode): string {
  return SAFE_MESSAGES[code];
}

const SAFE_MESSAGE_SET: ReadonlySet<string> = new Set(Object.values(SAFE_MESSAGES));

/** The sentence to show for an error a server function threw: ours, or a generic fallback. */
export function safeApprovalMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : "";
  return SAFE_MESSAGE_SET.has(message) ? message : SAFE_MESSAGES.unavailable;
}

export class ApprovalInboxError extends Error {
  readonly code: ApprovalErrorCode;
  constructor(code: ApprovalErrorCode) {
    super(SAFE_MESSAGES[code]);
    this.name = "ApprovalInboxError";
    this.code = code;
  }
}

/** Maps a database error (`wf07:<code>` in the message) to a safe code. Unknown text never leaks. */
export function approvalErrorFromDatabase(
  error: { message?: unknown; code?: unknown } | null | undefined,
): ApprovalInboxError {
  const message = typeof error?.message === "string" ? error.message : "";
  const match = /wf07:([a-z_]+)/.exec(message);
  const code = match?.[1];
  if (code && (APPROVAL_ERROR_CODES as readonly string[]).includes(code)) {
    return new ApprovalInboxError(code as ApprovalErrorCode);
  }
  if (code === "invalid_decision" || code === "note_too_long" || code === "invalid_filter") {
    return new ApprovalInboxError("invalid_request");
  }
  return new ApprovalInboxError("unavailable");
}

// ---------------------------------------------------------------------------------------------
// Row shapes returned by wf_inbox_list and wf_approval_view
// ---------------------------------------------------------------------------------------------

const riskSchema = z.enum(["normal", "high"]);

const inboxRowSchema = z.object({
  approval_id: uuid,
  kind: z.enum(["draft", "approval"]),
  action_kind: z.string().max(40).nullable().optional(),
  category: z.string().max(64),
  risk: riskSchema,
  status: z.enum(APPROVAL_STATUSES),
  required_permission: z.string().max(80).optional(),
  requested_at: isoTime,
  expires_at: isoTime,
  workflow: z.string().max(200).nullable().optional(),
  approvals: z.coerce.number().int().min(0),
  required: z.coerce.number().int().min(1),
  voted_by_me: z.boolean(),
});

export interface ApprovalInboxItem {
  readonly approvalId: string;
  readonly kind: "draft" | "approval";
  readonly actionKind: string | null;
  readonly category: string;
  readonly risk: "normal" | "high";
  readonly status: ApprovalStatus;
  readonly requestedAt: string;
  readonly expiresAt: string;
  readonly workflow: string;
  readonly approvals: number;
  readonly required: number;
  readonly votedByMe: boolean;
}

export function parseInboxList(data: unknown): ApprovalInboxItem[] {
  const parsed = z.array(inboxRowSchema).safeParse(data);
  if (!parsed.success) throw new ApprovalInboxError("unavailable");
  return parsed.data.map((r) => ({
    approvalId: r.approval_id,
    kind: r.kind,
    actionKind: r.action_kind ?? null,
    category: r.category,
    risk: r.risk,
    status: r.status,
    requestedAt: r.requested_at,
    expiresAt: r.expires_at,
    workflow: r.workflow ?? "",
    approvals: r.approvals,
    required: r.required,
    votedByMe: r.voted_by_me,
  }));
}

const draftViewSchema = z.object({
  id: uuid,
  kind: z.string().max(40),
  category: z.string().max(64),
  status: z.string().max(32),
  template_ref: z.string().max(160).nullable().optional(),
  params: z.record(z.string(), z.unknown()).nullable().optional(),
  recipient_count: z.coerce.number().int().min(0),
  recipient_ids: z.array(uuid).max(5).default([]),
  audience: z.string().max(40).nullable().optional(),
  data_class: z.string().max(40),
  template_available: z.boolean().nullable().optional(),
  template_body: z.string().max(20_000).nullable().optional(),
});

const detailRowSchema = z.object({
  approval_id: uuid,
  org_id: uuid,
  status: z.enum(APPROVAL_STATUSES),
  risk: riskSchema,
  required_permission: z.string().max(80),
  category: z.string().max(64),
  requested_at: isoTime,
  expires_at: isoTime,
  requested_by_kind: z.string().max(20),
  summary: z.string().max(500),
  digest: z.string().regex(/^[0-9a-f]{64}$/),
  step_up_required: z.boolean(),
  required: z.coerce.number().int().min(1),
  votes: z
    .array(
      z.object({
        approver_id: uuid,
        decision: z.enum(APPROVAL_DECISIONS),
        decided_at: isoTime,
        current: z.boolean(),
      }),
    )
    .max(50),
  can_decide: z.boolean(),
  blockers: z.array(z.string().max(40)).max(10),
  draft: draftViewSchema.nullable(),
});

export interface ApprovalVote {
  /** Short, non-reversible reference: the first eight characters of the approver id. */
  readonly approverRef: string;
  readonly mine: boolean;
  readonly decision: ApprovalDecision;
  readonly decidedAt: string;
  /** True when the vote was cast on the content as it stands now. */
  readonly current: boolean;
}

export interface ApprovalDraftView {
  readonly id: string;
  readonly kind: string;
  readonly category: string;
  readonly status: string;
  readonly templateRef: string | null;
  readonly recipientCount: number;
  readonly audience: string | null;
  readonly dataClass: string;
  readonly templateAvailable: boolean | null;
  readonly paramKeys: readonly string[];
}

export interface ApprovalDetail {
  readonly approvalId: string;
  readonly status: ApprovalStatus;
  readonly risk: "normal" | "high";
  readonly category: string;
  readonly requestedAt: string;
  readonly expiresAt: string;
  readonly requestedByKind: string;
  readonly summary: string;
  /** SHA-256 over what the approver is asked to approve; the passkey confirmation binds to it. */
  readonly digest: string;
  readonly stepUpRequired: boolean;
  readonly required: number;
  readonly votes: readonly ApprovalVote[];
  readonly canDecide: boolean;
  readonly blockers: readonly ApprovalBlockerCode[];
  readonly draft: ApprovalDraftView | null;
  readonly preview: ApprovalPreview | null;
}

/** Parses the detail row and drops anything the screen must not hold (raw ids, template source). */
export function parseApprovalDetail(data: unknown, actorId: string): ApprovalDetail {
  const parsed = detailRowSchema.safeParse(data);
  if (!parsed.success) throw new ApprovalInboxError("unavailable");
  const r = parsed.data;
  const draft = r.draft;
  const blockers = r.blockers.filter((b): b is ApprovalBlockerCode =>
    (APPROVAL_BLOCKER_CODES as readonly string[]).includes(b),
  );
  return {
    approvalId: r.approval_id,
    status: r.status,
    risk: r.risk,
    category: r.category,
    requestedAt: r.requested_at,
    expiresAt: r.expires_at,
    requestedByKind: r.requested_by_kind,
    summary: r.summary,
    digest: r.digest,
    stepUpRequired: r.step_up_required,
    required: r.required,
    votes: r.votes.map((v) => ({
      approverRef: v.approver_id.slice(0, 8),
      mine: v.approver_id === actorId,
      decision: v.decision,
      decidedAt: v.decided_at,
      current: v.current,
    })),
    canDecide: r.can_decide,
    blockers,
    draft: draft
      ? {
          id: draft.id,
          kind: draft.kind,
          category: draft.category,
          status: draft.status,
          templateRef: draft.template_ref ?? null,
          recipientCount: draft.recipient_count,
          audience: draft.audience ?? null,
          dataClass: draft.data_class,
          templateAvailable: draft.template_available ?? null,
          paramKeys: Object.keys(draft.params ?? {}).sort(),
        }
      : null,
    preview: draft
      ? renderApprovalPreview({ templateBody: draft.template_body, params: draft.params })
      : null,
  };
}

// ---------------------------------------------------------------------------------------------
// What the screen shows
// ---------------------------------------------------------------------------------------------

export type ApprovalDisplayState =
  | { readonly kind: "decided"; readonly status: Exclude<ApprovalStatus, "pending"> }
  | { readonly kind: "waiting_for_others"; readonly have: number; readonly need: number }
  | { readonly kind: "blocked"; readonly reason: ApprovalBlockerCode }
  | { readonly kind: "needs_step_up" }
  | { readonly kind: "ready" };

/** Counts the approving votes that were cast on the content as it stands now. */
export function currentApprovals(detail: Pick<ApprovalDetail, "votes">): number {
  return detail.votes.filter((v) => v.decision === "approve" && v.current).length;
}

/**
 * The one state the detail view is in. A person who has voted while more approvers are needed sees
 * "waiting for others", not an empty screen; a person the rules exclude sees why.
 */
export function approvalDisplayState(detail: ApprovalDetail): ApprovalDisplayState {
  if (detail.status !== "pending") return { kind: "decided", status: detail.status };
  const have = currentApprovals(detail);
  if (!detail.canDecide) {
    if (detail.blockers.includes("already_voted") || detail.votes.some((v) => v.mine)) {
      return { kind: "waiting_for_others", have, need: detail.required };
    }
    const reason = detail.blockers[0] ?? "not_authorized";
    return { kind: "blocked", reason };
  }
  return detail.stepUpRequired ? { kind: "needs_step_up" } : { kind: "ready" };
}

/** True when this person has approved and the count is still short. */
export function isWaitingForSecondApprover(detail: ApprovalDetail): boolean {
  return (
    detail.status === "pending" &&
    detail.required > 1 &&
    currentApprovals(detail) > 0 &&
    currentApprovals(detail) < detail.required
  );
}

// ---------------------------------------------------------------------------------------------
// Request shapes shared by the server functions and the screen
// ---------------------------------------------------------------------------------------------

export const ApprovalIdInput = z.object({ approvalId: uuid });
export const ApprovalListInput = z.object({ filter: z.enum(APPROVAL_INBOX_FILTERS) });

export const AuthenticationResponseInput = z.object({
  id: z.string().min(16).max(1024),
  rawId: z.string().min(1).max(1024),
  type: z.literal("public-key"),
  response: z.object({
    clientDataJSON: z.string().min(16).max(16_384),
    authenticatorData: z.string().min(16).max(16_384),
    signature: z.string().min(16).max(16_384),
    userHandle: z.string().max(256).optional(),
  }),
  clientExtensionResults: z.record(z.string(), z.unknown()).optional(),
  authenticatorAttachment: z.string().max(32).optional(),
});

export const ApprovalDecideInput = z
  .object({
    approvalId: uuid,
    decision: z.enum(APPROVAL_DECISIONS),
    digest: z.string().regex(/^[0-9a-f]{64}$/),
    note: z.string().trim().max(1000).optional(),
    nonce: z
      .string()
      .regex(/^[A-Za-z0-9_-]{22}$/)
      .optional(),
    response: AuthenticationResponseInput.optional(),
  })
  .refine((v) => v.decision === "reject" || !v.response || !!v.nonce, {
    message: "A passkey confirmation needs its request code.",
  });

export type ApprovalDecideRequest = z.infer<typeof ApprovalDecideInput>;
