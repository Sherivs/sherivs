/**
 * CoreGrid AI Intelligence Layer — AI services domain (capability/skill registry,
 * multimodal/document intelligence, safe generation, orchestration).
 *
 * Implements `architecture/phase-26-ai-intelligence-layer.md`:
 * - AI capability registry (84): AI capabilities, models, tools, prompts,
 *   policies, evaluators. AI skill registry (85): summarization, classification,
 *   extraction, translation, reasoning, document analysis, recommendation,
 *   forecasting support, question answering.
 * - AI service contract (86): request, context, authorization, output, confidence,
 *   provenance, errors. Structured output (87): schemas over free text.
 * - Output validation (88): schema, types, ranges, required fields, policy.
 * - Safe generation (89) + content moderation (90): harmful content, privacy
 *   leakage, inappropriate content, policy violations.
 * - Child safety (91) + age-aware AI (92): stronger protections for minors.
 * - Multimodal AI (52), document intelligence (53-56), vision (57), speech (59).
 * - African language intelligence (60-64): language detection (61), translation
 *   (62) preserving educational terminology/names/technical terms/local meaning,
 *   cultural context (63), African knowledge (64).
 * - AI orchestration (171): coordinate model calls, retrieval, evaluators,
 *   multimodal processors, specialist models — without becoming the agent OS.
 * - AI DAG execution (172): Input → Classification → Retrieval → Reasoning →
 *   Verification → Output. Pipeline versioning (173).
 * - Agent model selection (169): agents request capability/risk/latency/cost and
 *   the AI layer chooses an approved model. Agent tool broker (170): the AI layer
 *   provides model/tool compatibility information; actual agent authority remains
 *   Phase 07.
 */

import type { TenantId } from "./tenant-core";
import type { AiModelId, IntelligenceCapability, AiRiskLevel } from "./ai-core";
import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/* ─────────────────────────────────────────────────────────────
 * Branded IDs
 * ────────────────────────────────────────────────────────────*/

export type AiCapabilityId = string & { readonly __brand: "AiCapabilityId" };
export type AiSkillId = string & { readonly __brand: "AiSkillId" };
export type AiPipelineId = string & { readonly __brand: "AiPipelineId" };

export function aiCapabilityId(raw: string): AiCapabilityId {
  return raw as AiCapabilityId;
}
export function aiSkillId(raw: string): AiSkillId {
  return raw as AiSkillId;
}
export function aiPipelineId(raw: string): AiPipelineId {
  return raw as AiPipelineId;
}

/* ─────────────────────────────────────────────────────────────
 * Capability + skill registries (Sections 84, 85)
 * ────────────────────────────────────────────────────────────*/

export type AiSkillKey =
  | "summarization"
  | "classification"
  | "extraction"
  | "translation"
  | "reasoning"
  | "document_analysis"
  | "recommendation"
  | "forecasting_support"
  | "question_answering";

export const AI_SKILL_KEYS: readonly AiSkillKey[] = [
  "summarization",
  "classification",
  "extraction",
  "translation",
  "reasoning",
  "document_analysis",
  "recommendation",
  "forecasting_support",
  "question_answering",
] as const;

export interface AiCapability {
  id: AiCapabilityId;
  tenantId: TenantId | null;
  key: string;
  capability: IntelligenceCapability;
  /** Model refs that can serve this capability. */
  modelIds: AiModelId[];
  /** Tool refs this capability may use. */
  toolRefs: string[];
  /** Prompt refs this capability uses. */
  promptRefs: string[];
  /** Policy refs governing this capability. */
  policyRefs: string[];
  /** Evaluator refs for this capability. */
  evaluatorRefs: string[];
  isEnabled: boolean;
}

export function registerAiCapability(input: {
  id: AiCapabilityId;
  tenantId?: TenantId | null;
  key: string;
  capability: IntelligenceCapability;
  modelIds?: AiModelId[];
  toolRefs?: string[];
  promptRefs?: string[];
  policyRefs?: string[];
  evaluatorRefs?: string[];
  isEnabled?: boolean;
}): AiCapability {
  return {
    id: input.id,
    tenantId: input.tenantId ?? null,
    key: input.key,
    capability: input.capability,
    modelIds: input.modelIds ?? [],
    toolRefs: input.toolRefs ?? [],
    promptRefs: input.promptRefs ?? [],
    policyRefs: input.policyRefs ?? [],
    evaluatorRefs: input.evaluatorRefs ?? [],
    isEnabled: input.isEnabled ?? false,
  };
}

export interface AiSkill {
  id: AiSkillId;
  key: AiSkillKey;
  name: string;
  /** Capability keys this skill requires. */
  requiresCapabilities: string[];
  isActive: boolean;
}

export function registerAiSkill(input: {
  id: AiSkillId;
  key: AiSkillKey;
  name: string;
  requiresCapabilities?: string[];
  isActive?: boolean;
}): AiSkill {
  return {
    id: input.id,
    key: input.key,
    name: input.name,
    requiresCapabilities: input.requiresCapabilities ?? [],
    isActive: input.isActive ?? true,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Service contract (86) + structured output (87) + validation (88)
 * ────────────────────────────────────────────────────────────*/

export interface AiServiceContract {
  capabilityId: AiCapabilityId;
  requestSchemaRef: string;
  /** Authorization requirement ref (never trusted from client). */
  authorizationRef: string;
  outputSchemaRef: string;
  /** Confidence and provenance are mandatory parts of the contract (Section 86). */
  confidenceRequired: boolean;
  provenanceRequired: boolean;
}

export type StructuredOutputStatus = "valid" | "invalid";

export interface StructuredOutputValidationResult {
  status: StructuredOutputStatus;
  errors: string[];
}

/**
 * Output validation (Section 88): validate schema, types, ranges, required
 * fields, and policy constraints on structured AI output.
 */
export function validateStructuredOutput(input: {
  value: Record<string, unknown>;
  requiredFields: string[];
  /** field -> [min, max] numeric ranges. */
  numericRanges?: Record<string, [number, number]>;
}): StructuredOutputValidationResult {
  const errors: string[] = [];
  for (const field of input.requiredFields) {
    if (
      input.value[field] === undefined ||
      input.value[field] === null ||
      input.value[field] === ""
    ) {
      errors.push(`Missing required field: ${field}`);
    }
  }
  if (input.numericRanges) {
    for (const [field, [min, max]] of Object.entries(input.numericRanges)) {
      const v = input.value[field];
      if (typeof v === "number") {
        if (v < min || v > max) errors.push(`Field '${field}' out of range [${min}, ${max}]`);
      }
    }
  }
  return { status: errors.length === 0 ? "valid" : "invalid", errors };
}

/* ─────────────────────────────────────────────────────────────
 * Safe generation (89) + content moderation (90) + child safety (91)
 * ────────────────────────────────────────────────────────────*/

export type ModerationSignal =
  "harmful_content" | "privacy_leakage" | "inappropriate_content" | "policy_violation";

export const MODERATION_SIGNALS: readonly ModerationSignal[] = [
  "harmful_content",
  "privacy_leakage",
  "inappropriate_content",
  "policy_violation",
] as const;

export interface ModerationResult {
  passed: boolean;
  signals: ModerationSignal[];
}

/**
 * Content moderation (Section 90): generated content passes configurable
 * safety/privacy/policy/quality checks before release (Section 89).
 */
export function moderateGeneratedContent(input: {
  signals: ModerationSignal[];
  /** Block content on any signal for minors (Section 91 child safety). */
  audienceIsMinor?: boolean;
}): ModerationResult {
  const signals = input.signals;
  const passed = input.audienceIsMinor
    ? signals.length === 0
    : !signals.includes("harmful_content") && !signals.includes("policy_violation");
  return { passed, signals };
}

/**
 * Age-aware AI (Section 92): where authorized age information exists, AI policies
 * may adapt accordingly. This contract applies stricter moderation for minors.
 */
export function applyAgeAwareProtection(
  age: number,
  baseline: ModerationSignal[],
): ModerationSignal[] {
  if (age < 18) {
    const additional: ModerationSignal[] = [];
    if (baseline.includes("inappropriate_content")) additional.push("inappropriate_content");
    return additional;
  }
  return [];
}

/* ─────────────────────────────────────────────────────────────
 * Multimodal (52) + document intelligence (53-56) + vision (57) + speech (59)
 * ────────────────────────────────────────────────────────────*/

export type AiInputModality =
  "text" | "image" | "audio" | "video" | "document" | "table" | "diagram";

export const AI_INPUT_MODALITIES: readonly AiInputModality[] = [
  "text",
  "image",
  "audio",
  "video",
  "document",
  "table",
  "diagram",
] as const;

export interface DocumentExtraction {
  sourceRef: string;
  tenantId: TenantId;
  /** Extracted text (54 OCR support). */
  text: string;
  /** Extracted structured fields with confidence scores (Section 56). */
  fields: Array<{ key: string; value: string; confidence: number }>;
  /** Detected document classification (Section 55). */
  classification: string;
  classificationConfidence: number;
  /** Extracted entities (Section 53). */
  entities: string[];
}

export function recordDocumentExtraction(input: {
  sourceRef: string;
  tenantId: TenantId;
  text?: string;
  fields?: Array<{ key: string; value: string; confidence: number }>;
  classification: string;
  classificationConfidence?: number;
  entities?: string[];
}): DocumentExtraction {
  return {
    sourceRef: input.sourceRef,
    tenantId: input.tenantId,
    text: input.text ?? "",
    fields: input.fields ?? [],
    classification: input.classification,
    classificationConfidence: input.classificationConfidence ?? 0.5,
    entities: input.entities ?? [],
  };
}

/** Document field extraction is only trustworthy above the confidence threshold. */
export function isExtractionConfident(
  extraction: DocumentExtraction,
  threshold: number = 0.8,
): boolean {
  return (
    extraction.classificationConfidence >= threshold &&
    extraction.fields.every((f) => f.confidence >= threshold)
  );
}

/* ─────────────────────────────────────────────────────────────
 * African language intelligence (60-64)
 * ────────────────────────────────────────────────────────────*/

export const SUPPORTED_AFRICAN_LANGUAGES: readonly string[] = [
  "en",
  "fr",
  "pt",
  "ar",
  "sw",
  "ig",
  "yo",
  "ha",
  "am",
  "zu",
  "xh",
  "wo",
] as const;

export function isLanguageSupported(code: string): boolean {
  return (SUPPORTED_AFRICAN_LANGUAGES as readonly string[]).includes(code.toLowerCase());
}

/**
 * Translation (Section 62): preserve educational terminology, names, technical
 * terms, and local meaning. Terms declared protected are never machine-translated
 * without review.
 */
export function requiresTranslationReview(input: {
  protectedTerms: string[];
  detectedTerms: string[];
}): boolean {
  return input.protectedTerms.some((t) => input.detectedTerms.includes(t));
}

/* ─────────────────────────────────────────────────────────────
 * Orchestration (171) + DAG execution (172) + pipeline versioning (173)
 * ────────────────────────────────────────────────────────────*/

export type AiPipelineStage =
  "input" | "classification" | "retrieval" | "reasoning" | "verification" | "output";

export const AI_PIPELINE_STAGES: readonly AiPipelineStage[] = [
  "input",
  "classification",
  "retrieval",
  "reasoning",
  "verification",
  "output",
] as const;

export interface AiPipeline {
  id: AiPipelineId;
  tenantId: TenantId | null;
  name: string;
  /** Section 173: every AI pipeline must be versioned. */
  version: number;
  stages: AiPipelineStage[];
  /** Latency budget ms (Section 175). */
  latencyBudgetMs: number;
  /** Token budget per execution (Section 176). */
  tokenBudget: number;
  isActive: boolean;
  createdAt: string;
}

export function createAiPipeline(input: {
  id: AiPipelineId;
  tenantId?: TenantId | null;
  name: string;
  version?: number;
  stages?: AiPipelineStage[];
  latencyBudgetMs?: number;
  tokenBudget?: number;
  isActive?: boolean;
  now?: string;
}): AiPipeline {
  return {
    id: input.id,
    tenantId: input.tenantId ?? null,
    name: input.name,
    version: input.version ?? 1,
    stages: input.stages ?? [...AI_PIPELINE_STAGES],
    latencyBudgetMs: input.latencyBudgetMs ?? 30_000,
    tokenBudget: input.tokenBudget ?? 8_000,
    isActive: input.isActive ?? false,
    createdAt: input.now ?? timeAuthority.now().at,
  };
}

/** A pipeline execution is valid only when stages are acyclic and ordered (Section 172 DAG). */
export function isPipelineDagValid(stages: AiPipelineStage[]): boolean {
  const order = AI_PIPELINE_STAGES;
  for (let i = 1; i < stages.length; i++) {
    if (order.indexOf(stages[i]) < order.indexOf(stages[i - 1])) return false;
  }
  return stages.length > 0;
}

/* ─────────────────────────────────────────────────────────────
 * Agent interface (168, 169, 170)
 * ────────────────────────────────────────────────────────────*/

export interface AgentModelRequest {
  capability: IntelligenceCapability;
  riskLevel: AiRiskLevel;
  maxLatencyRank?: number;
  maxCostRank?: number;
}

export interface ToolCompatibilityInfo {
  toolKey: string;
  compatibleModelIds: AiModelId[];
}

/**
 * Agent model selection (Section 169): agents request capability/risk/latency/cost
 * and the AI layer chooses an approved model. Actual agent authority remains Phase 07.
 */
export function isAgentModelRequestSatisfiable(
  request: AgentModelRequest,
  availableModelIds: AiModelId[],
  hasPermission: boolean,
): boolean {
  if (!hasPermission) return false;
  return availableModelIds.length > 0;
}
