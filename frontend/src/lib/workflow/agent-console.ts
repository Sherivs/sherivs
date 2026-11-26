/**
 * AIN-05: shared shapes for the agent console (ADR-129): which agents the organisation has and the level each has
 * earned, the memory proposals waiting for a person, and the screened outputs waiting for review. Pure and
 * dependency-light: the server operations, the server functions and the screen all use these types, and the safe
 * sentence for every refusal lives here so no screen invents its own.
 *
 * Nothing here decides anything. Who may see, who may decide and every rule about levels, memory and review are the
 * database's (`wf_console_*`, `wf_memory_decide`, `wf_memory_retire`, `wf_safety_review_check`, `wf_autonomy_demote`).
 * This module parses strictly (an unknown key is rejected, so a future column cannot leak by accident) and turns the
 * person's choice of a reason into a fixed sentence: free text never travels from the screen to a ledger.
 */
import { z } from "zod";

const uuid = z.string().uuid();
const isoTime = z.string().min(10).max(40);
const code = z.string().regex(/^[a-z][a-z0-9_.:-]{0,79}$/);
const count = z.coerce.number().int().min(0);

export const AUTONOMY_LEVELS = ["suggest", "draft", "act_with_approval", "act_and_report"] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];
export const DEMOTE_TARGETS = ["suggest", "draft", "act_with_approval"] as const;

export const AGENT_LEVEL_LABELS: Readonly<Record<AutonomyLevel, string>> = Object.freeze({
  suggest: "Suggests only",
  draft: "Drafts for people",
  act_with_approval: "Acts after approval",
  act_and_report: "Acts and reports",
});

/** Reasons a person can pick. The sentence is fixed here, 10 to 300 characters, as the ledgers require. */
export const CONSOLE_REASONS = [
  "quality_concern",
  "repeated_errors",
  "policy_change",
  "reviewed_ok",
  "reviewed_unsafe",
  "needs_more_evidence",
  "no_longer_needed",
  "other",
] as const;
export type ConsoleReason = (typeof CONSOLE_REASONS)[number];

export const CONSOLE_REASON_LABELS: Readonly<Record<ConsoleReason, string>> = Object.freeze({
  quality_concern: "The quality of its work concerns me",
  repeated_errors: "It keeps making the same mistakes",
  policy_change: "Our policy changed",
  reviewed_ok: "I checked it and it is fine",
  reviewed_unsafe: "I checked it and it is not safe to use",
  needs_more_evidence: "It needs more evidence before this",
  no_longer_needed: "It is no longer needed",
  other: "Another reason",
});

export const CONSOLE_REASON_SENTENCES: Readonly<Record<ConsoleReason, string>> = Object.freeze({
  quality_concern: "Chosen from the console: the quality of the work is a concern.",
  repeated_errors: "Chosen from the console: the same mistakes keep happening.",
  policy_change: "Chosen from the console: the organisation policy changed.",
  reviewed_ok: "Chosen from the console: a person checked it and found it fine.",
  reviewed_unsafe: "Chosen from the console: a person checked it and found it unsafe to use.",
  needs_more_evidence: "Chosen from the console: more evidence is needed first.",
  no_longer_needed: "Chosen from the console: it is no longer needed.",
  other: "Chosen from the console: another reason, recorded without detail.",
});

export const CONSOLE_ERROR_CODES = [
  "not_authorized",
  "invalid_filter",
  "invalid_request",
  "not_found",
  "not_a_pending_proposal",
  "expired",
  "check_not_found",
  "only_a_flagged_output_can_be_reviewed",
  "the_starter_of_the_run_cannot_review_its_output",
  "nothing_to_lower",
  "agent_unknown",
  "agent_not_usable_here",
  "already_retired",
  "legal_hold_freezes_memory",
  "workflows_disabled",
  "ai_route_closed",
  "actor_required",
  "unavailable",
] as const;
export type ConsoleErrorCode = (typeof CONSOLE_ERROR_CODES)[number];

const SAFE_MESSAGES: Readonly<Record<ConsoleErrorCode, string>> = Object.freeze({
  not_authorized: "You do not have permission to do this for your organisation.",
  invalid_filter: "That filter was not valid.",
  invalid_request: "That request was not valid.",
  not_found: "That item could not be found.",
  not_a_pending_proposal: "That proposal has already been decided.",
  expired: "That proposal has expired. It can no longer be accepted.",
  check_not_found: "That check could not be found.",
  only_a_flagged_output_can_be_reviewed: "Only an output that was flagged can be reviewed.",
  the_starter_of_the_run_cannot_review_its_output:
    "A different person must review this. The person who started the run cannot.",
  nothing_to_lower: "That agent is already at or below this level.",
  agent_unknown: "That agent could not be found.",
  agent_not_usable_here: "That agent is not available to your organisation.",
  already_retired: "That memory item is already retired.",
  legal_hold_freezes_memory: "Memory is frozen by a legal hold, so it cannot be changed.",
  workflows_disabled: "Workflows are switched off for this organisation.",
  ai_route_closed: "The AI route is not approved yet, so agents are not running.",
  actor_required: "Your session could not be confirmed. Sign in again and retry.",
  unavailable: "The agent console is not available right now. Please try again shortly.",
});

export function consoleErrorMessage(c: ConsoleErrorCode): string {
  return SAFE_MESSAGES[c];
}
const SAFE_MESSAGE_SET: ReadonlySet<string> = new Set(Object.values(SAFE_MESSAGES));
export function safeConsoleMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : "";
  return SAFE_MESSAGE_SET.has(message) ? message : SAFE_MESSAGES.unavailable;
}

export class AgentConsoleError extends Error {
  readonly code: ConsoleErrorCode;
  constructor(c: ConsoleErrorCode) {
    super(SAFE_MESSAGES[c]);
    this.name = "AgentConsoleError";
    this.code = c;
  }
}

/** Maps a database error (`ain02:`..`ain05:<code>` in the message) to a safe code. Unknown text never leaks. */
export function consoleErrorFromDatabase(
  error: { message?: unknown; code?: unknown } | null | undefined,
): AgentConsoleError {
  const message = typeof error?.message === "string" ? error.message : "";
  const match = /ain0[2-5]:([a-z_]+)/.exec(message);
  const c = match?.[1];
  if (c && (CONSOLE_ERROR_CODES as readonly string[]).includes(c)) {
    return new AgentConsoleError(c as ConsoleErrorCode);
  }
  return new AgentConsoleError("unavailable");
}

// ---------------------------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------------------------

export const MEMORY_FILTERS = ["proposed", "active", "all"] as const;
export const SAFETY_FILTERS = ["pending", "blocked", "decided", "all"] as const;

export const MemoryListInput = z
  .object({
    status: z.enum(MEMORY_FILTERS).default("proposed"),
    before: isoTime.optional(),
    beforeId: uuid.optional(),
  })
  .strict();
export const SafetyListInput = z
  .object({
    filter: z.enum(SAFETY_FILTERS).default("pending"),
    before: isoTime.optional(),
    beforeId: uuid.optional(),
  })
  .strict();
export const MemoryDecideInput = z
  .object({ itemId: uuid, decision: z.enum(["accept", "reject"]) })
  .strict();
export const MemoryRetireInput = z.object({ itemId: uuid }).strict();
export const SafetyReviewInput = z
  .object({
    checkId: uuid,
    decision: z.enum(["cleared", "rejected"]),
    reason: z.enum(CONSOLE_REASONS),
  })
  .strict();
export const AgentDemoteInput = z
  .object({
    agentRef: z.string().regex(/^[a-z][a-z0-9_-]{1,62}$/),
    toLevel: z.enum(DEMOTE_TARGETS),
    reason: z.enum(CONSOLE_REASONS),
  })
  .strict();

// ---------------------------------------------------------------------------------------------
// Results (strict)
// ---------------------------------------------------------------------------------------------

const barSchema = z
  .object({
    min_graded: count,
    min_pass_rate: z.coerce.number().min(0).max(1),
    max_age_days: count,
  })
  .strict();
const evidenceSchema = z
  .object({
    suite_id: z.string().max(80),
    graded: count,
    passed: count,
    critical_failures: count,
    ungraded: count,
    evaluated_at: isoTime,
    age_days: count,
    meets_bar: z.boolean(),
  })
  .strict();
const changeSchema = z
  .object({
    kind: z.enum(["promote", "demote", "auto_demote"]),
    from: z.enum(AUTONOMY_LEVELS).nullable(),
    to: z.enum(AUTONOMY_LEVELS),
    at: isoTime,
  })
  .strict();
const agentSchema = z
  .object({
    agent_ref: z.string().max(80),
    codename: z.string().max(80),
    family: z.enum(["org", "platform"]),
    tier: z.string().max(40),
    accountable: z.string().max(80),
    state: code,
    ceiling: z.enum(AUTONOMY_LEVELS),
    earned_level: z.enum(AUTONOMY_LEVELS),
    next_level: z.enum(AUTONOMY_LEVELS).nullable(),
    bar: barSchema.nullable(),
    evidence: evidenceSchema.nullable(),
    changes: z.array(changeSchema).max(5),
    steps_24h: count,
    budget: z
      .object({ daily_actions: count, daily_model_calls: count, daily_cost_cap_minor: count })
      .strict(),
  })
  .strict();
const agentsSchema = z
  .object({
    org_id: uuid,
    ai_route_approved: z.boolean(),
    can_manage: z.boolean(),
    can_approve: z.boolean(),
    is_founder: z.boolean(),
    levels: z
      .array(
        z
          .object({ level: z.enum(AUTONOMY_LEVELS), rank: count, label: z.string().max(80) })
          .strict(),
      )
      .max(8),
    agents: z.array(agentSchema).max(200),
  })
  .strict();
export type AgentConsole = z.infer<typeof agentsSchema>;
export type ConsoleAgent = z.infer<typeof agentSchema>;

const memoryItemSchema = z
  .object({
    item_id: uuid,
    key: z.string().max(120),
    scope_kind: z.string().max(40),
    scope_ref: z.string().max(120),
    data_class: z.string().max(40),
    status: z.enum(["proposed", "active", "retired"]),
    source_kind: z.enum(["person", "agent"]),
    source_agent: z.string().max(80).nullable(),
    ai_readable: z.boolean(),
    version: count,
    // A manager may read the short value of a proposal or item; it is rendered as plain text, capped.
    value: z.unknown().transform((v) => (JSON.stringify(v ?? null) ?? "null").slice(0, 1200)),
    expired: z.boolean(),
    created_at: isoTime,
    expires_at: isoTime.nullable(),
  })
  .strict();
const memoryListSchema = z
  .object({ items: z.array(memoryItemSchema).max(100), has_more: z.boolean() })
  .strict();
export type MemoryItem = z.infer<typeof memoryItemSchema>;
export type MemoryList = z.infer<typeof memoryListSchema>;

const safetyItemSchema = z
  .object({
    check_id: uuid,
    run_id: uuid,
    step_key: z.string().max(80),
    direction: z.enum(["input", "output"]),
    verdict: z.enum(["clean", "flagged", "blocked"]),
    codes: z.array(code).max(20),
    text_chars: count,
    created_at: isoTime,
    decision: z.enum(["cleared", "rejected"]).nullable(),
    decided_at: isoTime.nullable(),
    started_by_me: z.boolean(),
    can_review: z.boolean(),
  })
  .strict();
const safetyListSchema = z
  .object({
    items: z.array(safetyItemSchema).max(100),
    has_more: z.boolean(),
    can_approve: z.boolean(),
  })
  .strict();
export type SafetyItem = z.infer<typeof safetyItemSchema>;
export type SafetyList = z.infer<typeof safetyListSchema>;

function parseWith<T>(schema: z.ZodType<T>, data: unknown): T {
  const out = schema.safeParse(data);
  if (!out.success) throw new AgentConsoleError("unavailable");
  return out.data;
}
export const parseAgentConsole = (d: unknown) => parseWith(agentsSchema, d);
export const parseMemoryList = (d: unknown) => parseWith(memoryListSchema, d);
export const parseSafetyList = (d: unknown) => parseWith(safetyListSchema, d);
/** Write results are acknowledgements only: nothing in them is shown. */
export const parseAck = (d: unknown): { ok: true } => {
  if (d === null || typeof d !== "object") throw new AgentConsoleError("unavailable");
  return { ok: true };
};
