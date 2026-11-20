/**
 * WF-12: shared shapes for per-organisation workflow limits, wallet caps and retention (ADR-124).
 * Pure and dependency-light: the server operations, the server functions and the limits screen all
 * use these, and the safe sentence for every refusal lives here.
 *
 * Nothing here decides anything. Quotas and caps are enforced by database triggers; who may read or
 * change them, what the safe minimums are and what a purge may delete are decided by the SECURITY
 * DEFINER functions behind `wf_limits_*` and `wf_retention_*`. This module parses strictly (unknown
 * keys are rejected, so a future column cannot leak by accident) and maps errors to fixed sentences.
 */
import { z } from "zod";

const uuid = z.string().uuid();
const int = z.number().int().nonnegative();

export const LIMIT_ACTION_KINDS = [
  "email",
  "in_app",
  "task",
  "wait",
  "webhook",
  "sms",
  "whatsapp",
] as const;
export type LimitActionKind = (typeof LIMIT_ACTION_KINDS)[number];

export const LIMIT_NUMBER_KEYS = [
  "runs_per_day",
  "steps_per_run",
  "drafts_pending",
  "wallet_cap_kobo_per_day",
  "wallet_cap_kobo_per_run",
  "retention_outbox_days",
  "retention_draft_days",
  "retention_event_days",
  "retention_run_days",
  "retention_stepup_days",
  "retention_evidence_days",
] as const;
export type LimitNumberKey = (typeof LIMIT_NUMBER_KEYS)[number];

export const LIMIT_LABELS: Readonly<Record<LimitNumberKey, string>> = Object.freeze({
  runs_per_day: "Runs per day",
  steps_per_run: "Steps per run",
  drafts_pending: "Drafts waiting for review",
  wallet_cap_kobo_per_day: "Spend cap per day (kobo)",
  wallet_cap_kobo_per_run: "Spend cap per run (kobo)",
  retention_outbox_days: "Keep sent-action records (days)",
  retention_draft_days: "Keep decided drafts (days)",
  retention_event_days: "Keep run events and inbound events (days)",
  retention_run_days: "Keep finished runs (days)",
  retention_stepup_days: "Keep unused passkey check records (days)",
  retention_evidence_days: "Keep approval evidence (days)",
});

export const LIMIT_ERROR_CODES = [
  "not_authorized",
  "invalid_limit",
  "settings_missing",
  "dry_run_required",
  "invalid_request",
  "wallet_cap_above_ceiling",
  "unavailable",
] as const;
export type LimitErrorCode = (typeof LIMIT_ERROR_CODES)[number];

const SAFE_MESSAGES: Readonly<Record<LimitErrorCode, string>> = Object.freeze({
  not_authorized: "You need permission to manage workflows to do this.",
  invalid_limit:
    "That value is outside the allowed range, or breaks the order the windows must keep. Nothing was changed.",
  settings_missing: "Workflows have not been set up for this organisation yet.",
  dry_run_required:
    "Run a dry run first, then purge within 24 hours using that dry run. Nothing was deleted.",
  invalid_request: "That request was not valid.",
  wallet_cap_above_ceiling:
    "Spend caps stay at zero until a spend ceiling is decided. Nothing was changed.",
  unavailable: "Limits are not available right now. Please try again shortly.",
});

export function limitErrorMessage(c: LimitErrorCode): string {
  return SAFE_MESSAGES[c];
}

const SAFE_MESSAGE_SET: ReadonlySet<string> = new Set(Object.values(SAFE_MESSAGES));

/** The sentence to show for an error a server function threw: ours, or a generic fallback. */
export function safeLimitMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : "";
  return SAFE_MESSAGE_SET.has(message) ? message : SAFE_MESSAGES.unavailable;
}

export class LimitsError extends Error {
  readonly code: LimitErrorCode;
  constructor(c: LimitErrorCode) {
    super(SAFE_MESSAGES[c]);
    this.name = "LimitsError";
    this.code = c;
  }
}

/** Maps a database error (`wf12:<code>` in the message) to a safe code. Unknown text never leaks. */
export function limitErrorFromDatabase(
  error: { message?: unknown; code?: unknown } | null | undefined,
): LimitsError {
  const message = typeof error?.message === "string" ? error.message : "";
  const match = /wf12:([a-z_]+)/.exec(message);
  const c = match?.[1];
  if (c && (LIMIT_ERROR_CODES as readonly string[]).includes(c))
    return new LimitsError(c as LimitErrorCode);
  return new LimitsError("unavailable");
}

// ---------------------------------------------------------------------------------------------
// Request shapes
// ---------------------------------------------------------------------------------------------

const hourly = z.record(z.enum(LIMIT_ACTION_KINDS), z.number().int().min(0).max(5000));

/** A patch: only the named keys change. At least one key; unknown keys are rejected here and in SQL. */
export const LimitsUpdateInput = z
  .object({
    runs_per_day: z.number().int().min(1).max(10000),
    steps_per_run: z.number().int().min(1).max(1000),
    drafts_pending: z.number().int().min(1).max(2000),
    actions_per_hour: hourly,
    wallet_cap_kobo_per_day: z.number().int().min(0).max(1_000_000_000_000),
    wallet_cap_kobo_per_run: z.number().int().min(0).max(1_000_000_000_000),
    retention_outbox_days: z.number().int().min(30).max(3650),
    retention_draft_days: z.number().int().min(90).max(3650),
    retention_event_days: z.number().int().min(90).max(3650),
    retention_run_days: z.number().int().min(180).max(3650),
    retention_stepup_days: z.number().int().min(90).max(3650),
    retention_evidence_days: z.number().int().min(730).max(3650),
    retention_auto_purge: z.boolean(),
  })
  .partial()
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, { message: "empty" });
export type LimitsPatch = z.infer<typeof LimitsUpdateInput>;

export const RetentionRunInput = z
  .object({ dryRun: z.boolean(), dryRunId: uuid.nullable().default(null) })
  .strict()
  .refine((v) => v.dryRun || v.dryRunId !== null, { message: "dry_run_required" });

// ---------------------------------------------------------------------------------------------
// Result shapes (strict)
// ---------------------------------------------------------------------------------------------

const limitsShape = z
  .object({
    runs_per_day: int,
    steps_per_run: int,
    drafts_pending: int,
    actions_per_hour: z.record(z.string().regex(/^[a-z_]{2,20}$/), int),
    wallet_cap_kobo_per_day: int,
    wallet_cap_kobo_per_run: int,
    retention_outbox_days: int,
    retention_draft_days: int,
    retention_event_days: int,
    retention_run_days: int,
    retention_stepup_days: int,
    retention_evidence_days: int,
    retention_auto_purge: z.boolean(),
  })
  .strip();
export type OrgLimits = z.infer<typeof limitsShape>;

const bound = z.object({ min: int.optional(), max: int.optional() }).strip();

const retentionCounts = z.record(z.string().regex(/^[a-z_]{2,30}$/), int);

const lastRetention = z
  .object({
    id: uuid,
    mode: z.enum(["dry_run", "purge"]),
    trigger: z.enum(["manual", "scheduler"]),
    outcome: z.enum(["completed", "refused"]),
    refusal_code: z
      .string()
      .regex(/^[a-z_]{2,40}$/)
      .nullable(),
    counts: retentionCounts,
    truncated: z.boolean(),
    at: z.string().min(10).max(40),
  })
  .strip();

const denial = z
  .object({
    limit: z.string().regex(/^[a-z_]{2,40}$/),
    kind: z
      .string()
      .regex(/^[a-z_]{2,20}$/)
      .nullable(),
    denied: int,
  })
  .strip();

const usage = z
  .object({
    runs_24h: int,
    drafts_pending: int,
    actions_1h: z.record(z.string().regex(/^[a-z_]{2,20}$/), int),
    spend_24h_kobo: int,
    wallet_spendable_kobo: int,
  })
  .strip();

export const limitsViewShape = z
  .object({
    limits: limitsShape,
    bounds: z.record(z.string(), bound),
    usage,
    configured: z.boolean(),
    settings_exist: z.boolean(),
    denials_24h: z.array(denial).max(200),
    spend_kinds: z
      .array(
        z.object({ kind: z.string().regex(/^[a-z_]{2,20}$/), rate_decided: z.boolean() }).strip(),
      )
      .max(20),
    wallet_cap_ceiling_kobo: int,
    last_retention: lastRetention.nullable(),
    can_manage: z.boolean(),
  })
  .strip();
export type LimitsView = z.infer<typeof limitsViewShape>;

export const retentionResultShape = z
  .object({
    run_id: uuid,
    mode: z.enum(["dry_run", "purge"]),
    outcome: z.enum(["completed", "refused"]),
    refusal_code: z
      .string()
      .regex(/^[a-z_]{2,40}$/)
      .nullable(),
    windows: z.record(z.string(), z.number()).optional(),
    counts: retentionCounts,
    total: int.optional(),
    truncated: z.boolean().optional(),
  })
  .strip();
export type RetentionResult = z.infer<typeof retentionResultShape>;

function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const out = schema.safeParse(data);
  if (!out.success) throw new LimitsError("unavailable");
  return out.data;
}

export const parseLimitsView = (data: unknown): LimitsView => parse(limitsViewShape, data);
export const parseRetentionResult = (data: unknown): RetentionResult =>
  parse(retentionResultShape, data);
export const parseLimitsUpdateResult = (data: unknown): OrgLimits =>
  parse(
    z
      .object({ limits: limitsShape })
      .strip()
      .transform((v) => v.limits),
    data,
  );

export const RETENTION_COUNT_LABELS: Readonly<Record<string, string>> = Object.freeze({
  outbox: "Sent-action records",
  drafts: "Decided drafts",
  run_events: "Run events",
  unused_step_up: "Unused passkey check records",
  approval_decisions: "Approval decisions",
  approval_step_up: "Approval passkey evidence",
  approvals: "Approvals",
  step_runs: "Steps",
  runs: "Runs",
  inbound_events: "Inbound events",
});

export const REFUSAL_LABELS: Readonly<Record<string, string>> = Object.freeze({
  actions_per_hour: "hourly action limit",
  drafts_pending: "drafts waiting for review",
  runs_per_day: "daily run limit",
  spend_cap_day: "daily spend cap",
  spend_cap_run: "per-run spend cap",
  spend_wallet: "wallet balance",
  spend_rate_unknown: "no price decided for this action",
  kind_unknown: "unknown action type",
});
