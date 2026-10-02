import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/**
 * CoreGrid Localization Content — translation, terminology, content variant,
 * and localized content governance domain.
 *
 * Implements `architecture/phase-30-globalization.md`:
 * - Translation management (O): every user-facing string must flow through a
 *   managed translation pipeline; no hard-coded user-facing text.
 * - Translation keys (P): stable, namespace-scoped keys decoupled from the
 *   source language string.
 * - Translation versioning (Q): updated translations never silently replace
 *   reviewed/approved text without re-review.
 * - Translation quality (R): machine → ai → human → professional → reviewed
 *   → approved workflow.
 * - AI translation (S): AI output is untrusted by default; high-risk domains
 *   (legal, medical, finance, government) require human approval before use.
 * - Translation memory (T): reusable, domain-tagged segments.
 * - Terminology management (U) and governance (DN): changes are proposed and
 *   approved — never silently applied.
 * - Regional content (DB), content variants (DC), controlled fallback (DD),
 *   content versioning (DE), translation drift detection (DF).
 * - Global content governance (DO): governance levels constrain who may
 *   author canonical/regional/institutional/user variants.
 * - Localization feedback (DM).
 *
 * Phase 30 content governance is a workflow boundary, not an authorization
 * boundary: identity and permission checks remain in Phase 02 (AGENTS.md 30).
 */

/* ─────────────────────────────────────────────────────────────
 * Branded IDs
 * ────────────────────────────────────────────────────────────*/

export type TranslationKeyId = string & { readonly __brand: "TranslationKeyId" };
export type TranslationId = string & { readonly __brand: "TranslationId" };
export type TerminologyId = string & { readonly __brand: "TerminologyId" };
export type ContentVariantId = string & { readonly __brand: "ContentVariantId" };
export type LocalizationFeedbackId = string & { readonly __brand: "LocalizationFeedbackId" };

export function translationKeyId(raw: string): TranslationKeyId {
  return raw as TranslationKeyId;
}
export function translationId(raw: string): TranslationId {
  return raw as TranslationId;
}
export function terminologyId(raw: string): TerminologyId {
  return raw as TerminologyId;
}
export function contentVariantId(raw: string): ContentVariantId {
  return raw as ContentVariantId;
}
export function localizationFeedbackId(raw: string): LocalizationFeedbackId {
  return raw as LocalizationFeedbackId;
}

/* ─────────────────────────────────────────────────────────────
 * Translation keys (Section P)
 * ────────────────────────────────────────────────────────────*/

export function createTranslationKey(
  namespace: string,
  key: string,
): { ok: true; id: TranslationKeyId } | { ok: false; error: string } {
  if (!namespace.trim()) {
    return { ok: false, error: "Translation key namespace is required (Section P)" };
  }
  if (!key.trim()) {
    return { ok: false, error: "Translation key is required (Section P)" };
  }
  return { ok: true, id: `${namespace}.${key}` as TranslationKeyId };
}

export function parseTranslationKey(
  key: TranslationKeyId,
): { namespace: string; key: string } | null {
  const dot = key.indexOf(".");
  if (dot <= 0 || dot === key.length - 1) return null;
  return { namespace: key.slice(0, dot), key: key.slice(dot + 1) };
}

/* ─────────────────────────────────────────────────────────────
 * Translation model + versioning (Sections O, Q)
 * ────────────────────────────────────────────────────────────*/

export type TranslationQuality =
  "machine" | "ai" | "human" | "professional" | "reviewed" | "approved";

export const TRANSLATION_QUALITY_ORDER: readonly TranslationQuality[] = [
  "machine",
  "ai",
  "human",
  "professional",
  "reviewed",
  "approved",
] as const;

export const TRANSLATION_QUALITY_RANK: Record<TranslationQuality, number> = {
  machine: 0,
  ai: 1,
  human: 2,
  professional: 3,
  reviewed: 4,
  approved: 5,
};

export interface Translation {
  id: TranslationId;
  key: TranslationKeyId;
  locale: string;
  text: string;
  version: number;
  quality: TranslationQuality;
  requiresHumanApproval: boolean;
  approved: boolean;
  /** Source content version this translation targets (Section DF). */
  sourceVersion: string;
  createdAt: string;
}

export function createTranslation(input: {
  id: TranslationId;
  key: TranslationKeyId;
  locale: string;
  text: string;
  sourceVersion: string;
  now?: string;
}): { ok: true; translation: Translation } | { ok: false; error: string } {
  if (!input.id) return { ok: false, error: "Translation id is required (Section O)" };
  if (!input.locale.trim())
    return { ok: false, error: "Translation locale is required (Section O)" };
  if (!input.text.trim()) return { ok: false, error: "Translation text is required (Section O)" };
  if (!input.sourceVersion.trim()) {
    return { ok: false, error: "Translation source version is required (Section DF)" };
  }
  return {
    ok: true,
    translation: {
      id: input.id,
      key: input.key,
      locale: input.locale,
      text: input.text,
      version: 1,
      quality: "machine",
      requiresHumanApproval: false,
      approved: false,
      sourceVersion: input.sourceVersion,
      createdAt: input.now ?? timeAuthority.now().at,
    },
  };
}

// Section Q: a new version never inherits approval — re-review is required.
export function updateTranslation(
  existing: Translation,
  newText: string,
  now: string = timeAuthority.now().at,
): { ok: true; translation: Translation } | { ok: false; error: string } {
  if (!newText.trim()) {
    return { ok: false, error: "Updated translation text is required (Section Q)" };
  }
  return {
    ok: true,
    translation: {
      ...existing,
      text: newText,
      version: existing.version + 1,
      approved: false,
      createdAt: now,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * AI translation (S) + quality workflow (R)
 * ────────────────────────────────────────────────────────────*/

export type TranslationRiskDomain =
  "education" | "administrative" | "finance" | "government" | "legal" | "medical" | "technology";

// Section S: high-risk domains require human approval before deployment.
export const HIGH_RISK_TRANSLATION_DOMAINS: readonly TranslationRiskDomain[] = [
  "legal",
  "medical",
  "finance",
  "government",
] as const;

export function createAiTranslation(input: {
  id: TranslationId;
  key: TranslationKeyId;
  locale: string;
  text: string;
  sourceVersion: string;
  domain: TranslationRiskDomain;
  now?: string;
}): { ok: true; translation: Translation } | { ok: false; error: string } {
  if (!input.id) return { ok: false, error: "Translation id is required (Section S)" };
  if (!input.locale.trim())
    return { ok: false, error: "Translation locale is required (Section S)" };
  if (!input.text.trim()) return { ok: false, error: "Translation text is required (Section S)" };
  const requiresHumanApproval = HIGH_RISK_TRANSLATION_DOMAINS.includes(input.domain);
  return {
    ok: true,
    translation: {
      id: input.id,
      key: input.key,
      locale: input.locale,
      text: input.text,
      version: 1,
      quality: "ai",
      requiresHumanApproval,
      approved: false,
      sourceVersion: input.sourceVersion,
      createdAt: input.now ?? timeAuthority.now().at,
    },
  };
}

export function isAiTranslationDeployable(
  translation: Translation,
  policy: { requireHumanReviewForAi: boolean },
): boolean {
  if (translation.requiresHumanApproval) return translation.approved === true;
  if (policy.requireHumanReviewForAi) {
    return TRANSLATION_QUALITY_RANK[translation.quality] >= TRANSLATION_QUALITY_RANK.human;
  }
  return TRANSLATION_QUALITY_RANK[translation.quality] >= TRANSLATION_QUALITY_RANK.ai;
}

export function reviewTranslation(
  existing: Translation,
  reviewerRef: string,
  now: string = timeAuthority.now().at,
): { ok: true; translation: Translation } | { ok: false; error: string } {
  if (!reviewerRef.trim()) {
    return { ok: false, error: "Reviewer reference is required (Section R)" };
  }
  return {
    ok: true,
    translation: {
      ...existing,
      quality: "reviewed",
      approved: false,
      createdAt: now,
    },
  };
}

export function approveTranslation(
  existing: Translation,
  approverRef: string,
  now: string = timeAuthority.now().at,
): { ok: true; translation: Translation } | { ok: false; error: string } {
  if (!approverRef.trim()) {
    return { ok: false, error: "Approver reference is required (Section R)" };
  }
  return {
    ok: true,
    translation: {
      ...existing,
      quality: "approved",
      approved: true,
      createdAt: now,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Translation memory (Section T)
 * ────────────────────────────────────────────────────────────*/

export interface TranslationMemoryEntry {
  id: string;
  sourceLocale: string;
  sourceText: string;
  targetLocale: string;
  targetText: string;
  domain: "education" | "administrative" | "finance" | "government" | "technology" | "general";
}

export function createTranslationMemoryEntry(input: {
  id: string;
  sourceLocale: string;
  sourceText: string;
  targetLocale: string;
  targetText: string;
  domain: TranslationMemoryEntry["domain"];
}): { ok: true; entry: TranslationMemoryEntry } | { ok: false; error: string } {
  if (
    !input.id ||
    !input.sourceLocale ||
    !input.sourceText ||
    !input.targetLocale ||
    !input.targetText
  ) {
    return { ok: false, error: "Translation memory entry requires all fields (Section T)" };
  }
  return { ok: true, entry: { ...input } };
}

export function findTranslationMemory(
  entries: readonly TranslationMemoryEntry[],
  sourceLocale: string,
  sourceText: string,
  targetLocale: string,
): TranslationMemoryEntry | null {
  const normalized = sourceText.trim().toLowerCase();
  return (
    entries.find(
      (e) =>
        e.sourceLocale === sourceLocale &&
        e.targetLocale === targetLocale &&
        e.sourceText.trim().toLowerCase() === normalized,
    ) ?? null
  );
}

/* ─────────────────────────────────────────────────────────────
 * Terminology management (Sections U, DN)
 * ────────────────────────────────────────────────────────────*/

export type TerminologyDomain =
  "school" | "finance" | "hr" | "government" | "education" | "technology";

export interface TerminologyEntry {
  id: TerminologyId;
  term: string;
  domain: TerminologyDomain;
  locale: string;
  definition: string;
  approved: boolean;
  version: number;
}

export function createTerminologyEntry(input: {
  id: TerminologyId;
  term: string;
  domain: TerminologyDomain;
  locale: string;
  definition: string;
}): { ok: true; entry: TerminologyEntry } | { ok: false; error: string } {
  if (!input.term.trim()) return { ok: false, error: "Terminology term is required (Section U)" };
  if (!input.locale.trim())
    return { ok: false, error: "Terminology locale is required (Section U)" };
  if (!input.definition.trim())
    return { ok: false, error: "Terminology definition is required (Section U)" };
  return {
    ok: true,
    entry: {
      id: input.id,
      term: input.term,
      domain: input.domain,
      locale: input.locale,
      definition: input.definition,
      approved: false,
      version: 1,
    },
  };
}

export interface TerminologyChangeProposal {
  entryId: TerminologyId;
  proposalVersion: number;
  newDefinition: string;
  status: "proposed";
}

// Section DN: terminology changes are proposed, never silently applied.
export function proposeTerminologyChange(
  entry: TerminologyEntry,
  newDefinition: string,
): { ok: true; proposal: TerminologyChangeProposal } | { ok: false; error: string } {
  if (!newDefinition.trim()) {
    return { ok: false, error: "Proposed definition is required (Section DN)" };
  }
  return {
    ok: true,
    proposal: {
      entryId: entry.id,
      proposalVersion: entry.version + 1,
      newDefinition,
      status: "proposed",
    },
  };
}

export function approveTerminologyChange(
  proposal: TerminologyChangeProposal,
  entry: TerminologyEntry,
): { ok: true; entry: TerminologyEntry } | { ok: false; error: string } {
  if (proposal.entryId !== entry.id || proposal.proposalVersion !== entry.version + 1) {
    return {
      ok: false,
      error: "Proposal does not match the current terminology version (Section DN)",
    };
  }
  return {
    ok: true,
    entry: {
      ...entry,
      definition: proposal.newDefinition,
      approved: true,
      version: entry.version + 1,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Content variants (Sections DB, DC, DD, DE, DF, DO)
 * ────────────────────────────────────────────────────────────*/

export type ContentGovernanceLevel = "global_canonical" | "regional" | "institutional" | "user";

export const CONTENT_GOVERNANCE_RANK: Record<ContentGovernanceLevel, number> = {
  global_canonical: 0,
  regional: 1,
  institutional: 2,
  user: 3,
};

export interface LocalizedContent {
  id: ContentVariantId;
  sourceContentRef: string;
  locale: string;
  body: string;
  governanceLevel: ContentGovernanceLevel;
  sourceVersion: string;
  version: number;
}

export function createLocalizedContent(input: {
  id: ContentVariantId;
  sourceContentRef: string;
  locale: string;
  body: string;
  governanceLevel?: ContentGovernanceLevel;
  sourceVersion: string;
}): { ok: true; content: LocalizedContent } | { ok: false; error: string } {
  if (!input.id) return { ok: false, error: "Content variant id is required (Section DC)" };
  if (!input.sourceContentRef.trim()) {
    return { ok: false, error: "Source content reference is required (Section DC)" };
  }
  if (!input.locale.trim()) return { ok: false, error: "Content locale is required (Section DC)" };
  if (!input.body.trim()) return { ok: false, error: "Content body is required (Section DC)" };
  if (!input.sourceVersion)
    return { ok: false, error: "Content source version is required (Section DE)" };
  return {
    ok: true,
    content: {
      id: input.id,
      sourceContentRef: input.sourceContentRef,
      locale: input.locale,
      body: input.body,
      governanceLevel: input.governanceLevel ?? "regional",
      sourceVersion: input.sourceVersion,
      version: 1,
    },
  };
}

// Section DD: controlled fallback — exact locale, then explicit order.
export function resolveContentFallback(
  variants: readonly LocalizedContent[],
  locale: string,
  fallbackOrder: readonly string[],
): { ok: true; content: LocalizedContent } | { ok: false; error: string } {
  const exact = variants.find((v) => v.locale === locale);
  if (exact) return { ok: true, content: exact };
  for (const fallback of fallbackOrder) {
    const candidate = variants.find((v) => v.locale === fallback);
    if (candidate) return { ok: true, content: candidate };
  }
  return { ok: false, error: `No content variant available for "${locale}" (Section DD)` };
}

// Section DF: translation drift — content targeted an older source version.
export function detectTranslationDrift(
  content: LocalizedContent,
  currentSourceVersion: string,
): boolean {
  return content.sourceVersion !== currentSourceVersion;
}

export function hasOutdatedVariants(
  variants: readonly LocalizedContent[],
  currentSourceVersion: string,
): boolean {
  return variants.some((v) => detectTranslationDrift(v, currentSourceVersion));
}

// Section DO: an actor may author variants at their own governance level or
// below (more specific), never above.
export function validateContentGovernance(
  variant: LocalizedContent,
  actorScope: ContentGovernanceLevel,
): boolean {
  return CONTENT_GOVERNANCE_RANK[actorScope] <= CONTENT_GOVERNANCE_RANK[variant.governanceLevel];
}

/* ─────────────────────────────────────────────────────────────
 * Localization feedback (Section DM)
 * ────────────────────────────────────────────────────────────*/

export type LocalizationFeedbackType =
  | "incorrect_translation"
  | "inappropriate_terminology"
  | "regional_mismatch"
  | "formatting_problem";

export interface LocalizationFeedback {
  id: LocalizationFeedbackId;
  locale: string;
  reportType: LocalizationFeedbackType;
  details: string;
  status: "open" | "reviewing" | "resolved";
}

export function createLocalizationFeedback(input: {
  id: LocalizationFeedbackId;
  locale: string;
  reportType: LocalizationFeedbackType;
  details: string;
}): { ok: true; feedback: LocalizationFeedback } | { ok: false; error: string } {
  if (!input.locale.trim()) return { ok: false, error: "Feedback locale is required (Section DM)" };
  if (!input.details.trim())
    return { ok: false, error: "Feedback details are required (Section DM)" };
  return {
    ok: true,
    feedback: {
      id: input.id,
      locale: input.locale,
      reportType: input.reportType,
      details: input.details,
      status: "open",
    },
  };
}
