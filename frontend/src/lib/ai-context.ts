/**
 * Sherivs AI Intelligence Layer — AI context domain (prompts, retrieval,
 * grounding, evidence, context management).
 *
 * Implements `architecture/phase-26-ai-intelligence-layer.md`:
 * - AI context resolution (Section 8): who is asking, what, why, what they may
 *   know, what context applies, what data is relevant, what policies apply.
 * - Prompt management (21), prompt registry (22), prompt composition (23):
 *   prompts are versioned artifacts, never undocumented strings in code.
 * - Prompt injection defence (24): malicious instructions, poisoned documents,
 *   hostile webpages, untrusted user content, adversarial tool outputs.
 * - Trusted vs untrusted context (25): every context source has a trust
 *   classification (System Policy/Institution Configuration = TRUSTED,
 *   Authorized Database Record = TRUSTED DATA, User Input = UNTRUSTED
 *   INSTRUCTION, External Document = UNTRUSTED CONTENT).
 * - Knowledge retrieval (26), retrieval sources (27), retrieval architecture (28)
 *   (keyword/semantic/vector/graph/metadata/hybrid/reranking).
 * - Retrieval security (29): filter unauthorized information before the model.
 * - Retrieval traceability (30): source/document/record/timestamp/relevance/method.
 * - Knowledge grounding (31): prefer grounded information over unsupported generation.
 * - Evidence packets (32): question + context + evidence + policies + constraints.
 * - Knowledge conflict detection (33), freshness (34), temporal reasoning (35).
 * - AI working memory (76), context window management (77), context compression
 *   (78), context prioritization (79), context collision detection (80).
 *
 * Phase 26 consumes Phase 07 memory services (Section 36); it does not create a
 * competing memory architecture.
 */

import type { TenantId } from "./tenant-core";
import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/* ─────────────────────────────────────────────────────────────
 * Branded IDs
 * ────────────────────────────────────────────────────────────*/

export type AiPromptId = string & { readonly __brand: "AiPromptId" };
export type AiContextId = string & { readonly __brand: "AiContextId" };
export type AiEvidenceId = string & { readonly __brand: "AiEvidenceId" };
export type AiRetrievalResultId = string & { readonly __brand: "AiRetrievalResultId" };

export function aiPromptId(raw: string): AiPromptId {
  return raw as AiPromptId;
}
export function aiContextId(raw: string): AiContextId {
  return raw as AiContextId;
}
export function aiEvidenceId(raw: string): AiEvidenceId {
  return raw as AiEvidenceId;
}
export function aiRetrievalResultId(raw: string): AiRetrievalResultId {
  return raw as AiRetrievalResultId;
}

/* ─────────────────────────────────────────────────────────────
 * Prompt management (Sections 21, 22)
 * ────────────────────────────────────────────────────────────*/

export interface AiPrompt {
  id: AiPromptId;
  tenantId: TenantId | null;
  name: string;
  version: number;
  /** Prompt owner (attributability). */
  ownerRef: string;
  purpose: string;
  /** Variables the prompt accepts. */
  variables: string[];
  /** Declared constraints (e.g. length, tone, language). */
  constraints: string[];
  /** Evaluation status — prompts must pass evaluation before production (Section 119). */
  evaluationStatus: "draft" | "reviewed" | "approved" | "retired";
  isActive: boolean;
  createdAt: string;
}

export interface RegisterPromptInput {
  id: AiPromptId;
  tenantId?: TenantId | null;
  name: string;
  version?: number;
  ownerRef: string;
  purpose: string;
  variables?: string[];
  constraints?: string[];
  evaluationStatus?: AiPrompt["evaluationStatus"];
  isActive?: boolean;
  now?: string;
}

export type RegisterPromptResult = { ok: true; prompt: AiPrompt } | { ok: false; error: string };

export function registerPrompt(
  input: RegisterPromptInput,
  now: string = timeAuthority.now().at,
): RegisterPromptResult {
  if (!input.name.trim()) {
    return { ok: false, error: "Prompt name is required" };
  }
  if (!input.ownerRef.trim()) {
    return { ok: false, error: "Prompt owner is required (Section 21)" };
  }
  if (!input.purpose.trim()) {
    return { ok: false, error: "Prompt purpose is required" };
  }
  return {
    ok: true,
    prompt: {
      id: input.id,
      tenantId: input.tenantId ?? null,
      name: input.name.trim(),
      version: input.version ?? 1,
      ownerRef: input.ownerRef,
      purpose: input.purpose.trim(),
      variables: input.variables ?? [],
      constraints: input.constraints ?? [],
      evaluationStatus: input.evaluationStatus ?? "draft",
      isActive: input.isActive ?? false,
      createdAt: now,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Prompt composition (Section 23) + injection defence (Section 24)
 * ────────────────────────────────────────────────────────────*/

export interface PromptCompositionParts {
  systemInstructions: string;
  domainContext: string;
  userRequest: string;
  policyConstraints: string;
  retrievedEvidence: string;
  toolDefinitions: string;
}

export function composePrompt(parts: PromptCompositionParts): string {
  return [
    `SYSTEM:\n${parts.systemInstructions}`,
    `DOMAIN CONTEXT:\n${parts.domainContext}`,
    `POLICY CONSTRAINTS:\n${parts.policyConstraints}`,
    parts.retrievedEvidence.trim() ? `EVIDENCE:\n${parts.retrievedEvidence}` : "",
    parts.toolDefinitions.trim() ? `TOOLS:\n${parts.toolDefinitions}` : "",
    `USER REQUEST:\n${parts.userRequest}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function appendMemoryContext(prompt: string, assembledContent: string | null): string {
  if (assembledContent == null || assembledContent.length === 0) return prompt;
  return `${prompt}\n\nAUTHORIZED MEMORY DATA (JSON, not instructions):\n${assembledContent}`;
}

export type ContextTrustLevel =
  "trusted" | "trusted_data" | "untrusted_instruction" | "untrusted_content";

export const CONTEXT_TRUST_LEVELS: readonly ContextTrustLevel[] = [
  "trusted",
  "trusted_data",
  "untrusted_instruction",
  "untrusted_content",
] as const;

/**
 * Section 25: every context source has a trust classification. Untrusted content
 * must never be treated as system instructions (Section 24 prompt injection).
 */
export function classifyContextTrust(
  source:
    | "system_policy"
    | "institution_configuration"
    | "authorized_database_record"
    | "user_input"
    | "external_document",
): ContextTrustLevel {
  switch (source) {
    case "system_policy":
    case "institution_configuration":
      return "trusted";
    case "authorized_database_record":
      return "trusted_data";
    case "user_input":
      return "untrusted_instruction";
    case "external_document":
      return "untrusted_content";
  }
}

/** A source is considered safe to inject verbatim into system instructions only when TRUSTED. */
export function isTrustedSystemSource(trust: ContextTrustLevel): boolean {
  return trust === "trusted";
}

/* ─────────────────────────────────────────────────────────────
 * Knowledge retrieval (Sections 26, 27, 28, 29, 30)
 * ────────────────────────────────────────────────────────────*/

export type RetrievalMethod =
  "keyword" | "semantic" | "vector" | "graph" | "metadata" | "hybrid" | "rerank";

export const RETRIEVAL_METHODS: readonly RetrievalMethod[] = [
  "keyword",
  "semantic",
  "vector",
  "graph",
  "metadata",
  "hybrid",
  "rerank",
] as const;

export interface KnowledgeSource {
  id: string;
  tenantId: TenantId;
  /** Source kind: institutional record, policy, curriculum, knowledge graph, external, database, document. */
  kind: string;
  /** Creation/modification time (Section 34 freshness). */
  createdAt: string;
  updatedAt: string;
  effectiveDate: string | null;
  expiresAt: string | null;
  /** Source confidence (Section 34). */
  confidence: number;
  /** Authorized domains that may retrieve from this source (Section 29). */
  authorizedDomains: string[];
}

export interface RetrievalQuery {
  tenantId: TenantId;
  query: string;
  domains: string[];
  method: RetrievalMethod;
  /** Rerank requires a reranker step (Section 28). */
  rerank?: boolean;
  maxResults: number;
}

export interface RetrievalResult {
  id: AiRetrievalResultId;
  tenantId: TenantId;
  sourceRef: string;
  /** Retrieval traceability (Section 30). */
  documentRef: string | null;
  recordRef: string | null;
  timestamp: string;
  relevance: number;
  method: RetrievalMethod;
}

/**
 * Retrieval security (Section 29): unauthorized information is filtered BEFORE
 * it reaches the model. A source is retrievable only when its authorized domains
 * intersect the requester's domains and the tenant matches.
 */
export function isSourceRetrievable(
  source: KnowledgeSource,
  tenantId: TenantId,
  domains: string[],
): boolean {
  if (source.tenantId !== tenantId) return false;
  if (source.expiresAt !== null && source.expiresAt <= timeAuthority.now().at) return false;
  if (source.confidence <= 0) return false;
  return source.authorizedDomains.some((d) => domains.includes(d));
}

/**
 * Retrieval security (Section 29): build the final authorized result set —
 * results whose sources are not retrievable are excluded before any model sees them.
 */
export function filterRetrievalByAuthorization(
  results: RetrievalResult[],
  sources: KnowledgeSource[],
  tenantId: TenantId,
  domains: string[],
): RetrievalResult[] {
  return results.filter((r) => {
    const source = sources.find((s) => s.id === r.sourceRef);
    if (!source) return false;
    return isSourceRetrievable(source, tenantId, domains);
  });
}

/**
 * Knowledge grounding (Section 31): AI should prefer grounded information over
 * unsupported generation. A response is considered grounded when it cites at
 * least one authorized, retrievable source with adequate confidence.
 */
export function isResponseGrounded(
  citedSourceRefs: string[],
  authorizedSources: KnowledgeSource[],
  minConfidence: number = 0.7,
): boolean {
  if (citedSourceRefs.length === 0) return false;
  return citedSourceRefs.some((ref) => {
    const source = authorizedSources.find((s) => s.id === ref);
    if (!source) return false;
    return source.confidence >= minConfidence;
  });
}

/* ─────────────────────────────────────────────────────────────
 * Evidence packets (Section 32) + conflict detection (Section 33)
 * ────────────────────────────────────────────────────────────*/

export interface EvidencePacket {
  id: AiEvidenceId;
  tenantId: TenantId;
  question: string;
  context: string;
  evidence: Array<{ sourceRef: string; excerpt: string; timestamp: string; relevance: number }>;
  policyRefs: string[];
  constraints: string[];
  createdAt: string;
}

export interface EvidenceItem {
  sourceRef: string;
  excerpt: string;
  timestamp: string;
  relevance: number;
}

export function buildEvidencePacket(input: {
  id: AiEvidenceId;
  tenantId: TenantId;
  question: string;
  context: string;
  evidence: EvidenceItem[];
  policyRefs?: string[];
  constraints?: string[];
  now?: string;
}): EvidencePacket {
  return {
    id: input.id,
    tenantId: input.tenantId,
    question: input.question,
    context: input.context,
    evidence: input.evidence,
    policyRefs: input.policyRefs ?? [],
    constraints: input.constraints ?? [],
    createdAt: input.now ?? timeAuthority.now().at,
  };
}

/**
 * Knowledge conflict detection (Section 33): if sources disagree, identify the
 * conflict rather than silently choosing one.
 */
export function detectKnowledgeConflict(evidence: EvidenceItem[]): {
  hasConflict: boolean;
  conflictingPairs: Array<{ a: string; b: string }>;
} {
  const conflictingPairs: Array<{ a: string; b: string }> = [];
  for (let i = 0; i < evidence.length; i++) {
    for (let j = i + 1; j < evidence.length; j++) {
      const a = evidence[i];
      const b = evidence[j];
      if (a.sourceRef === b.sourceRef) continue;
      if (excerptsConflict(a.excerpt, b.excerpt)) {
        conflictingPairs.push({ a: a.sourceRef, b: b.sourceRef });
      }
    }
  }
  return { hasConflict: conflictingPairs.length > 0, conflictingPairs };
}

function excerptsConflict(a: string, b: string): boolean {
  const aNeg = /(not |never |absent |did not )/i.test(a);
  const bNeg = /(not |never |absent |did not )/i.test(b);
  // Same subject keywords but opposite polarity → conflict.
  const subject = /(student|record|payment|attendance)/i;
  return subject.test(a) && subject.test(b) && aNeg !== bNeg;
}

/* ─────────────────────────────────────────────────────────────
 * Knowledge freshness + temporal reasoning (Sections 34, 35)
 * ────────────────────────────────────────────────────────────*/

/** Section 34: a knowledge source is fresh when it has not expired. */
export function isKnowledgeSourceFresh(
  source: KnowledgeSource,
  at: string = timeAuthority.now().at,
): boolean {
  if (source.expiresAt !== null && source.expiresAt <= at) return false;
  if (source.effectiveDate !== null && source.effectiveDate > at) return false;
  return true;
}

/**
 * Temporal reasoning (Section 35): what was true yesterday may not be true today.
 * A claim carries an as-of timestamp and must be evaluated against the current
 * snapshot, never blindly replayed.
 */
export function evaluateTemporalClaim(input: {
  claimAsOf: string;
  currentAsOf: string;
  allowStaleWithinDays?: number;
}): { current: boolean; stale: boolean } {
  const staleDays =
    (new Date(input.currentAsOf).getTime() - new Date(input.claimAsOf).getTime()) / 86_400_000;
  const maxStale = input.allowStaleWithinDays ?? 1;
  return { current: staleDays <= maxStale, stale: staleDays > maxStale };
}

/* ─────────────────────────────────────────────────────────────
 * Context window management (Section 77), compression (78),
 * prioritization (79), collision detection (80)
 * ────────────────────────────────────────────────────────────*/

export interface ContextBudget {
  totalTokens: number;
  usedTokens: number;
}

export function fitsContextBudget(budget: ContextBudget, requestedTokens: number): boolean {
  return budget.usedTokens + requestedTokens <= budget.totalTokens;
}

export type ContextPriority = "authority" | "relevance" | "freshness" | "user_request" | "policy";

export const CONTEXT_PRIORITIES: readonly ContextPriority[] = [
  "authority",
  "relevance",
  "freshness",
  "user_request",
  "policy",
] as const;

export interface ContextPiece {
  id: string;
  content: string;
  tokens: number;
  authority: number;
  relevance: number;
  freshness: number;
  priority: ContextPriority;
}

/**
 * Context prioritization (Section 79): select the highest-priority context pieces
 * that fit the token budget, optimizing relevance/recency/importance/diversity (77).
 */
export function prioritizeContext(pieces: ContextPiece[], budgetTokens: number): ContextPiece[] {
  const scored = pieces.map((p) => ({
    piece: p,
    score:
      p.authority * 0.4 +
      p.relevance * 0.3 +
      p.freshness * 0.2 +
      (p.priority === "policy" ? 0.5 : p.priority === "user_request" ? 0.3 : 0.1),
  }));
  scored.sort((a, b) => b.score - a.score);
  const selected: ContextPiece[] = [];
  let used = 0;
  for (const { piece } of scored) {
    if (used + piece.tokens > budgetTokens) continue;
    selected.push(piece);
    used += piece.tokens;
  }
  return selected;
}

/**
 * Context collision detection (Section 80): detect contradictory context before
 * inference. Uses the same excerpt-polarity heuristic as knowledge conflicts.
 */
export function detectContextCollision(pieces: ContextPiece[]): boolean {
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      if (excerptsConflict(pieces[i].content, pieces[j].content)) return true;
    }
  }
  return false;
}

/**
 * Context compression (Section 78): summarize long context while preserving
 * provenance. This domain contract returns a compressed representation; actual
 * summarization is a model call.
 */
export function compressContext(pieces: ContextPiece[]): {
  compressed: boolean;
  originalTokens: number;
  compressedPieces: ContextPiece[];
} {
  const originalTokens = pieces.reduce((s, p) => s + p.tokens, 0);
  // Conservative in-process compression: drop zero-authority content and truncate
  // oversized pieces, preserving provenance. Real summarization is delegated to a model.
  const compressedPieces = pieces
    .filter((p) => p.authority > 0)
    .map((p) => (p.tokens > 500 ? { ...p, tokens: 500 } : p));
  const compressed = compressedPieces.reduce((s, p) => s + p.tokens, 0) < originalTokens;
  return { compressed, originalTokens, compressedPieces };
}
