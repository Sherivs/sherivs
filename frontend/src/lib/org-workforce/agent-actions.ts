/**
 * Organization agent actions and events (ENGINE-21, ADR-099).
 *
 * Plans the calls the roster makes to the ENGINE-20 database proposal, reads its answers, and
 * turns its error codes into sentences a school administrator can act on. The database
 * functions are the authority: they check the caller, the plan and the organization. This file
 * only asks the right question and refuses to ask a wrong one.
 *
 * Pure: no I/O, no clock, no environment.
 */

export type AgentAction = "enable" | "disable" | "pause" | "resume";

/**
 * What a school may do. The platform's own pause and resume exist in the database but are not
 * offered here: only the platform operator may use them.
 */
export const SCHOOL_AGENT_ACTIONS: readonly AgentAction[] = [
  "enable",
  "disable",
  "pause",
  "resume",
];

const NEEDS_REASON: ReadonlySet<AgentAction> = new Set(["pause", "resume"]);
export const REASON_MIN = 10;
export const REASON_MAX = 300;

export type ActionPlan =
  | {
      readonly ok: true;
      readonly call: {
        readonly rpc: "change_org_agent";
        readonly args: {
          readonly p_org: string;
          readonly p_agent: string;
          readonly p_action: AgentAction;
          readonly p_reason: string | null;
        };
      };
    }
  | { readonly ok: false; readonly reason: string };

export function planAgentAction(input: {
  readonly orgId: string;
  readonly agentCode: string;
  readonly action: string;
  readonly reason?: string;
  /** Agent codes the organization's plan allows, from the activation plan. */
  readonly knownCodes: readonly string[];
}): ActionPlan {
  const orgId = input.orgId.trim();
  if (orgId === "") return { ok: false, reason: "Your organization could not be identified." };
  if (!input.knownCodes.includes(input.agentCode)) {
    return { ok: false, reason: "That agent does not exist." };
  }
  if (!(SCHOOL_AGENT_ACTIONS as readonly string[]).includes(input.action)) {
    return { ok: false, reason: "That action is not available to an organization." };
  }
  const action = input.action as AgentAction;
  const reason = (input.reason ?? "").trim();
  if (NEEDS_REASON.has(action)) {
    if (reason.length < REASON_MIN) {
      return { ok: false, reason: `Give a reason of at least ${REASON_MIN} characters.` };
    }
    if (reason.length > REASON_MAX) {
      return { ok: false, reason: `Keep the reason to ${REASON_MAX} characters or fewer.` };
    }
  }
  return {
    ok: true,
    call: {
      rpc: "change_org_agent",
      args: {
        p_org: orgId,
        p_agent: input.agentCode,
        p_action: action,
        // The database ignores a reason on enable and disable; send none rather than stale text.
        p_reason: NEEDS_REASON.has(action) ? reason : null,
      },
    },
  };
}

/** One row of the add-on event log, as the database returns it. */
export interface AddOnEventRow {
  readonly agentCode: string;
  readonly action: string;
  readonly seq: number;
}

export interface AgentSwitchState {
  readonly enabledCodes: readonly string[];
  readonly pausedCodes: readonly string[];
  /** Agents the platform paused. The organization cannot resume these. */
  readonly platformPausedCodes: readonly string[];
}

/**
 * Folds the append-only log into the current state, the same way `org_agent_state` does in
 * the database: the latest enable or disable decides "on", and the latest pause or resume
 * decides "paused" and whether the platform did it. A test keeps the two in step.
 */
export function foldAddOnEvents(rows: readonly AddOnEventRow[]): AgentSwitchState {
  const ordered = [...rows].sort((a, b) => a.seq - b.seq);
  const on = new Map<string, boolean>();
  const pause = new Map<string, "pause" | "platform_pause" | "clear">();
  for (const r of ordered) {
    if (r.action === "enable") on.set(r.agentCode, true);
    else if (r.action === "disable") on.set(r.agentCode, false);
    else if (r.action === "pause" || r.action === "platform_pause")
      pause.set(r.agentCode, r.action);
    else if (r.action === "resume" || r.action === "platform_resume")
      pause.set(r.agentCode, "clear");
  }
  const enabledCodes = [...on]
    .filter(([, v]) => v)
    .map(([k]) => k)
    .sort();
  const paused = [...pause].filter(([, v]) => v !== "clear");
  return {
    enabledCodes,
    pausedCodes: paused.map(([k]) => k).sort(),
    platformPausedCodes: paused
      .filter(([, v]) => v === "platform_pause")
      .map(([k]) => k)
      .sort(),
  };
}

export function parseAddOnEvents(data: unknown): readonly AddOnEventRow[] {
  if (!Array.isArray(data)) return [];
  const out: AddOnEventRow[] = [];
  for (const r of data) {
    if (typeof r !== "object" || r === null) continue;
    const o = r as Record<string, unknown>;
    const seq = typeof o.seq === "number" ? o.seq : Number(o.seq);
    if (typeof o.agent_code === "string" && typeof o.action === "string" && Number.isFinite(seq)) {
      out.push({ agentCode: o.agent_code, action: o.action, seq });
    }
  }
  return out;
}

/** A raised event, as the database returns it. Safeguarding events never carry text. */
export interface AgentEventRow {
  readonly id: string;
  readonly agentCode: string;
  readonly kind: string;
  readonly severity: string;
  readonly summary: string | null;
  readonly amountMinor: number | null;
  readonly createdAt: string;
  readonly acknowledged: boolean;
}

const KINDS = new Set(["money", "safeguarding", "compliance", "operations", "academic", "info"]);
const SEVERITIES = new Set(["info", "attention", "urgent", "critical"]);
const SEVERITY_RANK: Readonly<Record<string, number>> = {
  critical: 3,
  urgent: 2,
  attention: 1,
  info: 0,
};

export function parseAgentEvents(data: unknown): readonly AgentEventRow[] {
  if (!Array.isArray(data)) return [];
  const out: AgentEventRow[] = [];
  for (const r of data) {
    if (typeof r !== "object" || r === null) continue;
    const o = r as Record<string, unknown>;
    if (
      typeof o.id !== "string" ||
      typeof o.agent_code !== "string" ||
      typeof o.kind !== "string" ||
      !KINDS.has(o.kind) ||
      typeof o.severity !== "string" ||
      !SEVERITIES.has(o.severity) ||
      typeof o.created_at !== "string"
    ) {
      continue;
    }
    const amount = o.amount_minor == null ? null : Number(o.amount_minor);
    out.push({
      id: o.id,
      agentCode: o.agent_code,
      kind: o.kind,
      severity: o.severity,
      // Safeguarding text is never shown, whatever the row says.
      summary: o.kind === "safeguarding" ? null : typeof o.summary === "string" ? o.summary : null,
      amountMinor: amount !== null && Number.isFinite(amount) ? amount : null,
      createdAt: o.created_at,
      acknowledged: o.acked_at != null,
    });
  }
  return out;
}

/** Open items first, then the most severe, then the newest. */
export function sortEvents(events: readonly AgentEventRow[]): readonly AgentEventRow[] {
  return [...events].sort(
    (a, b) =>
      Number(a.acknowledged) - Number(b.acknowledged) ||
      (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0) ||
      b.createdAt.localeCompare(a.createdAt),
  );
}

export const SAFEGUARDING_NOTE = "Safeguarding item. Details are in the console, not here.";

export function eventHeadline(e: AgentEventRow): string {
  if (e.kind === "safeguarding") return SAFEGUARDING_NOTE;
  return e.summary?.trim() ? e.summary.trim() : `${e.kind} item`;
}

export function formatMinor(amountMinor: number, currency = "NGN"): string {
  return `${(amountMinor / 100).toFixed(2)} ${currency}`;
}

const ERROR_TEXT: Readonly<Record<string, string>> = {
  not_authenticated: "Sign in again to continue.",
  not_allowed: "You do not have permission to change agents for this organization.",
  unknown_agent: "That agent does not exist.",
  unknown_organization: "Your organization could not be found.",
  unknown_action: "That action is not available.",
  organization_inactive: "Your organization is not active, so agents cannot be switched on.",
  plan_excludes_agent: "Your plan does not include this agent.",
  already_enabled: "This agent is already switched on.",
  not_enabled: "This agent is not switched on.",
  already_paused: "This agent is already paused.",
  not_paused: "This agent is not paused.",
  paused_by_platform: "The platform paused this agent. Only the platform can resume it.",
  reason_too_short: `Give a reason of at least ${REASON_MIN} characters.`,
  reason_too_long: `Keep the reason to ${REASON_MAX} characters or fewer.`,
};

/** True when the error means the database proposal has not been applied. */
export function isNotApplied(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const m = (error.message ?? "").toLowerCase();
  return (
    error.code === "42883" || // undefined_function
    error.code === "42P01" || // undefined_table
    error.code === "PGRST202" || // function not found in the schema cache
    error.code === "PGRST205" || // table not found in the schema cache
    /could not find the (function|table)|does not exist/.test(m)
  );
}

export const NOT_APPLIED_TEXT =
  "Agent switches are not available yet: the database change for them has not been applied.";

export function messageForError(error: { message?: string; code?: string } | null): string {
  if (!error) return "";
  if (isNotApplied(error)) return NOT_APPLIED_TEXT;
  const m = error.message ?? "";
  for (const [code, text] of Object.entries(ERROR_TEXT)) {
    if (new RegExp(`\\b${code}\\b`).test(m)) return text;
  }
  // Never show raw database text to a school administrator.
  return "The change could not be saved. Try again, and tell support if it keeps happening.";
}
