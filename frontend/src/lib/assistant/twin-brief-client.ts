/**
 * Personal twin brief client (SV1-TWIN-05).
 *
 * The browser never decides who the user or tenant is and never sends either.
 * Requests carry only the operation and a proposal id; the server resolves the
 * identity, tenant and role from the session and applies its own checks. With no
 * transport wired the client reports `unavailable`, exactly like the assistant
 * client, so the UI shows an honest empty state instead of invented content.
 *
 * Anything coming back is treated as untrusted input: it is parsed field by
 * field, unknown fields are dropped, a card without a label or a source is
 * dropped and counted, and a label that does not match the proposal kind is
 * dropped (a prediction can never be dressed up as a recommendation).
 */

import { PROPOSAL_LABEL, type ProposalKind } from "@/lib/scholar/personal-twin/proposals";

export type TwinBriefDecision = "approve" | "dismiss" | "acknowledge";

export type TwinBriefRequest =
  | { readonly op: "brief" }
  | { readonly op: "decide"; readonly proposalId: string; readonly decision: TwinBriefDecision };

export type TwinBriefTransport = (request: TwinBriefRequest) => Promise<unknown>;

export interface TwinBriefItem {
  readonly proposalId: string;
  readonly kind: ProposalKind;
  readonly label: string;
  readonly summary: string;
  readonly sourceKind: string;
  readonly sourceDescription: string;
  readonly sourceAsOfMs: number;
  /** 0..1 for predictions, otherwise null. */
  readonly confidence: number | null;
  /** True only when the server says a decision can still be made on it. */
  readonly actionable: boolean;
}

export interface TwinBrief {
  /** When the server generated this brief. */
  readonly generatedAtMs: number;
  readonly items: readonly TwinBriefItem[];
  /** Items the server left out to stay within its limit. */
  readonly omitted: number;
  /** Items this client dropped because they were malformed. */
  readonly dropped: number;
}

export type TwinBriefResult =
  | { readonly status: "unavailable" }
  | { readonly status: "error" }
  | { readonly status: "available"; readonly brief: TwinBrief };

export type TwinDecisionResult =
  | { readonly status: "unavailable" }
  | { readonly status: "error" }
  | { readonly status: "ok" }
  | { readonly status: "rejected"; readonly reason: TwinDecisionRejection };

export const TWIN_DECISION_REJECTIONS = [
  "not_open",
  "proposal_expired",
  "permission_not_held",
  "not_owner",
  "unknown_proposal",
  "other",
] as const;
export type TwinDecisionRejection = (typeof TWIN_DECISION_REJECTIONS)[number];

export interface TwinBriefClient {
  fetchBrief(): Promise<TwinBriefResult>;
  decide(proposalId: string, decision: TwinBriefDecision): Promise<TwinDecisionResult>;
}

const MAX_ITEMS = 50;
const MAX_TEXT = 280;
const KINDS = Object.keys(PROPOSAL_LABEL) as ProposalKind[];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown, max = MAX_TEXT): string | null =>
  typeof v === "string" && v.trim().length > 0 ? v.trim().slice(0, max) : null;
const finite = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;

function parseItem(raw: unknown): TwinBriefItem | null {
  if (!isRecord(raw)) return null;
  const proposalId = text(raw.proposalId, 128);
  const kind = KINDS.find((k) => k === raw.kind);
  const label = text(raw.label, 64);
  const summary = text(raw.summary);
  const sourceDescription = text(raw.sourceDescription);
  const sourceKind = text(raw.sourceKind, 32);
  const sourceAsOfMs = finite(raw.sourceAsOfMs);
  if (!proposalId || !kind || !label || !summary || !sourceDescription || !sourceKind) return null;
  if (sourceAsOfMs === null) return null;
  // The visible label must be the one the platform assigns to this kind.
  if (label !== PROPOSAL_LABEL[kind]) return null;
  let confidence: number | null = null;
  if (kind === "prediction") {
    const c = raw.confidence;
    if (typeof c !== "number" || !Number.isFinite(c) || c < 0 || c > 1) return null;
    confidence = c;
  }
  // A prediction is information only, whatever the server claims.
  const actionable = kind !== "prediction" && raw.actionable === true;
  return Object.freeze({
    proposalId,
    kind,
    label,
    summary,
    sourceKind,
    sourceDescription,
    sourceAsOfMs,
    confidence,
    actionable,
  });
}

export function parseTwinBrief(raw: unknown): TwinBrief | null {
  if (!isRecord(raw)) return null;
  const generatedAtMs = finite(raw.generatedAtMs);
  if (generatedAtMs === null || !Array.isArray(raw.items)) return null;
  const rawItems = raw.items.slice(0, MAX_ITEMS);
  const items: TwinBriefItem[] = [];
  let dropped = Math.max(0, raw.items.length - rawItems.length);
  const seen = new Set<string>();
  for (const r of rawItems) {
    const item = parseItem(r);
    if (!item || seen.has(item.proposalId)) {
      dropped += 1;
      continue;
    }
    seen.add(item.proposalId);
    items.push(item);
  }
  const omitted = finite(raw.omitted) ?? 0;
  return Object.freeze({
    generatedAtMs,
    items: Object.freeze(items),
    omitted: Math.floor(omitted),
    dropped,
  });
}

function parseDecision(raw: unknown): TwinDecisionResult {
  if (!isRecord(raw)) return { status: "error" };
  if (raw.ok === true) return { status: "ok" };
  if (raw.ok === false) {
    const reason = TWIN_DECISION_REJECTIONS.find((r) => r === raw.reason) ?? "other";
    return { status: "rejected", reason };
  }
  return { status: "error" };
}

export function createTwinBriefClient(transport?: TwinBriefTransport): TwinBriefClient {
  return {
    fetchBrief: async () => {
      if (!transport) return { status: "unavailable" };
      try {
        const brief = parseTwinBrief(await transport({ op: "brief" }));
        return brief ? { status: "available", brief } : { status: "error" };
      } catch {
        return { status: "error" };
      }
    },
    decide: async (proposalId, decision) => {
      if (!transport) return { status: "unavailable" };
      try {
        return parseDecision(await transport({ op: "decide", proposalId, decision }));
      } catch {
        return { status: "error" };
      }
    },
  };
}
