/**
 * Weekly organization report job (ENGINE-21, ADR-099).
 *
 * Each Monday at 06:30 UTC (07:30 in Lagos) the scheduler calls the cron route, which calls
 * this. It asks the database to open one report request per organization that has an agent
 * switched on, builds each report from that organization's events, and stores it. It does not
 * send anything: sending needs the notification worker, which is not part of this change.
 *
 * Safe to run twice: the window is the most recent Monday 06:30 UTC, so a retry or a manual
 * call asks for the same window and the database keeps one request per organization and week.
 * One organization failing does not stop the others.
 *
 * The client is injected so the job runs against a stub in tests. It must be the service-role
 * client: the database functions it calls refuse anyone else.
 */
import { buildWeeklyReport, type EventKind, type OrgEvent, type Severity } from "./escalation";

type Err = { message: string; code?: string } | null;
type Result = { data: unknown; error: Err };
interface Query extends PromiseLike<Result> {
  eq(column: string, value: unknown): Query;
  gt(column: string, value: unknown): Query;
  lte(column: string, value: unknown): Query;
  order(column: string, options?: { ascending: boolean }): Query;
  limit(count: number): Query;
}
export interface JobClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<Result>;
  from(table: string): { select(columns: string): Query };
}

export const WEEKLY_HOUR_UTC = 6;
export const WEEKLY_MINUTE_UTC = 30;
const DAY = 24 * 60 * 60 * 1000;
/** More events than this in one week for one organization are summarized from the newest. */
export const EVENTS_PER_ORG = 2000;
const LINE_MAX = 200;

/** The most recent Monday 06:30 UTC at or before `now`. */
export function weekWindowEnd(now: Date): Date {
  const t = now.getTime();
  const day = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      WEEKLY_HOUR_UTC,
      WEEKLY_MINUTE_UTC,
    ),
  );
  // getUTCDay: Sunday 0, Monday 1. Step back to Monday.
  let candidate = day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY;
  if (candidate > t) candidate -= 7 * DAY;
  return new Date(candidate);
}

const KINDS: ReadonlySet<string> = new Set([
  "money",
  "safeguarding",
  "compliance",
  "operations",
  "academic",
  "info",
]);
const SEVERITIES: ReadonlySet<string> = new Set(["info", "attention", "urgent", "critical"]);

export function toOrgEvent(row: unknown, orgId: string): OrgEvent | null {
  if (typeof row !== "object" || row === null) return null;
  const o = row as Record<string, unknown>;
  if (
    typeof o.id !== "string" ||
    typeof o.agent_code !== "string" ||
    typeof o.kind !== "string" ||
    !KINDS.has(o.kind) ||
    typeof o.severity !== "string" ||
    !SEVERITIES.has(o.severity) ||
    typeof o.created_at !== "string"
  ) {
    return null;
  }
  const amount = o.amount_minor == null ? undefined : Number(o.amount_minor);
  return {
    id: o.id,
    tenantId: orgId,
    agentCode: o.agent_code,
    kind: o.kind as EventKind,
    severity: o.severity as Severity,
    // Safeguarding rows carry no text, and none is read even if one were present.
    summary: o.kind === "safeguarding" || typeof o.summary !== "string" ? "" : o.summary,
    at: o.created_at,
    ackedAt: typeof o.acked_at === "string" ? o.acked_at : null,
    ...(amount !== undefined && Number.isFinite(amount) ? { amountMinor: amount } : {}),
    ...(typeof o.dedupe_key === "string" ? { dedupeKey: o.dedupe_key } : {}),
  };
}

export type WeeklyJobResult =
  | { readonly status: "not_applied" }
  | {
      readonly status: "ok";
      readonly windowEnd: string;
      /** New requests opened by this run; zero on a repeat run. */
      readonly newlyRequested: number;
      readonly built: number;
      readonly failed: readonly { readonly reportId: string; readonly error: string }[];
      /** Always zero: sending is not part of this job. */
      readonly sent: 0;
    };

const isMissing = (e: Err): boolean =>
  e !== null &&
  (e.code === "42883" ||
    e.code === "42P01" ||
    e.code === "PGRST202" ||
    e.code === "PGRST205" ||
    /could not find the (function|table)|does not exist/i.test(e.message));

const shortError = (e: Err): string => (e ? e.message.slice(0, 120) : "failed");

export async function runWeeklyReports(input: {
  readonly admin: JobClient;
  readonly now: Date;
}): Promise<WeeklyJobResult> {
  const windowEnd = weekWindowEnd(input.now);
  const windowEndIso = windowEnd.toISOString();
  const windowStartIso = new Date(windowEnd.getTime() - 7 * DAY).toISOString();

  const opened = await input.admin.rpc("request_org_weekly_reports", {
    p_window_end: windowEndIso,
  });
  if (opened.error) {
    if (isMissing(opened.error)) return { status: "not_applied" };
    throw new Error(shortError(opened.error));
  }
  const newlyRequested = typeof opened.data === "number" ? opened.data : 0;

  const pending = await input.admin
    .from("org_weekly_reports")
    .select("id,org_id")
    .eq("status", "requested")
    .eq("window_end", windowEndIso);
  if (pending.error) throw new Error(shortError(pending.error));

  let built = 0;
  const failed: { reportId: string; error: string }[] = [];
  const reports = Array.isArray(pending.data) ? pending.data : [];
  for (const r of reports) {
    const row = r as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.org_id !== "string") continue;
    const reportId = row.id;
    const orgId = row.org_id;
    try {
      const fetched = await input.admin
        .from("org_agent_events")
        .select("id,agent_code,kind,severity,summary,amount_minor,created_at,acked_at,dedupe_key")
        .eq("org_id", orgId)
        .gt("created_at", windowStartIso)
        .lte("created_at", windowEndIso)
        .order("created_at", { ascending: false })
        .limit(EVENTS_PER_ORG);
      if (fetched.error) throw new Error(shortError(fetched.error));
      const events = (Array.isArray(fetched.data) ? fetched.data : [])
        .map((e) => toOrgEvent(e, orgId))
        .filter((e): e is OrgEvent => e !== null);
      const report = buildWeeklyReport({
        tenantId: orgId,
        events,
        windowEndIso,
        // No verified WhatsApp opt-in is read here, so the report is addressed to email.
        administratorWhatsappVerified: false,
      });
      const stored = await input.admin.rpc("store_org_weekly_report", {
        p_id: reportId,
        p_channel: report.channel,
        p_totals: report.totals,
        p_lines: report.lines.map((l) =>
          l.length > LINE_MAX ? `${l.slice(0, LINE_MAX - 3)}...` : l,
        ),
      });
      if (stored.error) throw new Error(shortError(stored.error));
      built += 1;
    } catch (e) {
      failed.push({ reportId, error: e instanceof Error ? e.message.slice(0, 120) : "failed" });
    }
  }
  return { status: "ok", windowEnd: windowEndIso, newlyRequested, built, failed, sent: 0 };
}
