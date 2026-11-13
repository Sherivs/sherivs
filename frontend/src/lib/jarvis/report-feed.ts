/**
 * JARVIS minimized, read-only report feed and daily brief (SV1-JARVIS-05).
 *
 * The feed is aggregate only: counts, enums and ISO instants, built from an
 * explicit allowlist. It never copies a request id, actor, tenant, summary or
 * any free text from its inputs, so no personal or tenant record content can
 * reach a consumer (for example the Grok orchestrator). The result is deeply
 * frozen; there is no write path.
 */

import type { ApprovalInboxState } from "./approval-inbox";
import { composeBriefing, type BriefingEvent, type BriefingResult } from "./briefing";
import type { RouteLogEntry, RoutingControls } from "./hermes-routing";
import { PLAYBOOK_WORKSPACES, type PlaybookWorkspaceId } from "./playbooks";
import { JARVIS_RISK_POLICY_VERSION } from "./risk-policy";

export const REPORT_FEED_SCHEMA = "jarvis.report-feed.v1" as const;

type DecisionCounts = { readonly allow: number; readonly escalate: number; readonly deny: number };

export interface JarvisReportFeed {
  readonly schema: typeof REPORT_FEED_SCHEMA;
  readonly policyVersion: typeof JARVIS_RISK_POLICY_VERSION;
  readonly generatedAt: string;
  readonly routing: {
    readonly total: number;
    readonly byWorkspace: Readonly<Record<PlaybookWorkspaceId, DecisionCounts>>;
  };
  readonly approvals: {
    readonly pending: number;
    readonly approved: number;
    readonly denied: number;
    readonly expired: number;
    readonly executed: number;
    readonly pendingT3: number;
  };
  readonly controls: {
    readonly killSwitchEngaged: boolean;
    readonly requestsUsed: number;
    readonly requestsMax: number;
    readonly escalationsUsed: number;
    readonly escalationsMax: number;
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

export function buildJarvisReportFeed(input: {
  readonly generatedAt: string;
  readonly routeLog: readonly RouteLogEntry[];
  readonly approvals: ApprovalInboxState;
  readonly controls: RoutingControls;
}): JarvisReportFeed {
  const counts = Object.fromEntries(
    PLAYBOOK_WORKSPACES.map((w) => [w, { allow: 0, escalate: 0, deny: 0 }]),
  ) as Record<PlaybookWorkspaceId, { allow: number; escalate: number; deny: number }>;
  let total = 0;
  for (const entry of input.routeLog) {
    total += 1;
    // Entries without a recognised workspace are counted in the total only.
    if (entry.workspace !== null && Object.hasOwn(counts, entry.workspace)) {
      const bucket = counts[entry.workspace];
      if (
        entry.decision === "allow" ||
        entry.decision === "escalate" ||
        entry.decision === "deny"
      ) {
        bucket[entry.decision] += 1;
      }
    }
  }
  const approvals = { pending: 0, approved: 0, denied: 0, expired: 0, executed: 0, pendingT3: 0 };
  for (const request of input.approvals.requests) {
    if (Object.hasOwn(approvals, request.status)) {
      approvals[request.status as keyof typeof approvals] += 1;
    }
    if (request.status === "pending" && request.riskTier === "T3") approvals.pendingT3 += 1;
  }
  const { killSwitch, budget } = input.controls;
  return deepFreeze({
    schema: REPORT_FEED_SCHEMA,
    policyVersion: JARVIS_RISK_POLICY_VERSION,
    generatedAt: input.generatedAt,
    routing: { total, byWorkspace: counts },
    approvals,
    controls: {
      killSwitchEngaged: killSwitch.engaged === true,
      requestsUsed: budget.requests,
      requestsMax: budget.maxRequests,
      escalationsUsed: budget.escalations,
      escalationsMax: budget.maxEscalations,
    },
  });
}

export const DAILY_BRIEF_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Compose the daily brief from already-redacted events in the 24 hours up to
 * `now`. Reuses the existing briefing composer (verbatim restatement only).
 */
export function composeDailyBrief(
  events: readonly BriefingEvent[],
  now: string,
  options?: { maxLines?: number },
): BriefingResult {
  const end = Date.parse(now);
  if (!Number.isFinite(end)) {
    return { ok: false, code: "invalid_event", reason: "A valid brief time is required" };
  }
  const windowed = events.filter((event) => {
    const at = Date.parse(event.at);
    // Unparseable instants are kept so composeBriefing fails closed on them.
    return !Number.isFinite(at) || (at > end - DAILY_BRIEF_WINDOW_MS && at <= end);
  });
  return composeBriefing(windowed, options);
}
