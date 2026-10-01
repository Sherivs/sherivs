/**
 * CoreGrid — Jarvis V1 executive briefing composer (V5.3 Part 15).
 *
 * A pure briefing composer over already-redacted, plain event records. The
 * composer restates event summaries verbatim under a deterministic ordering —
 * critical first, then severity, then time — under a hard length cap. It has
 * no vocabulary of its own beyond the fixed header constant: it can never
 * invent facts, because every non-header token it emits is copied from an
 * input summary.
 */
import type { IncidentSeverity } from "@/lib/jarvis/escalation";

const SEVERITIES: readonly IncidentSeverity[] = ["info", "warning", "critical"];

const SEVERITY_RANK: Readonly<Record<IncidentSeverity, number>> = {
  critical: 0,
  warning: 1,
  info: 2,
};

/** The only fixed prose the composer emits; everything else is verbatim input. */
export const BRIEFING_HEADER = "Executive briefing (restated events only):";

/** Hard cap on briefing length — also the maximum a caller may request. */
export const BRIEFING_HARD_MAX_LINES = 100;
const DEFAULT_MAX_LINES = 20;

export interface BriefingEvent {
  kind: string;
  tenantRef: string;
  /** ISO-8601 timestamp. */
  at: string;
  severity: IncidentSeverity;
  /** Already-redacted summary string — the composer restates it verbatim. */
  summary: string;
}

export interface BriefingLine {
  kind: string;
  tenantRef: string;
  at: string;
  severity: IncidentSeverity;
  /** Verbatim copy of the input event summary — never paraphrased or extended. */
  summary: string;
}

export interface ExecutiveBriefing {
  header: typeof BRIEFING_HEADER;
  lines: BriefingLine[];
  truncated: boolean;
  totalEvents: number;
}

export type BriefingResult =
  | { ok: true; briefing: ExecutiveBriefing }
  | { ok: false; code: "invalid_event"; reason: string };

function isValidTimestamp(at: string): boolean {
  return typeof at === "string" && at.length > 0 && Number.isFinite(Date.parse(at));
}

/**
 * Compose an executive briefing. Fails closed on any event that is malformed,
 * carries an unknown severity, or an unparseable timestamp. Ordering is fully
 * deterministic: severity rank (critical, warning, info), then timestamp
 * ascending, then summary lexicographic as a stable tie-break.
 */
export function composeBriefing(
  events: readonly BriefingEvent[],
  options?: { maxLines?: number },
): BriefingResult {
  for (const event of events) {
    if (
      typeof event.kind !== "string" ||
      event.kind.length === 0 ||
      typeof event.tenantRef !== "string" ||
      event.tenantRef.length === 0 ||
      typeof event.summary !== "string" ||
      event.summary.length === 0
    ) {
      return {
        ok: false,
        code: "invalid_event",
        reason: "Events require non-empty kind, tenantRef and summary",
      };
    }
    if (!SEVERITIES.includes(event.severity)) {
      return {
        ok: false,
        code: "invalid_event",
        reason: `Unknown severity "${String(event.severity)}" — briefing fails closed`,
      };
    }
    if (!isValidTimestamp(event.at)) {
      return {
        ok: false,
        code: "invalid_event",
        reason: `Event timestamp "${String(event.at)}" is not a parseable ISO-8601 instant`,
      };
    }
  }
  const requested = options?.maxLines ?? DEFAULT_MAX_LINES;
  const maxLines = Math.min(Math.max(1, Math.trunc(requested)), BRIEFING_HARD_MAX_LINES);
  const sorted = [...events].sort((a, b) => {
    const rankDelta = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (rankDelta !== 0) return rankDelta;
    const timeDelta = Date.parse(a.at) - Date.parse(b.at);
    if (timeDelta !== 0) return timeDelta;
    return a.summary < b.summary ? -1 : a.summary > b.summary ? 1 : 0;
  });
  return {
    ok: true,
    briefing: {
      header: BRIEFING_HEADER,
      lines: sorted.slice(0, maxLines).map((event) => ({
        kind: event.kind,
        tenantRef: event.tenantRef,
        at: event.at,
        severity: event.severity,
        summary: event.summary,
      })),
      truncated: sorted.length > maxLines,
      totalEvents: sorted.length,
    },
  };
}
