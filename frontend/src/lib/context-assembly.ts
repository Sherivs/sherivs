/**
 * CoreGrid — governed context assembly (V1-minimal, MISSION-V1-010; extended
 * additively by MISSION-R-30 / J-011 + J-012, V1CAP-023/024).
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
 *   silently discarded. (J-011: every exclusion is a first-class record with
 *   the filter stage that produced it, the audit instant, and minimization
 *   specifics such as withheld character counts — unauditable minimization is
 *   a privacy-law failure, Constitution §19.)
 * - Every assembled package is fully scoped (J-011, G-011): memory_scope,
 *   data_scope, risk_level and trace_id are stated on the package itself, and
 *   the package carries a sufficiency verdict stating whether what survived
 *   filtering is sufficient for the declared purpose.
 * - Content derived from user/customer/external input is wrapped in an explicit
 *   UNTRUSTED marker so downstream prompt assembly must delimit it (Section 24,
 *   Section 25 of phase-26). Re-classification never happens, including when
 *   material is explicitly carried across a scope switch.
 * - Context switches are zero-bleed (J-012, G-070): `switchContextScope`
 *   assembles a fresh package for the new scope; prior-scope material enters
 *   the new package ONLY via explicit carry requests that pass freshness,
 *   declared-scope and re-authorization gates. Everything else from the prior
 *   package is recorded as an exclusion.
 * - The assembler is PURE: time comes from config, sorting is deterministic,
 *   and trace ids are derived deterministically (never sampled or random).
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
  | "source_not_requested"
  | /** J-011: candidate sensitivity exceeds the declared data-scope ceiling. */
    "exceeds_declared_scope"
  | /** J-012: prior-scope material withheld at a context switch. */
    "not_carried";

/** Where in the assembly/switch pipeline an exclusion was produced (audit provenance). */
export type ContextExclusionStage =
  | "tenant_boundary"
  | "source_scope"
  | "sensitivity_scope"
  | "permission_gate"
  | "freshness_gate"
  | "item_budget"
  | "char_budget"
  | "content_truncation"
  | "context_switch"
  | "context_switch_scope"
  | "context_switch_reauthorization"
  | "context_switch_freshness";

/**
 * J-011: first-class auditable exclusion record. Every filtered-out candidate,
 * every truncation, and every withheld prior-scope item produces one of these
 * with the stage that produced it and the audit instant, so minimization
 * (Constitution §19) is fully auditable after the fact.
 */
export interface ContextExclusionRecord {
  id: string;
  tenantRef: string;
  /** Null when the excluded material was never a candidate (e.g. a carry request naming an unknown prior item). */
  source: ContextCandidateSource | null;
  reason: ContextDropReason;
  stage: ContextExclusionStage;
  detail: string;
  /** Audit instant — the assembly config's `now`, never wall-clock sampled. */
  recordedAt: string;
  /** Set when the exclusion was permission-driven. */
  requiredPermission: string | null;
  /** Candidate freshness at exclusion time, when applicable. */
  freshnessAt: string | null;
  /** Characters withheld by truncation (minimization audit), when applicable. */
  withheldChars?: number;
}

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

/** A scope a request declares for the package (upper bound, enforced where checkable). */
export interface ContextScopeDeclaration {
  domains: readonly string[];
  maxSensitivity: ContextSensitivity;
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
  /**
   * J-011: declared memory scope of the package (which memory domains the
   * session/agent may draw on). Echoed onto the package when present.
   */
  memoryScope?: ContextScopeDeclaration;
  /**
   * J-011: declared data scope. Candidates whose sensitivity exceeds the
   * declared ceiling are excluded and recorded — data minimization is
   * enforced, not just described.
   */
  dataScope?: ContextScopeDeclaration;
  /** J-011: declared risk level; overrides the derived risk assessment. */
  riskLevel?: ContextRiskLevel;
  /** J-011: caller-supplied trace id; derived deterministically when absent. */
  traceId?: string;
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
 * Package scope, risk + sufficiency vocabulary (J-011 / G-011)
 * ────────────────────────────────────────────────────────────*/

/** Comparison rank order for sensitivity classifications. */
export type ContextSensitivityRank = Record<ContextSensitivity, 0 | 1 | 2>;

export type ContextRiskLevel = "low" | "medium" | "high" | "critical";

/**
 * A scope the package draws on. When the request declares a scope it is echoed
 * verbatim (origin "declared"); otherwise the effective scope is derived from
 * what actually survived assembly (origin "derived").
 */
export interface ContextScopeRecord {
  domains: readonly string[];
  maxSensitivity: ContextSensitivity;
  origin: "declared" | "derived";
}

/** Stated risk of the package: declared by the request, or derived from surviving content. */
export interface ContextRiskAssessment {
  level: ContextRiskLevel;
  origin: "declared" | "derived";
}

/**
 * J-011 / E-031 (CP-05): every package states whether what survived is
 * sufficient for the declared purpose. Uncertainty about withheld material
 * must be recorded on the package itself.
 */
export type SufficiencyVerdict = "sufficient" | "insufficient";

export type SufficiencyReason =
  | "purpose_relevant_items_present"
  | "purpose_not_parseable"
  | "no_items_survived"
  | "no_purpose_match"
  | "purpose_relevant_candidate_excluded"
  | "purpose_relevant_item_truncated";

export interface SufficiencyAssessment {
  verdict: SufficiencyVerdict;
  reason: SufficiencyReason;
  detail: string;
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

/**
 * J-012: material from a prior scope explicitly carried into a new scope. A
 * carried item exists here ONLY after passing the switch gates (declared-scope
 * ceiling, freshness, re-authorization against the NEW actor permission set,
 * budget). Carried content keeps its original trust wrapper — carrying never
 * re-classifies untrusted content into trusted. Provenance fields (origin
 * tenant, source, freshness, trace) make every hop auditable and let the field
 * be explicitly re-carried across further hops.
 */
export interface CarriedContextItem {
  /** Identifier of the prior-scope item this was carried from. */
  name: string;
  /** Origin tenant of the material (provenance — may differ from the new scope). */
  tenantRef: string;
  /** Origin source kind of the material. */
  source: ContextCandidateSource;
  sensitivity: ContextSensitivity;
  /** Origin freshness instant; re-gated at every further hop. */
  freshnessAt: string;
  content: AssembledContent;
  /** Permission re-checked against the new-scope actor; null means ungated. */
  requiredPermission: string | null;
  /** Trace id of the prior package — provenance across the switch (§12). */
  carriedFromTraceId: string | null;
}

/** J-012: explicit request to carry one prior-scope item into the new scope. */
export interface ContextCarryOverRequest {
  /** Id of an item present in the prior package's `items`. */
  priorItemId: string;
  /** Permission the NEW-scope actor must hold for the field to cross the boundary. */
  requiredPermission: string | null;
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
      /**
       * J-011: package scope statement. Every assembled package declares the
       * memory and data scopes it draws on, its risk level, and its trace id.
       */
      memoryScope: ContextScopeRecord;
      dataScope: ContextScopeRecord;
      riskLevel: ContextRiskAssessment;
      traceId: string;
      /**
       * J-011: first-class exclusion ledger. Every filtered candidate, every
       * truncation, and every withheld prior-scope item is recorded here with
       * its stage, reason and audit instant. `dropped` above is the legacy
       * candidate-level view of the same ledger.
       */
      exclusions: ContextExclusionRecord[];
      /** J-012: prior-scope material explicitly carried in (empty on plain assembly). */
      carried: CarriedContextItem[];
      /** J-011: whether what survived is sufficient for the declared purpose. */
      sufficiency: SufficiencyAssessment;
    }
  | { kind: "rejected"; reason: string };

/* ─────────────────────────────────────────────────────────────
 * Context switch (J-012 / G-070 — one user, many realities)
 * ────────────────────────────────────────────────────────────*/

/**
 * J-012: a mid-session scope switch (workspace/org/tenant). The new package is
 * assembled fresh from the new scope's request; NOTHING from the prior package
 * enters it except fields explicitly requested via `carryOver` that pass the
 * switch gates. Zero-bleed is structural, not conventional.
 */
export interface ContextSwitchRequest {
  /** Fresh, fully re-resolved server-side request for the NEW scope. */
  request: ContextRequest;
  /** Fresh candidates belonging to the NEW scope (assembled into `items`). */
  candidates?: readonly ContextCandidate[];
  /** The prior package produced for the outgoing scope. */
  prior: ContextEnvelope;
  /** Prior-scope fields explicitly requested to cross the boundary. */
  carryOver?: readonly ContextCarryOverRequest[];
}

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
 * Scope, risk, trace + sufficiency resolution (J-011, pure)
 * ────────────────────────────────────────────────────────────*/

const SENSITIVITY_RANK: ContextSensitivityRank = {
  public: 0,
  internal: 1,
  restricted: 2,
};

const RISK_LADDER: readonly ContextRiskLevel[] = ["low", "medium", "high", "critical"];

function resolveMemoryScope(request: ContextRequest): ContextScopeRecord {
  if (request.memoryScope) {
    return {
      domains: [...request.memoryScope.domains],
      maxSensitivity: request.memoryScope.maxSensitivity,
      origin: "declared",
    };
  }
  // This assembler draws on no persistent memory: an undeclared memory scope
  // is an explicitly empty derived scope, not an implicit wildcard.
  return { domains: [], maxSensitivity: "public", origin: "derived" };
}

function resolveDataScope(
  request: ContextRequest,
  items: readonly AssembledContextItem[],
): ContextScopeRecord {
  if (request.dataScope) {
    return {
      domains: [...request.dataScope.domains],
      maxSensitivity: request.dataScope.maxSensitivity,
      origin: "declared",
    };
  }
  const domains = [...new Set(items.map((item) => item.source))].sort();
  let max: ContextSensitivity = "public";
  for (const item of items) {
    if (SENSITIVITY_RANK[item.sensitivity] > SENSITIVITY_RANK[max]) max = item.sensitivity;
  }
  return { domains, maxSensitivity: max, origin: "derived" };
}

/**
 * Derived risk ladder: base level from the highest surviving sensitivity
 * (public→low, internal→medium, restricted→high), escalated one step when the
 * package contains untrusted content (prompt-injection surface). `critical`
 * is otherwise reserved for declared risk.
 */
function deriveRisk(
  entries: ReadonlyArray<{ sensitivity: ContextSensitivity; untrusted: boolean }>,
): ContextRiskLevel {
  let index = 0;
  for (const entry of entries) {
    index = Math.max(index, SENSITIVITY_RANK[entry.sensitivity]);
  }
  if (entries.some((entry) => entry.untrusted)) {
    index = Math.min(index + 1, RISK_LADDER.length - 1);
  }
  return RISK_LADDER[index];
}

/** FNV-1a 32-bit — deterministic, short, no crypto sampling (purity law). */
function fnv1a32Hex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function resolveTraceId(request: ContextRequest, now: string): string {
  if (request.traceId) return request.traceId;
  const key = [
    request.tenantRef,
    request.actorRef.userId,
    request.purpose,
    request.missionRef ?? "",
    now,
  ].join("|");
  return `ctx-trace-${fnv1a32Hex(key)}`;
}

/**
 * Sufficiency assessment (J-011 / E-031): deterministic verdict on whether
 * the surviving package can serve the declared purpose. Insufficient verdicts
 * name the uncertainty — withheld purpose-relevant material, absent matches,
 * or an unparseable purpose — so downstream consumers never mistake an empty
 * or minimized package for a complete one.
 */
function assessSufficiency(args: {
  purposeTokens: string[];
  survivorCount: number;
  survivingMatches: number;
  relevantExclusions: readonly ContextExclusionRecord[];
  truncatedMatchIds: readonly string[];
}): SufficiencyAssessment {
  if (args.purposeTokens.length === 0) {
    return {
      verdict: "insufficient",
      reason: "purpose_not_parseable",
      detail:
        "The declared purpose produced no reusable tokens; sufficiency cannot be established",
    };
  }
  if (args.survivorCount === 0) {
    return {
      verdict: "insufficient",
      reason: "no_items_survived",
      detail:
        "No candidate survived assembly filtering, so nothing can satisfy the declared purpose",
    };
  }
  if (args.relevantExclusions.length > 0) {
    const first = args.relevantExclusions[0];
    return {
      verdict: "insufficient",
      reason: "purpose_relevant_candidate_excluded",
      detail: `Purpose-relevant candidate "${first.id}" was excluded (${first.reason}: ${first.detail}); the surviving package is incomplete`,
    };
  }
  if (args.survivingMatches === 0) {
    return {
      verdict: "insufficient",
      reason: "no_purpose_match",
      detail: "Surviving items do not match the declared purpose",
    };
  }
  if (args.truncatedMatchIds.length > 0) {
    return {
      verdict: "insufficient",
      reason: "purpose_relevant_item_truncated",
      detail: `Purpose-relevant item "${args.truncatedMatchIds[0]}" was truncated to fit the character budget`,
    };
  }
  return {
    verdict: "sufficient",
    reason: "purpose_relevant_items_present",
    detail: `${args.survivingMatches} surviving item(s) match the declared purpose and no purpose-relevant material was withheld`,
  };
}

function exclusionHasSource(
  record: ContextExclusionRecord,
): record is ContextExclusionRecord & { source: ContextCandidateSource } {
  return record.source !== null;
}

/* ─────────────────────────────────────────────────────────────
 * assembleContext — pure pipeline
 * ────────────────────────────────────────────────────────────*/

/**
 * Assemble governed context for a request. Filters (permission, tenant, source
 * scope, declared sensitivity scope, freshness), ranks by relevance, enforces
 * budget, and wraps untrusted content in an explicit marker. Grants nothing:
 * the actor's permission set is read-only input and every exclusion is recorded
 * as a first-class auditable record (J-011).
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

  const exclusions: ContextExclusionRecord[] = [];
  const recordExclusion = (
    record: Omit<ContextExclusionRecord, "recordedAt">,
  ): ContextExclusionRecord => {
    const complete: ContextExclusionRecord = { ...record, recordedAt: config.now };
    exclusions.push(complete);
    return complete;
  };

  const admitted: Array<{
    candidate: ContextCandidate;
    purposeMatch: boolean;
    sourcePriority: number;
  }> = [];
  /** Purpose-relevant candidates excluded after passing the tenant+source gates. */
  const relevantExclusions: ContextExclusionRecord[] = [];
  const truncatedMatchIds: string[] = [];

  for (const candidate of candidates) {
    const candidateMatch = matchesPurpose(candidate, purpose);

    // Tenant boundary (Constitution §13): a candidate from another tenant is
    // never eligible, regardless of permissions or source priority.
    if (candidate.tenantRef !== request.tenantRef) {
      recordExclusion({
        id: candidate.id,
        tenantRef: candidate.tenantRef,
        source: candidate.source,
        reason: "tenant_mismatch",
        stage: "tenant_boundary",
        detail: `Candidate tenant "${candidate.tenantRef}" does not match request tenant "${request.tenantRef}"`,
        requiredPermission: null,
        freshnessAt: candidate.freshnessAt,
      });
      continue;
    }

    // Declared source scope: the request names the sources it may draw from.
    if (
      request.candidateSources.length > 0 &&
      !request.candidateSources.includes(candidate.source)
    ) {
      recordExclusion({
        id: candidate.id,
        tenantRef: candidate.tenantRef,
        source: candidate.source,
        reason: "source_not_requested",
        stage: "source_scope",
        detail: `Source "${candidate.source}" is not in the request's declared candidate sources`,
        requiredPermission: null,
        freshnessAt: candidate.freshnessAt,
      });
      continue;
    }

    // From here on the candidate is eligible material: purpose-relevance of
    // any exclusion below must be recorded as package uncertainty (E-031).
    const markRelevant = (record: ContextExclusionRecord): ContextExclusionRecord => {
      if (candidateMatch) relevantExclusions.push(record);
      return record;
    };

    // Declared data-scope ceiling (J-011 minimization): sensitivity above the
    // declared ceiling is excluded, not silently included.
    const declaredMax = request.dataScope?.maxSensitivity ?? null;
    if (
      declaredMax !== null &&
      SENSITIVITY_RANK[candidate.sensitivity] > SENSITIVITY_RANK[declaredMax]
    ) {
      markRelevant(
        recordExclusion({
          id: candidate.id,
          tenantRef: candidate.tenantRef,
          source: candidate.source,
          reason: "exceeds_declared_scope",
          stage: "sensitivity_scope",
          detail: `Candidate sensitivity "${candidate.sensitivity}" exceeds the declared data-scope ceiling "${declaredMax}"`,
          requiredPermission: null,
          freshnessAt: candidate.freshnessAt,
        }),
      );
      continue;
    }

    // Permission gate: context NEVER elevates. Missing permission → dropped.
    if (candidate.requiredPermission !== null) {
      if (!request.actorRef.permissions.includes(candidate.requiredPermission)) {
        markRelevant(
          recordExclusion({
            id: candidate.id,
            tenantRef: candidate.tenantRef,
            source: candidate.source,
            reason: "permission_denied",
            stage: "permission_gate",
            detail: `Actor "${request.actorRef.userId}" lacks required permission "${candidate.requiredPermission}"`,
            requiredPermission: candidate.requiredPermission,
            freshnessAt: candidate.freshnessAt,
          }),
        );
        continue;
      }
    }

    // Freshness gate (Section 34): stale candidates are dropped, not aged quietly.
    const freshMs = Date.parse(candidate.freshnessAt);
    if (Number.isNaN(freshMs) || nowMs - freshMs > config.maxAgeSeconds * 1000) {
      markRelevant(
        recordExclusion({
          id: candidate.id,
          tenantRef: candidate.tenantRef,
          source: candidate.source,
          reason: "stale",
          stage: "freshness_gate",
          detail: Number.isNaN(freshMs)
            ? "Candidate freshness timestamp is not a valid ISO-8601 timestamp"
            : `Candidate age exceeds maxAgeSeconds=${config.maxAgeSeconds}`,
          requiredPermission: null,
          freshnessAt: candidate.freshnessAt,
        }),
      );
      continue;
    }

    admitted.push({
      candidate,
      purposeMatch: candidateMatch,
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
      const record = recordExclusion({
        id: candidate.id,
        tenantRef: candidate.tenantRef,
        source: candidate.source,
        reason: "budget",
        stage: "item_budget",
        detail: `Item count budget exhausted (maxItems=${request.budget.maxItems})`,
        requiredPermission: null,
        freshnessAt: candidate.freshnessAt,
      });
      if (purposeMatch) relevantExclusions.push(record);
      continue;
    }
    if (remainingChars <= 0) {
      const record = recordExclusion({
        id: candidate.id,
        tenantRef: candidate.tenantRef,
        source: candidate.source,
        reason: "budget",
        stage: "char_budget",
        detail: `Character budget exhausted (maxChars=${request.budget.maxChars})`,
        requiredPermission: null,
        freshnessAt: candidate.freshnessAt,
      });
      if (purposeMatch) relevantExclusions.push(record);
      continue;
    }

    let content = candidate.content;
    if (content.length > remainingChars) {
      const withheldChars = content.length - remainingChars;
      content = contextPayload(content.slice(0, remainingChars));
      truncatedItemIds.push(candidate.id);
      if (purposeMatch) truncatedMatchIds.push(candidate.id);
      recordExclusion({
        id: candidate.id,
        tenantRef: candidate.tenantRef,
        source: candidate.source,
        reason: "budget",
        stage: "content_truncation",
        detail: `Candidate content truncated; ${withheldChars} character(s) withheld to fit maxChars=${request.budget.maxChars}`,
        requiredPermission: null,
        freshnessAt: candidate.freshnessAt,
        withheldChars,
      });
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

  const riskEntries = items.map((item) => ({
    sensitivity: item.sensitivity,
    untrusted: item.content.kind === "untrusted",
  }));
  const riskLevel: ContextRiskAssessment = request.riskLevel
    ? { level: request.riskLevel, origin: "declared" }
    : { level: deriveRisk(riskEntries), origin: "derived" };

  const sufficiency = assessSufficiency({
    purposeTokens: purpose,
    survivorCount: items.length,
    survivingMatches: items.filter((item) => item.purposeMatch).length,
    relevantExclusions,
    truncatedMatchIds,
  });

  return {
    kind: "assembled",
    items,
    dropped: exclusions.filter(exclusionHasSource),
    truncated: truncatedItemIds.length > 0 || exclusions.some((e) => e.reason === "budget"),
    truncatedItemIds,
    totalChars: items.reduce((sum, item) => sum + item.content.content.length, 0),
    memoryScope: resolveMemoryScope(request),
    dataScope: resolveDataScope(request, items),
    riskLevel,
    traceId: resolveTraceId(request, config.now),
    exclusions,
    carried: [],
    sufficiency,
  };
}

/* ─────────────────────────────────────────────────────────────
 * switchContextScope — zero-bleed scope switch (J-012 / G-070)
 * ────────────────────────────────────────────────────────────*/

/**
 * Switch the active context to a new scope (workspace/org/tenant) without
 * identity switching (G-070). The result is a fresh package for the NEW scope;
 * zero-bleed is structural:
 *
 * - Prior items are NEVER copied into `items`. Every prior item not explicitly
 *   requested for carry is recorded as a `not_carried` exclusion.
 * - A prior item enters the new package only via `carryOver` AND only after
 *   passing, in order: the declared data-scope ceiling of the NEW request, the
 *   freshness gate at the NEW assembly instant, re-authorization of the carry
 *   permission against the NEW actor's freshly resolved permission set, and
 *   the NEW budget. Every failed gate is recorded as an exclusion.
 * - Carried content keeps its original trust wrapper (never re-classified).
 * - Scope fields (memoryScope/dataScope), risk and sufficiency are computed
 *   from the NEW request and NEW survivors only — prior scope declarations do
 *   not carry over.
 */
export function switchContextScope(
  switchRequest: ContextSwitchRequest,
  config: ContextAssemblyConfig,
): ContextEnvelope {
  const request = switchRequest.request;
  const base = assembleContext(request, switchRequest.candidates ?? [], config);
  if (base.kind === "rejected") return base;

  const nowMs = Date.parse(config.now);
  if (Number.isNaN(nowMs)) {
    return { kind: "rejected", reason: "Config `now` is not a valid ISO-8601 timestamp" };
  }

  const exclusions: ContextExclusionRecord[] = [...base.exclusions];
  const carried: CarriedContextItem[] = [];
  const carryOver = switchRequest.carryOver ?? [];
  const requestedIds = new Set(carryOver.map((entry) => entry.priorItemId));

  /** Normalized view of prior material eligible for explicit carry. */
  interface PriorMaterial {
    id: string;
    tenantRef: string;
    source: ContextCandidateSource;
    sensitivity: ContextSensitivity;
    freshnessAt: string;
    content: AssembledContent;
  }
  const priorMaterial: PriorMaterial[] = [];
  if (switchRequest.prior.kind === "assembled") {
    for (const item of switchRequest.prior.items) {
      priorMaterial.push({
        id: item.id,
        tenantRef: item.tenantRef,
        source: item.source,
        sensitivity: item.sensitivity,
        freshnessAt: item.freshnessAt,
        content: item.content,
      });
    }
    for (const carriedItem of switchRequest.prior.carried) {
      priorMaterial.push({
        id: carriedItem.name,
        tenantRef: carriedItem.tenantRef,
        source: carriedItem.source,
        sensitivity: carriedItem.sensitivity,
        freshnessAt: carriedItem.freshnessAt,
        content: carriedItem.content,
      });
    }
  }
  const priorTraceId =
    switchRequest.prior.kind === "assembled" ? switchRequest.prior.traceId : null;

  // Zero-bleed sweep: prior-scope material never crosses unless explicitly requested.
  const sweptIds = new Set<string>();
  for (const material of priorMaterial) {
    if (requestedIds.has(material.id) || sweptIds.has(material.id)) continue;
    sweptIds.add(material.id);
    exclusions.push({
      id: material.id,
      tenantRef: material.tenantRef,
      source: material.source,
      reason: "not_carried",
      stage: "context_switch",
      detail: `Prior-scope item "${material.id}" (tenant "${material.tenantRef}") was not explicitly carried; prior-scope context never bleeds by default`,
      recordedAt: config.now,
      requiredPermission: null,
      freshnessAt: material.freshnessAt,
    });
  }

  let remainingItems = request.budget.maxItems - base.items.length;
  let remainingChars = request.budget.maxChars - base.totalChars;
  let carriedTruncated = false;
  const carriedIds = new Set<string>();
  const declaredMax = request.dataScope?.maxSensitivity ?? null;

  for (const carry of carryOver) {
    const priorItem = priorMaterial.find((material) => material.id === carry.priorItemId);

    // Unknown source or duplicate request: nothing is fabricated across the boundary.
    if (priorItem === undefined || carriedIds.has(carry.priorItemId)) {
      exclusions.push({
        id: carry.priorItemId,
        tenantRef: request.tenantRef,
        source: priorItem?.source ?? null,
        reason: "not_carried",
        stage: "context_switch",
        detail:
          priorItem === undefined
            ? "Carry request references an item that does not exist in the prior package"
            : "Duplicate carry request for a prior item that was already carried",
        recordedAt: config.now,
        requiredPermission: null,
        freshnessAt: priorItem?.freshnessAt ?? null,
      });
      continue;
    }

    // Declared data-scope ceiling of the NEW scope applies to carried material.
    if (
      declaredMax !== null &&
      SENSITIVITY_RANK[priorItem.sensitivity] > SENSITIVITY_RANK[declaredMax]
    ) {
      exclusions.push({
        id: priorItem.id,
        tenantRef: priorItem.tenantRef,
        source: priorItem.source,
        reason: "exceeds_declared_scope",
        stage: "context_switch_scope",
        detail: `Carried field sensitivity "${priorItem.sensitivity}" exceeds the new scope ceiling "${declaredMax}"`,
        recordedAt: config.now,
        requiredPermission: null,
        freshnessAt: priorItem.freshnessAt,
      });
      continue;
    }

    // Freshness gate at the NEW assembly instant: stale fields do not cross.
    const freshMs = Date.parse(priorItem.freshnessAt);
    if (Number.isNaN(freshMs) || nowMs - freshMs > config.maxAgeSeconds * 1000) {
      exclusions.push({
        id: priorItem.id,
        tenantRef: priorItem.tenantRef,
        source: priorItem.source,
        reason: "stale",
        stage: "context_switch_freshness",
        detail: `Carried field age exceeds maxAgeSeconds=${config.maxAgeSeconds} at the new scope instant`,
        recordedAt: config.now,
        requiredPermission: null,
        freshnessAt: priorItem.freshnessAt,
      });
      continue;
    }

    // Re-authorization: the NEW actor's freshly resolved permission set decides,
    // regardless of what the prior scope's actor was allowed to see.
    if (
      carry.requiredPermission !== null &&
      !request.actorRef.permissions.includes(carry.requiredPermission)
    ) {
      exclusions.push({
        id: priorItem.id,
        tenantRef: priorItem.tenantRef,
        source: priorItem.source,
        reason: "permission_denied",
        stage: "context_switch_reauthorization",
        detail: `Carried field requires permission "${carry.requiredPermission}" which the new-scope actor "${request.actorRef.userId}" does not hold`,
        recordedAt: config.now,
        requiredPermission: carry.requiredPermission,
        freshnessAt: priorItem.freshnessAt,
      });
      continue;
    }

    // Budget gates against the NEW request's budget, after fresh items.
    if (remainingItems <= 0) {
      exclusions.push({
        id: priorItem.id,
        tenantRef: priorItem.tenantRef,
        source: priorItem.source,
        reason: "budget",
        stage: "item_budget",
        detail: `Item count budget exhausted for carried fields (maxItems=${request.budget.maxItems})`,
        recordedAt: config.now,
        requiredPermission: null,
        freshnessAt: priorItem.freshnessAt,
      });
      continue;
    }
    if (remainingChars <= 0) {
      exclusions.push({
        id: priorItem.id,
        tenantRef: priorItem.tenantRef,
        source: priorItem.source,
        reason: "budget",
        stage: "char_budget",
        detail: `Character budget exhausted for carried fields (maxChars=${request.budget.maxChars})`,
        recordedAt: config.now,
        requiredPermission: null,
        freshnessAt: priorItem.freshnessAt,
      });
      continue;
    }

    let content = priorItem.content;
    if (content.content.length > remainingChars) {
      const withheldChars = content.content.length - remainingChars;
      content =
        content.kind === "untrusted"
          ? {
              kind: "untrusted",
              reason: content.reason,
              content: contextPayload(content.content.slice(0, remainingChars)),
            }
          : { kind: "trusted", content: contextPayload(content.content.slice(0, remainingChars)) };
      exclusions.push({
        id: priorItem.id,
        tenantRef: priorItem.tenantRef,
        source: priorItem.source,
        reason: "budget",
        stage: "content_truncation",
        detail: `Carried field truncated; ${withheldChars} character(s) withheld to fit maxChars=${request.budget.maxChars}`,
        recordedAt: config.now,
        requiredPermission: null,
        freshnessAt: priorItem.freshnessAt,
        withheldChars,
      });
      carriedTruncated = true;
    }
    remainingItems -= 1;
    remainingChars -= content.content.length;
    carriedIds.add(priorItem.id);
    carried.push({
      name: priorItem.id,
      tenantRef: priorItem.tenantRef,
      source: priorItem.source,
      sensitivity: priorItem.sensitivity,
      freshnessAt: priorItem.freshnessAt,
      content,
      requiredPermission: carry.requiredPermission,
      carriedFromTraceId: priorTraceId,
    });
  }

  // Risk covers fresh items AND carried material; scope fields and sufficiency
  // are computed from the NEW request and NEW survivors only.
  const riskEntries = [
    ...base.items.map((item) => ({
      sensitivity: item.sensitivity,
      untrusted: item.content.kind === "untrusted",
    })),
    ...carried.map((item) => ({
      sensitivity: item.sensitivity,
      untrusted: item.content.kind === "untrusted",
    })),
  ];

  return {
    kind: "assembled",
    items: base.items,
    dropped: exclusions.filter(exclusionHasSource),
    truncated: base.truncated || carriedTruncated,
    truncatedItemIds: base.truncatedItemIds,
    totalChars:
      base.totalChars + carried.reduce((sum, item) => sum + item.content.content.length, 0),
    memoryScope: base.memoryScope,
    dataScope: base.dataScope,
    riskLevel: request.riskLevel
      ? { level: request.riskLevel, origin: "declared" }
      : { level: deriveRisk(riskEntries), origin: "derived" },
    traceId: base.traceId,
    exclusions,
    carried,
    sufficiency: base.sufficiency,
  };
}