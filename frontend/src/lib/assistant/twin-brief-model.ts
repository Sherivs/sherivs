/**
 * Twin brief view model (SV1-TWIN-05).
 *
 * Pure rules for what the panel shows and what it lets a person do, so the
 * component stays thin and the rules are testable without a browser.
 *
 * Offline and stale degradation:
 * - Nothing is cached outside memory, and the cache is keyed to the exact
 *   identity, organization and role it was fetched for. Any change drops it.
 * - A cached brief is always shown with how old it is.
 * - Approving needs a live, recent brief and a recent source. Dismiss and
 *   acknowledge need a connection, because each is a server call. Nothing is
 *   queued offline, so no decision is ever replayed later against changed data.
 */

import type { TwinBrief, TwinBriefItem } from "./twin-brief-client";

export const BRIEF_STALE_AFTER_MS = 15 * 60 * 1000;
export const SOURCE_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export interface BriefCache {
  /** Identity, organization and role this brief was fetched for. */
  readonly contextKey: string;
  readonly fetchedAtMs: number;
  readonly brief: TwinBrief;
}

/** A cached brief is usable only for the exact context it was fetched in. */
export function cacheForContext(cache: BriefCache | null, contextKey: string): BriefCache | null {
  return cache && cache.contextKey === contextKey && contextKey.length > 0 ? cache : null;
}

export type BriefStatus =
  | "no_context"
  | "unavailable"
  | "loading"
  | "error"
  | "empty"
  | "live"
  | "stale"
  | "offline_cached"
  | "offline_empty";

export interface BriefInputs {
  readonly contextKey: string;
  readonly online: boolean;
  readonly loading: boolean;
  readonly serviceAvailable: boolean;
  readonly lastFetchFailed: boolean;
  readonly cache: BriefCache | null;
  readonly nowMs: number;
}

export function briefStatus(i: BriefInputs): BriefStatus {
  if (!i.contextKey) return "no_context";
  const cache = cacheForContext(i.cache, i.contextKey);
  if (!i.online) return cache ? "offline_cached" : "offline_empty";
  if (!i.serviceAvailable) return "unavailable";
  if (!cache) {
    if (i.loading) return "loading";
    return i.lastFetchFailed ? "error" : "loading";
  }
  if (cache.brief.items.length === 0)
    return i.nowMs - cache.fetchedAtMs > BRIEF_STALE_AFTER_MS ? "stale" : "empty";
  return i.nowMs - cache.fetchedAtMs > BRIEF_STALE_AFTER_MS ? "stale" : "live";
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". Never negative. */
export function ageLabel(ageMs: number): string {
  const ms = Math.max(0, ageMs);
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} days ago`;
}

export interface BriefBanner {
  readonly tone: "info" | "warning";
  readonly text: string;
}

export function briefBanner(
  status: BriefStatus,
  cache: BriefCache | null,
  nowMs: number,
): BriefBanner | null {
  const age = cache ? ageLabel(nowMs - cache.fetchedAtMs) : null;
  switch (status) {
    case "offline_cached":
      return {
        tone: "warning",
        text: `You are offline. Showing the brief from ${age}. Decisions are paused until you reconnect.`,
      };
    case "offline_empty":
      return { tone: "warning", text: "You are offline and there is no saved brief to show." };
    case "stale":
      return {
        tone: "warning",
        text: `This brief was updated ${age} and may be out of date. Refresh before approving anything.`,
      };
    case "unavailable":
      return {
        tone: "info",
        text: "Your twin brief is not available yet. Nothing is being shown or invented.",
      };
    case "error":
      return { tone: "warning", text: "The brief could not be loaded. Try again." };
    default:
      return null;
  }
}

export interface ActionState {
  readonly enabled: boolean;
  /** Plain-language reason shown next to a disabled action. */
  readonly reason: string | null;
}

export interface CardViewModel {
  readonly proposalId: string;
  readonly label: string;
  readonly summary: string;
  readonly sourceLine: string;
  readonly sourceStale: boolean;
  readonly confidenceLine: string | null;
  readonly informationOnly: boolean;
  readonly approve: ActionState;
  readonly dismiss: ActionState;
  readonly acknowledge: ActionState;
}

function connected(status: BriefStatus): boolean {
  return status === "live" || status === "stale" || status === "empty";
}

export function cardViewModel(
  item: TwinBriefItem,
  status: BriefStatus,
  nowMs: number,
): CardViewModel {
  const sourceAge = nowMs - item.sourceAsOfMs;
  const sourceStale = sourceAge > SOURCE_STALE_AFTER_MS;
  const online = connected(status);
  const offlineReason = "Needs a connection.";

  let approve: ActionState;
  if (!item.actionable || item.kind === "prediction") {
    approve = { enabled: false, reason: null };
  } else if (!online) {
    approve = { enabled: false, reason: offlineReason };
  } else if (status !== "live") {
    approve = { enabled: false, reason: "Refresh the brief before approving." };
  } else if (sourceStale) {
    approve = { enabled: false, reason: "The source data is out of date." };
  } else {
    approve = { enabled: true, reason: null };
  }

  const informationOnly = !item.actionable;
  const dismiss: ActionState = online
    ? { enabled: true, reason: null }
    : { enabled: false, reason: offlineReason };
  const acknowledge: ActionState = !informationOnly
    ? { enabled: false, reason: null }
    : online
      ? { enabled: true, reason: null }
      : { enabled: false, reason: offlineReason };

  return Object.freeze({
    proposalId: item.proposalId,
    label: item.label,
    summary: item.summary,
    sourceLine: `Source: ${item.sourceDescription} (${ageLabel(sourceAge)})`,
    sourceStale,
    confidenceLine:
      item.confidence === null
        ? null
        : `${Math.round(item.confidence * 100)}% confidence. A prediction, not a fact.`,
    informationOnly,
    approve,
    dismiss,
    acknowledge,
  });
}

export interface BriefViewModel {
  readonly status: BriefStatus;
  readonly banner: BriefBanner | null;
  readonly freshness: string | null;
  readonly cards: readonly CardViewModel[];
  readonly footnote: string | null;
  readonly canRefresh: boolean;
}

export function buildBriefViewModel(i: BriefInputs): BriefViewModel {
  const status = briefStatus(i);
  const cache = cacheForContext(i.cache, i.contextKey);
  const showCards =
    status === "live" || status === "stale" || status === "offline_cached" || status === "empty";
  const cards =
    showCards && cache ? cache.brief.items.map((it) => cardViewModel(it, status, i.nowMs)) : [];
  const notes: string[] = [];
  if (showCards && cache) {
    if (cache.brief.omitted > 0) notes.push(`${cache.brief.omitted} more not shown.`);
    if (cache.brief.dropped > 0) {
      notes.push(`${cache.brief.dropped} hidden because they had no clear source.`);
    }
  }
  return Object.freeze({
    status,
    banner: briefBanner(status, cache, i.nowMs),
    freshness: showCards && cache ? `Updated ${ageLabel(i.nowMs - cache.fetchedAtMs)}` : null,
    cards: Object.freeze(cards),
    footnote: notes.length ? notes.join(" ") : null,
    canRefresh: i.online && i.serviceAvailable && i.contextKey.length > 0 && !i.loading,
  });
}

/** What to say after a rejected decision. Never blames the person. */
export function rejectionMessage(reason: string): string {
  switch (reason) {
    case "not_open":
      return "This item was already handled. Refresh to see the latest.";
    case "proposal_expired":
      return "This item has expired. Refresh to see the latest.";
    case "permission_not_held":
      return "Your current role no longer allows this action.";
    case "not_owner":
    case "unknown_proposal":
      return "This item is no longer available.";
    default:
      return "The server did not accept that. Nothing was changed.";
  }
}
