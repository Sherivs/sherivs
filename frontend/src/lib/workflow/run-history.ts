/**
 * WF-08: shared shapes for tenant run history, retry and cancel (ADR-123). Pure and
 * dependency-light: the server operations, the server functions and the run history screen all
 * use these types, and the safe sentence for every refusal lives here so no screen invents its own.
 *
 * Nothing here decides anything. Who may cancel or retry, which steps are retryable and what a
 * retry may never do are decided by the database (`wf_run_cancel`, `wf_run_retry`). The database
 * also redacts by allow-list before anything is returned; this module parses strictly (unknown
 * keys are rejected, so a future column cannot leak by accident) and scrubs once more on the way
 * to the screen, so an address or phone-like string never renders even if one got through.
 */
import { z } from "zod";

const uuid = z.string().uuid();
const isoTime = z.string().min(10).max(40);
const code = z.string().regex(/^[a-z][a-z0-9_.]{1,63}$/);

export const RUN_HISTORY_FILTERS = ["all", "active", "failed", "succeeded", "cancelled"] as const;
export type RunHistoryFilter = (typeof RUN_HISTORY_FILTERS)[number];

export const RUN_CONTROL_REASONS = [
  "operator_request",
  "duplicate_run",
  "wrong_audience",
  "policy_change",
  "fixed_upstream",
  "other",
] as const;
export type RunControlReason = (typeof RUN_CONTROL_REASONS)[number];

export const RUN_REASON_LABELS: Readonly<Record<RunControlReason, string>> = Object.freeze({
  operator_request: "I decided to stop or retry this",
  duplicate_run: "This is a duplicate run",
  wrong_audience: "It was aimed at the wrong audience",
  policy_change: "Our policy changed",
  fixed_upstream: "The underlying problem was fixed",
  other: "Another reason",
});

/** Why a dead step cannot be retried. The database computes these; the screen only explains them. */
export const RETRY_BLOCKER_CODES = [
  "approval_step",
  "definition_inactive",
  "draft_exists",
  "effect_recorded",
  "not_authorized",
  "not_stopping_step",
  "retry_limit",
  "run_not_retryable",
  "step_not_dead",
  "version_not_current",
  "workflows_disabled",
] as const;
export type RetryBlockerCode = (typeof RETRY_BLOCKER_CODES)[number];

export const RETRY_BLOCKER_MESSAGES: Readonly<Record<RetryBlockerCode, string>> = Object.freeze({
  approval_step: "An approval step is decided by a person. It cannot be retried.",
  definition_inactive: "This workflow is paused or retired.",
  draft_exists: "This step already drafted an action. Review that draft instead.",
  effect_recorded: "This step already took its action. Retrying could repeat it.",
  not_authorized: "You need permission to run workflows to retry.",
  not_stopping_step: "The run did not stop at this step.",
  retry_limit: "This chain of retries has reached its limit of three.",
  run_not_retryable: "This run was cancelled, so it cannot be continued.",
  step_not_dead: "Only a step that failed for good can be retried.",
  version_not_current: "The workflow was republished after this run. Start a fresh run instead.",
  workflows_disabled: "Workflows are switched off for this organisation.",
});

export const RUN_ERROR_CODES = [
  ...RETRY_BLOCKER_CODES,
  "autonomy_escalation",
  "invalid_filter",
  "invalid_reason",
  "not_found",
  "not_cancellable",
  "actor_required",
  "invalid_request",
  "unavailable",
] as const;
export type RunErrorCode = (typeof RUN_ERROR_CODES)[number];

const SAFE_MESSAGES: Readonly<Record<RunErrorCode, string>> = Object.freeze({
  ...RETRY_BLOCKER_MESSAGES,
  autonomy_escalation:
    "Retrying would give this step more autonomy than it had. It was not retried.",
  invalid_filter: "That filter was not valid.",
  invalid_reason: "Choose a reason from the list.",
  not_found: "This run could not be found.",
  not_cancellable: "This run has already finished, so it cannot be cancelled.",
  actor_required: "Your session could not be confirmed. Sign in again and retry.",
  invalid_request: "That request was not valid.",
  unavailable: "Run history is not available right now. Please try again shortly.",
});

export function runErrorMessage(c: RunErrorCode): string {
  return SAFE_MESSAGES[c];
}

const SAFE_MESSAGE_SET: ReadonlySet<string> = new Set(Object.values(SAFE_MESSAGES));

/** The sentence to show for an error a server function threw: ours, or a generic fallback. */
export function safeRunMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : "";
  return SAFE_MESSAGE_SET.has(message) ? message : SAFE_MESSAGES.unavailable;
}

export class RunHistoryError extends Error {
  readonly code: RunErrorCode;
  constructor(c: RunErrorCode) {
    super(SAFE_MESSAGES[c]);
    this.name = "RunHistoryError";
    this.code = c;
  }
}

/** Maps a database error (`wf07:`/`wf08:<code>` in the message) to a safe code. Unknown text never leaks. */
export function runErrorFromDatabase(
  error: { message?: unknown; code?: unknown } | null | undefined,
): RunHistoryError {
  const message = typeof error?.message === "string" ? error.message : "";
  const match = /wf0[78]:([a-z_]+)/.exec(message);
  const c = match?.[1];
  if (c && (RUN_ERROR_CODES as readonly string[]).includes(c)) {
    return new RunHistoryError(c as RunErrorCode);
  }
  return new RunHistoryError("unavailable");
}

// ---------------------------------------------------------------------------------------------
// Request shapes
// ---------------------------------------------------------------------------------------------

export const RunListInput = z
  .object({
    filter: z.enum(RUN_HISTORY_FILTERS).default("all"),
    workflow: z
      .string()
      .regex(/^[a-z][a-z0-9_-]{1,62}$/)
      .optional(),
    before: isoTime.optional(),
  })
  .strict();
export type RunListRequest = z.infer<typeof RunListInput>;

export const RunIdInput = z.object({ runId: uuid }).strict();
export const RunCancelInput = z
  .object({ runId: uuid, reason: z.enum(RUN_CONTROL_REASONS) })
  .strict();
export const RunRetryInput = z
  .object({ stepId: uuid, reason: z.enum(RUN_CONTROL_REASONS) })
  .strict();

// ---------------------------------------------------------------------------------------------
// Scrubbing: a last line of defence on the way to the screen
// ---------------------------------------------------------------------------------------------

const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE_LIKE = /(?:\+?\d[\d\s().-]{7,}\d)/;

/** True when text looks like an address or phone number. Nothing like that may reach the screen. */
export function looksLikeContact(text: string): boolean {
  return EMAIL_LIKE.test(text) || PHONE_LIKE.test(text);
}

/** A short code-like label, or an empty string if it is anything else. */
export function safeLabel(text: unknown, max = 80): string {
  if (typeof text !== "string") return "";
  const t = text.slice(0, max);
  return looksLikeContact(t) ? "" : t;
}

// ---------------------------------------------------------------------------------------------
// Row shapes returned by wf_run_history_list and wf_run_history_detail (strict)
// ---------------------------------------------------------------------------------------------

export const RUN_STATUSES = [
  "queued",
  "running",
  "waiting",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

const count = z.coerce.number().int().min(0);

const listItemSchema = z
  .object({
    run_id: uuid,
    workflow_key: z.string().max(80),
    status: z.enum(RUN_STATUSES),
    error_code: code.nullable(),
    trigger_event_type: z.string().max(120).nullable(),
    created_at: isoTime,
    started_at: isoTime.nullable(),
    finished_at: isoTime.nullable(),
    step_count: count,
    steps: z.record(z.string().max(20), count),
    open_approvals: count,
    drafts: count,
    executed: count,
    retry_of_run_id: uuid.nullable(),
    retry_generation: count,
    retries: count,
    has_dead_step: z.boolean(),
    can_cancel: z.boolean(),
  })
  .strict();
export type RunListItem = z.infer<typeof listItemSchema>;

const listSchema = z
  .object({ items: z.array(listItemSchema).max(100), has_more: z.boolean() })
  .strict();
export type RunList = z.infer<typeof listSchema>;

const stepSchema = z
  .object({
    step_id: uuid,
    step_key: z.string().max(80),
    iteration: count,
    kind: z.string().max(40),
    status: z.string().max(20),
    attempt: count,
    max_attempts: count,
    action_class: z.string().max(40).nullable(),
    autonomy_level: z.string().max(40).nullable(),
    error_code: code.nullable(),
    started_at: isoTime.nullable(),
    finished_at: isoTime.nullable(),
    created_at: isoTime,
    retry: z
      .object({
        blockers: z.array(z.enum(RETRY_BLOCKER_CODES)).max(12),
        retry_run_id: uuid.nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type RunStep = z.infer<typeof stepSchema>;

const eventDetailSchema = z
  .object({
    error_code: code.optional(),
    reason_code: code.optional(),
    risk: z.enum(["normal", "high"]).optional(),
    decision: z.enum(["approve", "reject"]).optional(),
    approval_id: uuid.optional(),
    draft_id: uuid.optional(),
    source_run_id: uuid.optional(),
    source_step_id: uuid.optional(),
    retry_run_id: uuid.optional(),
    from_status: code.optional(),
    generation: z.number().int().min(0).max(9).optional(),
    replayed: z.boolean().optional(),
  })
  .strict();

const eventSchema = z
  .object({
    event_id: z.coerce.number().int(),
    kind: z.string().max(60),
    actor_kind: z.string().max(20),
    at: isoTime,
    step_id: uuid.nullable(),
    detail: eventDetailSchema,
  })
  .strict();
export type RunEvent = z.infer<typeof eventSchema>;

const approvalSchema = z
  .object({
    approval_id: uuid,
    step_id: uuid.nullable(),
    status: z.string().max(20),
    risk: z.enum(["normal", "high"]),
    required_permission: z.string().max(80),
    requested_by_kind: z.string().max(20),
    requested_at: isoTime,
    expires_at: isoTime,
    decided_at: isoTime.nullable(),
    approvals: count,
    required: count,
  })
  .strict();

const draftSchema = z
  .object({
    draft_id: uuid,
    step_id: uuid.nullable(),
    kind: z.string().max(40),
    category: z.string().max(64),
    status: z.string().max(20),
    data_class: z.string().max(40).nullable(),
    template_ref: z.string().max(120).nullable(),
    recipient_count: count,
    has_audience: z.boolean(),
    has_webhook_target: z.boolean(),
    param_count: count,
    approval_id: uuid.nullable(),
    created_at: isoTime,
  })
  .strict();

const outboxSchema = z
  .object({
    outbox_id: uuid,
    step_id: uuid.nullable(),
    draft_id: uuid.nullable(),
    kind: z.string().max(40),
    category: z.string().max(64),
    data_class: z.string().max(40).nullable(),
    recipient_count: count,
    created_at: isoTime,
  })
  .strict();

const detailSchema = z
  .object({
    run: z
      .object({
        run_id: uuid,
        workflow_key: z.string().max(80),
        version: count,
        status: z.enum(RUN_STATUSES),
        error_code: code.nullable(),
        trigger_event_type: z.string().max(120).nullable(),
        created_at: isoTime,
        started_at: isoTime.nullable(),
        finished_at: isoTime.nullable(),
        deadline_at: isoTime.nullable(),
        step_count: count,
        max_steps: count,
        started_by_me: z.boolean(),
        started_by_kind: z.enum(["user", "agent", "system"]),
        retry_of_run_id: uuid.nullable(),
        retry_generation: count,
      })
      .strict(),
    permissions: z
      .object({
        can_cancel: z.boolean(),
        can_retry: z.boolean(),
        workflows_enabled: z.boolean(),
      })
      .strict(),
    steps: z.array(stepSchema).max(500),
    events: z.array(eventSchema).max(200),
    approvals: z.array(approvalSchema).max(200),
    drafts: z.array(draftSchema).max(200),
    outbox: z.array(outboxSchema).max(200),
  })
  .strict();
export type RunDetail = z.infer<typeof detailSchema>;

export function parseRunList(data: unknown): RunList {
  const parsed = listSchema.safeParse(data);
  if (!parsed.success) throw new RunHistoryError("unavailable");
  return parsed.data;
}

export function parseRunDetail(data: unknown): RunDetail {
  const parsed = detailSchema.safeParse(data);
  if (!parsed.success) throw new RunHistoryError("unavailable");
  return scrubDetail(parsed.data);
}

/** Drops any label that looks like an address or phone number. The database already redacts; this is belt and braces. */
export function scrubDetail(detail: RunDetail): RunDetail {
  return {
    ...detail,
    run: {
      ...detail.run,
      workflow_key: safeLabel(detail.run.workflow_key),
      trigger_event_type: detail.run.trigger_event_type
        ? safeLabel(detail.run.trigger_event_type) || null
        : null,
    },
    drafts: detail.drafts.map((d) => ({
      ...d,
      template_ref: d.template_ref ? safeLabel(d.template_ref, 120) || null : null,
    })),
  };
}

// ---------------------------------------------------------------------------------------------
// Control results
// ---------------------------------------------------------------------------------------------

const cancelResultSchema = z
  .object({
    run_id: uuid,
    status: z.literal("cancelled"),
    replayed: z.boolean(),
    steps_cancelled: count,
  })
  .strict();
const retryResultSchema = z
  .object({ run_id: uuid, replayed: z.boolean(), generation: count.optional() })
  .strict();
export type RunCancelResult = z.infer<typeof cancelResultSchema>;
export type RunRetryResult = z.infer<typeof retryResultSchema>;

export function parseCancelResult(data: unknown): RunCancelResult {
  const parsed = cancelResultSchema.safeParse(data);
  if (!parsed.success) throw new RunHistoryError("unavailable");
  return parsed.data;
}

export function parseRetryResult(data: unknown): RunRetryResult {
  const parsed = retryResultSchema.safeParse(data);
  if (!parsed.success) throw new RunHistoryError("unavailable");
  return parsed.data;
}
