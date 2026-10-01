/**
 * CoreGrid — governed context assembly (V1-minimal, MISSION-V1-010).
 *
 * Composes the AI context domain vocabulary from `ai-context.ts` (trust
 * classification, source kinds) into a pure assembly pipeline. This module
 * grants no authority: it filters, ranks, truncates and marks. It never
 * elevates a caller's permissions, never overrides an authorization decision,
 * and never re-classifies untrusted content into trusted instructions.
 *
 * Invariants (V5.3 Part 26 / Constitution §19–§21, §24):
 * - Context assembly NEVER grants authority. A candidate gated by a permission
 *   the actor does not hold is dropped, not revealed.
 * - Every dropped candidate is auditable with an explicit reason. Nothing is
 *   silently discarded.
 * - Content derived from user/customer/external input is wrapped in an explicit
 *   UNTRUSTED marker so downstream prompt assembly must delimit it (Section 24,
 *   Section 25 of phase-26).
 * - The assembler is PURE: time comes from config, sorting is deterministic.
 */
import {
  classifyContextTrust,
  type ContextTrustLevel,
} from "./ai-context";

/* ─────────────────────────────────────────────────────────────
 * Source + trust vocabulary (owned by ai-context.ts — reused, not redefined)
 * ────────────────────────────────────────────────────────────*/

/** Context source kinds, derived from the ai-context trust classifier. */
export type ContextCandidateSource = Parameters<typeof classifyContextTrust>[0];

/** Data sensitivity classification (independent of trust and of permission). */
export type ContextSensitivity = "public" | "internal" | "restricted";

/** Why a candidate was not included (audit trail — nothing drops silently). */
export type ContextDropReason =
  | "permission_denied"
  | "stale"
  | "budget"
  | "tenant_mismatch"
  | "source_not_requested";

/* ─────────────────────────────────────────────────────────────
 * Opaque content payload
 * ────────────────────────────────────────────────────────────*/

/**
 * Content is an opaque, branded string. The assembler carries, orders and
 * truncates it; it never parses or interprets it. This keeps prompt-injection
 * payloads out of assembly logic.
 */
export type ContextPayload = string & { readonly __brand: "ContextPayload" };

export function contextPayload(raw: string): ContextPayload {
  return raw as ContextPayload;
}

/* ─────────────────────────────────────────────────────────────
 * Request + candidate
 * ────────────────────────────────────────────────────────────*/

export interface ContextActorRef {
  userId: string;
  role: string;
  /** Resolved server-side permissions. Context assembly never extends this set. */
  permissions: readonly string[];
}

export interface ContextRequestBudget {
  maxItems: number;
  maxChars: number;
}

export interface ContextRequest {
  tenantRef: string;
  actorRef: ContextActorRef;
  purpose: string;
  /** Owning mission, or null when the request is not mission-scoped. */
  missionRef: string | null;
  budget: ContextRequestBudget;
  /** Declared sources this request may draw from; empty means all sources. */
  candidateSources: readonly ContextCandidateSource[];
}

export interface ContextCandidate {
  id: string;
  tenantRef: string;
  source: ContextCandidateSource;
  sensitivity: ContextSensitivity;
  /** ISO-8601 freshness timestamp (Section 34, phase-26). */
  freshnessAt: string;
  /** Opaque content payload. */
  content: ContextPayload;
  /** Permission required to include; null means no additional permission gate. */
  requiredPermission: string | null;
  /** Purpose tags used by the relevance scorer. */
  purposeTags?: readonly string[];
}

/* ─────────────────────────────────────────────────────────────
 * Envelope
 * ────────────────────────────────────────────────────────────*/

/**
 * Explicit untrusted marker: downstream prompt assembly must delimit untrusted
 * content and may never lift it into system instructions.
 */
export type AssembledContent =
  | { readonly kind: "trusted"; readonly content: ContextPayload }
  | {
      readonly kind: "untrusted";
      readonly reason: "derived_from_user_or_external_input";
      readonly content: ContextPayload;
    };

export interface AssembledContextItem {
  id: string;
  tenantRef: string;
  source: ContextCandidateSource;
  sensitivity: ContextSensitivity;
  trust: ContextTrustLevel;
  freshnessAt: string;
  requiredPermission: string | null;
  purposeMatch: boolean;
  content: AssembledContent;
}

export interface DroppedContextCandidate {
  id: string;
  tenantRef: string;
  source: ContextCandidateSource;
  reason: ContextDropReason;
  detail: string;
}

export type ContextEnvelope =
  | {
      kind: "assembled";
      items: AssembledContextItem[];
      dropped: DroppedContextCandidate[];
      /** True when any item content or item count was reduced to fit budget. */
      truncated: boolean;
      /** Ids whose content was shortened (as opposed to merely count-limited). */
      truncatedItemIds: string[];
      totalChars: number;
    }
  | { kind: "rejected"; reason: string };

/* ─────────────────────────────────────────────────────────────
 * Assembly config (pure — time is supplied, never sampled)
 * ────────────────────────────────────────────────────────────*/

export interface ContextAssemblyConfig {
  /** Candidates older than this many seconds relative to `now` are stale. */
  maxAgeSeconds: number;
  /** Assembly instant (ISO-8601). Required for purity. */
  now: string;
}

/* ─────────────────────────────────────────────────────────────
 * Relevance scoring (purpose > freshness > source priority, deterministic)
 * ────────────────────────────────────────────────────────────*/

const SOURCE_PRIORITY: Readonly<Record<ContextCandidateSource, number>> = {
  system_policy: 5,
  institution_configuration: 4,
  authorized_database_record: 3,
  external_document: 2,
  user_input: 1,
};

function purposeTokens(purpose: string): string[] {
  return purpose
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
}

function matchesPurpose(candidate: ContextCandidate, tokens: string[]): boolean {
  const tags = candidate.purposeTags ?? [];
  return tags.some((t) => tokens.includes(t.toLowerCase()));
}

/** Lexicographic tuple comparator — no floating-point ties. */
function compareRanked(
  a: { purposeMatch: boolean; freshnessAt: string; sourcePriority: number; id: string },
  b: { purposeMatch: boolean; freshnessAt: string; sourcePriority: number; id: string },
): number {
  if (a.purposeMatch !== b.purposeMatch) return a.purposeMatch ? -1 : 1;
  if (a.freshnessAt !== b.freshnessAt) return a.freshnessAt > b.freshnessAt ? -1 : 1;
  if (a.sourcePriority !== b.sourcePriority) return a.sourcePriority > b.sourcePriority ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/* ─────────────────────────────────────────────────────────────
 * assembleContext — pure pipeline
 * ────────────────────────────────────────────────────────────*/

/**
 * Assemble governed context for a request. Filters (permission, tenant, source
 * scope, freshness), ranks by relevance, enforces budget, and wraps untrusted
 * content in an explicit marker. Grants nothing: the actor's permission set is
 * read-only input and every exclusion is recorded.
 */
export function assembleContext(
  request: ContextRequest,
  candidates: readonly ContextCandidate[],
  config: ContextAssemblyConfig,
): ContextEnvelope {
  if (request.budget.maxItems <= 0 || request.budget.maxChars < 0) {
    return { kind: "rejected", reason: "Budget must allow at least zero chars and one item" };
  }

  const nowMs = Date.parse(config.now);
  if (Number.isNaN(nowMs)) {
    return { kind: "rejected", reason: "Config `now` is not a valid ISO-8601 timestamp" };
  }
  const purpose = purposeTokens(request.purpose);

  const dropped: DroppedContextCandidate[] = [];
  const admitted: Array<{
    candidate: ContextCandidate;
    purposeMatch: boolean;
    sourcePriority: number;
  }> = [];

  for (const candidate of candidates) {
    // Tenant boundary (Constitution §13): a candidate from another tenant is
    // never eligible, regardless of permissions or source priority.
    if (candidate.tenantRef !== request.tenantRef) {
      dropped.push({
        id: candidate.id,
        tenantRef: candidate.tenantRef,
        source: candidate.source,
        reason: "tenant_mismatch",
        detail: `Candidate tenant "${candidate.tenantRef}" does not match request tenant "${request.tenantRef}"`,
      });
      continue;
    }

    // Declared source scope: the request names the sources it may draw from.
    if (
      request.candidateSources.length > 0 &&
      !request.candidateSources.includes(candidate.source)
    ) {
      dropped.push({
        id: candidate.id,
        tenantRef: candidate.tenantRef,
        source: candidate.source,
        reason: "source_not_requested",
        detail: `Source "${candidate.source}" is not in the request's declared candidate sources`,
      });
      continue;
    }

    // Permission gate: context NEVER elevates. Missing permission → dropped.
    if (candidate.requiredPermission !== null) {
      if (!request.actorRef.permissions.includes(candidate.requiredPermission)) {
        dropped.push({
          id: candidate.id,
          tenantRef: candidate.tenantRef,
          source: candidate.source,
          reason: "permission_denied",
          detail: `Actor "${request.actorRef.userId}" lacks required permission "${candidate.requiredPermission}"`,
        });
        continue;
      }
    }

    // Freshness gate (Section 34): stale candidates are dropped, not aged quietly.
    const freshMs = Date.parse(candidate.freshnessAt);
    if (Number.isNaN(freshMs) || nowMs - freshMs > config.maxAgeSeconds * 1000) {
      dropped.push({
        id: candidate.id,
        tenantRef: candidate.tenantRef,
        source: candidate.source,
        reason: "stale",
        detail: Number.isNaN(freshMs)
          ? "Candidate freshness timestamp is not a valid ISO-8601 timestamp"
          : `Candidate age exceeds maxAgeSeconds=${config.maxAgeSeconds}`,
      });
      continue;
    }

    admitted.push({
      candidate,
      purposeMatch: matchesPurpose(candidate, purpose),
      sourcePriority: SOURCE_PRIORITY[candidate.source],
    });
  }

  admitted.sort(
    (a, b) =>
      compareRanked(
        {
          purposeMatch: a.purposeMatch,
          freshnessAt: a.candidate.freshnessAt,
          sourcePriority: a.sourcePriority,
          id: a.candidate.id,
        },
        {
          purposeMatch: b.purposeMatch,
          freshnessAt: b.candidate.freshnessAt,
          sourcePriority: b.sourcePriority,
          id: b.candidate.id,
        },
      ),
  );

  const items: AssembledContextItem[] = [];
  const truncatedItemIds: string[] = [];
  let remainingChars = request.budget.maxChars;

  for (const { candidate, purposeMatch } of admitted) {
    if (items.length >= request.budget.maxItems) {
      dropped.push({
        id: candidate.id,
        tenantRef: candidate.tenantRef,
        source: candidate.source,
        reason: "budget",
        detail: `Item count budget exhausted (maxItems=${request.budget.maxItems})`,
      });
      continue;
    }
    if (remainingChars <= 0) {
      dropped.push({
        id: candidate.id,
        tenantRef: candidate.tenantRef,
        source: candidate.source,
        reason: "budget",
        detail: `Character budget exhausted (maxChars=${request.budget.maxChars})`,
      });
      continue;
    }

    let content = candidate.content;
    if (content.length > remainingChars) {
      content = contextPayload(content.slice(0, remainingChars));
      truncatedItemIds.push(candidate.id);
    }
    remainingChars -= content.length;

    const trust = classifyContextTrust(candidate.source);
    items.push({
      id: candidate.id,
      tenantRef: candidate.tenantRef,
      source: candidate.source,
      sensitivity: candidate.sensitivity,
      trust,
      freshnessAt: candidate.freshnessAt,
      requiredPermission: candidate.requiredPermission,
      purposeMatch,
      content:
        trust === "untrusted_instruction" || trust === "untrusted_content"
          ? { kind: "untrusted", reason: "derived_from_user_or_external_input", content }
          : { kind: "trusted", content },
    });
  }

  return {
    kind: "assembled",
    items,
    dropped,
    truncated: truncatedItemIds.length > 0 || dropped.some((d) => d.reason === "budget"),
    truncatedItemIds,
    totalChars: items.reduce((sum, item) => sum + item.content.content.length, 0),
  };
}
