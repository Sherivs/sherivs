/**
 * Organization twin: escalation and reporting policy (ENGINE-18, ADR-096).
 *
 * The organization twin is not an agent and holds no permissions. It is the one place that
 * receives what the organization's agents raise, decides who must hear about it and how, and
 * builds the weekly report. Nothing is sent from here.
 *
 *   agent -> accountable role -> administrator (the organization's head)
 *
 * Rules:
 *   - Every money event reaches the administrator by push at once, however small, and is
 *     also counted in the weekly report. The action itself still needs the accountable
 *     role's approval; telling the administrator is not approving.
 *   - Urgent and critical events reach the accountable role by push at once. Critical events
 *     reach the administrator too. An event not acknowledged within its window moves up to
 *     the administrator.
 *   - Safeguarding content is never copied into a notification or a report: only that an
 *     item exists, and where to open it.
 *   - Quiet hours (22:00 to 06:00, Africa/Lagos) hold pushes and WhatsApp messages that are
 *     neither money nor critical, until the quiet period ends.
 *   - A recipient with no channel falls back push, WhatsApp, email, in-app. An event with no
 *     recipient is reported as unroutable, never dropped.
 *   - Weekly report: Monday 07:30 Africa/Lagos, WhatsApp when the administrator has opted in
 *     and has a verified number, otherwise email.
 *
 * Pure: time comes in as ISO strings. Lagos has no daylight saving, so a fixed +01:00 is exact.
 */
import { ORG_AGENTS } from "./org-agents";

export type EventKind =
  "money" | "safeguarding" | "compliance" | "operations" | "academic" | "info";
export type Severity = "info" | "attention" | "urgent" | "critical";
export type Channel = "push" | "whatsapp" | "email" | "in_app";

export interface OrgEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly agentCode: string;
  readonly kind: EventKind;
  readonly severity: Severity;
  readonly summary: string;
  readonly amountMinor?: number;
  readonly at: string;
  readonly ackedAt?: string | null;
  readonly dedupeKey?: string;
}

export interface Recipient {
  readonly identityId: string;
  readonly push: boolean;
  /** WhatsApp is usable only when opted in and the number is verified. */
  readonly whatsapp: boolean;
  readonly email: boolean;
}

export interface Notification {
  readonly identityId: string;
  readonly channel: Channel;
  readonly when: "now" | "held";
  readonly heldUntil?: string;
  readonly eventId: string;
  readonly toRole: "accountable" | "administrator";
  /** True when the body must carry no content from the event. */
  readonly redacted: boolean;
}

export interface RouteDecision {
  readonly eventId: string;
  readonly notifications: readonly Notification[];
  readonly inWeeklyReport: boolean;
  readonly unroutable: boolean;
  readonly reasons: readonly string[];
}

const LAGOS_OFFSET_MIN = 60;
const QUIET_START_HOUR = 22;
const QUIET_END_HOUR = 6;
const MIN = 60_000;

const SEV: Readonly<Record<Severity, number>> = { info: 0, attention: 1, urgent: 2, critical: 3 };

/** Minutes an event may stay unacknowledged before it moves up to the administrator. */
export const ACK_WINDOW_MIN: Readonly<Record<Severity, number | null>> = {
  info: null,
  attention: 24 * 60,
  urgent: 60,
  critical: 15,
};

function lagos(ms: number): Date {
  return new Date(ms + LAGOS_OFFSET_MIN * MIN);
}

export function isQuietHour(iso: string): boolean {
  const h = lagos(Date.parse(iso)).getUTCHours();
  return h >= QUIET_START_HOUR || h < QUIET_END_HOUR;
}

/** The first moment at or after `iso` that is outside quiet hours. */
export function quietEndsAt(iso: string): string {
  const ms = Date.parse(iso);
  if (!isQuietHour(iso)) return new Date(ms).toISOString();
  const l = lagos(ms);
  const dayShift = l.getUTCHours() >= QUIET_START_HOUR ? 1 : 0;
  const end = Date.UTC(
    l.getUTCFullYear(),
    l.getUTCMonth(),
    l.getUTCDate() + dayShift,
    QUIET_END_HOUR,
    0,
    0,
  );
  return new Date(end - LAGOS_OFFSET_MIN * MIN).toISOString();
}

/** First usable channel, in the order push, WhatsApp, email, in-app. */
export function pickChannel(r: Recipient): Channel {
  if (r.push) return "push";
  if (r.whatsapp) return "whatsapp";
  if (r.email) return "email";
  return "in_app";
}

const knownAgent = (code: string): boolean => ORG_AGENTS.some((a) => a.pack.code === code);

export function routeEvent(
  event: OrgEvent,
  who: {
    readonly accountable: readonly Recipient[];
    readonly administrators: readonly Recipient[];
  },
  nowIso: string,
): RouteDecision {
  const reasons: string[] = [];
  if (!knownAgent(event.agentCode)) {
    return {
      eventId: event.id,
      notifications: [],
      inWeeklyReport: false,
      unroutable: true,
      reasons: ["unknown_agent"],
    };
  }
  const redacted = event.kind === "safeguarding";
  const sev = SEV[event.severity];
  const out: Notification[] = [];

  const add = (r: Recipient, toRole: Notification["toRole"], forcePush: boolean) => {
    // A push the person has not enabled falls back; a forced push still uses the fallback order.
    const channel = forcePush ? pickChannel(r) : "in_app";
    const immediate = event.kind === "money" || event.severity === "critical";
    const quiet =
      isQuietHour(nowIso) && !immediate && (channel === "push" || channel === "whatsapp");
    out.push({
      identityId: r.identityId,
      channel,
      when: quiet ? "held" : "now",
      ...(quiet ? { heldUntil: quietEndsAt(nowIso) } : {}),
      eventId: event.id,
      toRole,
      redacted,
    });
  };

  // Accountable role: always sees it in-app; urgent and above also by push.
  for (const r of who.accountable) add(r, "accountable", sev >= SEV.urgent);
  if (sev >= SEV.urgent) reasons.push("urgent_to_accountable");

  // Administrator.
  const adminNow = event.kind === "money" || event.severity === "critical";
  if (adminNow) {
    for (const r of who.administrators) add(r, "administrator", true);
    reasons.push(
      event.kind === "money" ? "money_event_to_administrator" : "critical_to_administrator",
    );
  }

  const unroutable = who.accountable.length === 0 && who.administrators.length === 0;
  if (unroutable) reasons.push("no_recipient");
  return {
    eventId: event.id,
    notifications: out,
    inWeeklyReport: event.severity !== "info" || event.kind === "money",
    unroutable,
    reasons,
  };
}

/** Events past their acknowledgement window that have not yet been escalated to the administrator. */
export function overdueForEscalation(
  events: readonly OrgEvent[],
  nowIso: string,
): readonly string[] {
  const now = Date.parse(nowIso);
  return events
    .filter((e) => {
      const window = ACK_WINDOW_MIN[e.severity];
      if (window === null || e.ackedAt) return false;
      return now - Date.parse(e.at) >= window * MIN;
    })
    .map((e) => e.id)
    .sort();
}

/** Collapse repeats of the same raised event inside one hour, keeping the first. */
export function collapseDuplicates(events: readonly OrgEvent[]): readonly OrgEvent[] {
  const seen = new Map<string, number>();
  const kept: OrgEvent[] = [];
  for (const e of [...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    if (e.dedupeKey === undefined) {
      kept.push(e);
      continue;
    }
    const key = `${e.tenantId}|${e.agentCode}|${e.kind}|${e.dedupeKey}`;
    const last = seen.get(key);
    if (last !== undefined && Date.parse(e.at) - last < 60 * MIN) continue;
    seen.set(key, Date.parse(e.at));
    kept.push(e);
  }
  return kept;
}

/** The next Monday 07:30 Africa/Lagos strictly after `nowIso`. */
export function nextWeeklySendAt(nowIso: string): string {
  const l = lagos(Date.parse(nowIso));
  for (let add = 0; add <= 7; add++) {
    const cand = Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate() + add, 7, 30, 0);
    if (new Date(cand).getUTCDay() === 1 && cand > l.getTime()) {
      return new Date(cand - LAGOS_OFFSET_MIN * MIN).toISOString();
    }
  }
  /* c8 ignore next */
  throw new Error("unreachable: a Monday exists within eight days");
}

export interface WeeklyReport {
  readonly tenantId: string;
  readonly channel: "whatsapp" | "email";
  readonly sendAt: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly totals: {
    readonly events: number;
    readonly money: number;
    readonly moneyTotalMinor: number;
    readonly unacknowledgedUrgent: number;
    readonly byKind: Readonly<Record<EventKind, number>>;
  };
  readonly perAgent: readonly {
    readonly agentCode: string;
    readonly events: number;
    readonly urgent: number;
  }[];
  readonly lines: readonly string[];
}

const KINDS: readonly EventKind[] = [
  "money",
  "safeguarding",
  "compliance",
  "operations",
  "academic",
  "info",
];
const clip = (s: string): string => (s.length > 140 ? `${s.slice(0, 137)}...` : s);

export function buildWeeklyReport(input: {
  readonly tenantId: string;
  readonly events: readonly OrgEvent[];
  /** The report covers the seven days ending here. */
  readonly windowEndIso: string;
  readonly administratorWhatsappVerified: boolean;
  readonly currency?: string;
}): WeeklyReport {
  const end = Date.parse(input.windowEndIso);
  const start = end - 7 * 24 * 60 * MIN;
  const events = collapseDuplicates(
    input.events.filter((e) => {
      const t = Date.parse(e.at);
      return e.tenantId === input.tenantId && t > start && t <= end;
    }),
  );
  const byKind = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<EventKind, number>;
  let moneyTotal = 0;
  const agents = new Map<string, { events: number; urgent: number }>();
  let unackedUrgent = 0;
  for (const e of events) {
    byKind[e.kind] += 1;
    if (e.kind === "money") moneyTotal += Math.max(0, Math.trunc(e.amountMinor ?? 0));
    const a = agents.get(e.agentCode) ?? { events: 0, urgent: 0 };
    a.events += 1;
    if (SEV[e.severity] >= SEV.urgent) {
      a.urgent += 1;
      if (!e.ackedAt) unackedUrgent += 1;
    }
    agents.set(e.agentCode, a);
  }
  const currency = input.currency ?? "NGN";
  const lines: string[] = [
    `${events.length} item${events.length === 1 ? "" : "s"} this week.`,
    `Money: ${byKind.money} event${byKind.money === 1 ? "" : "s"}, ${(moneyTotal / 100).toFixed(2)} ${currency} in total.`,
  ];
  if (unackedUrgent > 0)
    lines.push(`${unackedUrgent} urgent item${unackedUrgent === 1 ? "" : "s"} still need a reply.`);
  if (byKind.safeguarding > 0) {
    lines.push(
      `${byKind.safeguarding} safeguarding item${byKind.safeguarding === 1 ? "" : "s"}. Open the console to view them.`,
    );
  }
  for (const e of events
    .filter((x) => x.kind !== "safeguarding" && SEV[x.severity] >= SEV.urgent)
    .slice(0, 5)) {
    lines.push(`${e.agentCode}: ${clip(e.summary)}`);
  }
  return {
    tenantId: input.tenantId,
    channel: input.administratorWhatsappVerified ? "whatsapp" : "email",
    sendAt: nextWeeklySendAt(input.windowEndIso),
    windowStart: new Date(start).toISOString(),
    windowEnd: new Date(end).toISOString(),
    totals: {
      events: events.length,
      money: byKind.money,
      moneyTotalMinor: moneyTotal,
      unacknowledgedUrgent: unackedUrgent,
      byKind,
    },
    perAgent: [...agents.entries()]
      .map(([agentCode, v]) => ({ agentCode, ...v }))
      .sort((a, b) => a.agentCode.localeCompare(b.agentCode)),
    lines,
  };
}
