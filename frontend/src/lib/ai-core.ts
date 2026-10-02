/**
 * CoreGrid AI Intelligence Layer — AI core domain (request model, model registry,
 * routing, inference gateway).
 *
 * Implements `architecture/phase-26-ai-intelligence-layer.md`:
 * - Phase identity (Section 1): the AI Intelligence Layer is the shared cognitive
 *   infrastructure; it is not a chatbot, not the agent OS, not analytics.
 * - Intelligence taxonomy (Section 6): perception, understanding, retrieval,
 *   reasoning, prediction, recommendation, generation, planning support,
 *   decision support, explanation, evaluation — each capability has an explicit contract.
 * - AI request model (Section 7): requester, tenant, role, permissions, domain,
 *   purpose, context, data sources, model, policy, risk level, output type.
 * - AI context resolution (Section 8): who/why/what they may know/what context
 *   applies/what data is relevant/what policies apply.
 * - Context is not authorization (Section 9): AI context never grants permissions.
 * - AI security boundary (Section 10): consumes security decisions; cannot bypass
 *   authentication, authorization, tenant isolation, data classification, policy
 *   enforcement, or audit requirements.
 * - AI tenant isolation (Section 11): models must never expose another institution's
 *   information; tenant context is explicit in retrieval/prompts/memory/tools.
 * - Cross-tenant learning (Section 12): explicitly authorized, privacy-preserving,
 *   policy-controlled, auditable.
 * - Model abstraction (13), model registry (14), model versioning (15), model
 *   routing (16), model cascade (17), model fallback (18), model health (19),
 *   inference gateway (20).
 *
 * Phase 26 consumes Phase 02 identity/authorization, Phase 03 tenancy, and Phase 07
 * agent primitives by reference; it never duplicates them (AGENTS.md 65).
 */

import type { TenantId } from "./tenant-core";
import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/* ─────────────────────────────────────────────────────────────
 * Branded IDs
 * ────────────────────────────────────────────────────────────*/

export type AiRequestId = string & { readonly __brand: "AiRequestId" };
export type AiModelId = string & { readonly __brand: "AiModelId" };
export type AiModelVersionId = string & { readonly __brand: "AiModelVersionId" };
export type AiModelConfigId = string & { readonly __brand: "AiModelConfigId" };

export function aiRequestId(raw: string): AiRequestId {
  return raw as AiRequestId;
}
export function aiModelId(raw: string): AiModelId {
  return raw as AiModelId;
}
export function aiModelVersionId(raw: string): AiModelVersionId {
  return raw as AiModelVersionId;
}
export function aiModelConfigId(raw: string): AiModelConfigId {
  return raw as AiModelConfigId;
}

/* ─────────────────────────────────────────────────────────────
 * Intelligence taxonomy (Section 6)
 * ────────────────────────────────────────────────────────────*/

export type IntelligenceCapability =
  | "perception"
  | "understanding"
  | "retrieval"
  | "reasoning"
  | "prediction"
  | "recommendation"
  | "generation"
  | "planning_support"
  | "decision_support"
  | "explanation"
  | "evaluation";

export const INTELLIGENCE_CAPABILITIES: readonly IntelligenceCapability[] = [
  "perception",
  "understanding",
  "retrieval",
  "reasoning",
  "prediction",
  "recommendation",
  "generation",
  "planning_support",
  "decision_support",
  "explanation",
  "evaluation",
] as const;

/* ─────────────────────────────────────────────────────────────
 * AI request model (Section 7)
 * ────────────────────────────────────────────────────────────*/

export type AiRiskLevel = "low" | "medium" | "high" | "critical";

export const AI_RISK_LEVELS: readonly AiRiskLevel[] = [
  "low",
  "medium",
  "high",
  "critical",
] as const;

export type AiOutputType =
  | "text"
  | "structured"
  | "classification"
  | "extraction"
  | "embedding"
  | "image"
  | "audio"
  | "video";

export const AI_OUTPUT_TYPES: readonly AiOutputType[] = [
  "text",
  "structured",
  "classification",
  "extraction",
  "embedding",
  "image",
  "audio",
  "video",
] as const;

export interface AiRequestModel {
  id: AiRequestId;
  tenantId: TenantId;
  /** Requester identity (Phase 02 reference). */
  requesterRef: string;
  /** Authorized role ref. */
  roleRef: string;
  /** Authorized permission strings (never trusted from client). */
  permissions: string[];
  /** Domain the request targets, e.g. "education", "finance", "attendance". */
  domain: string;
  /** Declared purpose. */
  purpose: string;
  /** Context refs (institution/campus/class). */
  contextRefs: string[];
  /** Authorized data source refs. */
  dataSourceRefs: string[];
  /** Model selection (Section 16 routing output). */
  modelId: AiModelId | null;
  /** Policy refs governing the request. */
  policyRefs: string[];
  riskLevel: AiRiskLevel;
  outputType: AiOutputType;
  /** Correlation identifier spanning request → retrieval → model → output. */
  correlationId: string;
  createdAt: string;
}

export interface CreateAiRequestInput {
  id: AiRequestId;
  tenantId: TenantId;
  requesterRef: string;
  roleRef: string;
  permissions: string[];
  domain: string;
  purpose: string;
  contextRefs?: string[];
  dataSourceRefs?: string[];
  modelId?: AiModelId | null;
  policyRefs?: string[];
  riskLevel?: AiRiskLevel;
  outputType: AiOutputType;
  correlationId?: string;
  now?: string;
}

/**
 * AI request resolution (Section 7). A request cannot be constructed without
 * an explicit tenant, requester, role, permissions, purpose, and output type —
 * the same resolution a backend API boundary requires.
 */
export function createAiRequest(
  input: CreateAiRequestInput,
  now: string = timeAuthority.now().at,
): AiRequestModel {
  if (!input.tenantId) {
    throw new Error("AI request requires an explicit tenant context (Section 11)");
  }
  if (!input.requesterRef.trim()) {
    throw new Error("AI request requires a requester identity (Section 7)");
  }
  if (!input.purpose.trim()) {
    throw new Error("AI request requires a purpose (Section 8)");
  }
  if (input.permissions.length === 0) {
    throw new Error("AI request requires authorized permissions (Section 7)");
  }
  return {
    id: input.id,
    tenantId: input.tenantId,
    requesterRef: input.requesterRef,
    roleRef: input.roleRef,
    permissions: input.permissions,
    domain: input.domain,
    purpose: input.purpose,
    contextRefs: input.contextRefs ?? [],
    dataSourceRefs: input.dataSourceRefs ?? [],
    modelId: input.modelId ?? null,
    policyRefs: input.policyRefs ?? [],
    riskLevel: input.riskLevel ?? "low",
    outputType: input.outputType,
    correlationId: input.correlationId ?? `ai-${crypto.randomUUID()}`,
    createdAt: now,
  };
}

/**
 * Section 9: AI context can inform reasoning. It must never grant permissions.
 * Authorization remains external and authoritative.
 */
export function aiContextGrantsPermissions(): boolean {
  return false;
}

/**
 * Section 10: the AI layer consumes security decisions and cannot bypass them.
 * This contract enforces the tenant boundary explicitly (Section 11).
 */
export function isTenantBoundarySatisfied(
  request: AiRequestModel,
  allowedTenantId: TenantId,
): boolean {
  return request.tenantId === allowedTenantId;
}

/* ─────────────────────────────────────────────────────────────
 * Model registry (Sections 13, 14, 15)
 * ────────────────────────────────────────────────────────────*/

export type AiModelModality = "text" | "image" | "audio" | "video" | "document" | "embedding";

export const AI_MODEL_MODALITIES: readonly AiModelModality[] = [
  "text",
  "image",
  "audio",
  "video",
  "document",
  "embedding",
] as const;

export type ModelDeploymentLocation =
  "centralized_cloud" | "regional" | "private_cloud" | "on_premises" | "edge" | "byoc";

export const MODEL_DEPLOYMENT_LOCATIONS: readonly ModelDeploymentLocation[] = [
  "centralized_cloud",
  "regional",
  "private_cloud",
  "on_premises",
  "edge",
  "byoc",
] as const;

export interface AiModelDefinition {
  id: AiModelId;
  provider: string;
  name: string;
  /** Section 15: every production inference traces to model + version + config. */
  version: string;
  capabilities: IntelligenceCapability[];
  contextWindowTokens: number;
  modalities: AiModelModality[];
  /** Relative cost rank 0-100. */
  costRank: number;
  /** Relative latency rank 0-100 (lower = faster). */
  latencyRank: number;
  reliability: number;
  /** Data policy (Section 115): whether inputs are retained/trained on. */
  retainsInputs: boolean;
  trainsOnInputs: boolean;
  /** Model data policy ref (Section 115). */
  dataPolicyRef: string;
  jurisdiction: string;
  deploymentLocation: ModelDeploymentLocation;
  /** Model supply-chain verification (Section 118). */
  supplyChainVerified: boolean;
  /** Whether this model is approved for production (Section 132 promotion). */
  approvedForProduction: boolean;
  createdAt: string;
}

export interface RegisterModelInput {
  id: AiModelId;
  provider: string;
  name: string;
  version: string;
  capabilities: IntelligenceCapability[];
  contextWindowTokens: number;
  modalities?: AiModelModality[];
  costRank?: number;
  latencyRank?: number;
  reliability?: number;
  retainsInputs?: boolean;
  trainsOnInputs?: boolean;
  dataPolicyRef?: string;
  jurisdiction?: string;
  deploymentLocation?: ModelDeploymentLocation;
  supplyChainVerified?: boolean;
  approvedForProduction?: boolean;
  now?: string;
}

export type RegisterModelResult =
  { ok: true; model: AiModelDefinition } | { ok: false; error: string };

export function registerModel(
  input: RegisterModelInput,
  now: string = timeAuthority.now().at,
): RegisterModelResult {
  if (!input.provider.trim() || !input.name.trim()) {
    return { ok: false, error: "Model provider and name are required" };
  }
  if (!input.version.trim()) {
    return { ok: false, error: "Model version is required (Section 15)" };
  }
  if (input.capabilities.length === 0) {
    return { ok: false, error: "Model must declare at least one capability" };
  }
  if (input.contextWindowTokens <= 0) {
    return { ok: false, error: "Context window must be positive" };
  }
  return {
    ok: true,
    model: {
      id: input.id,
      provider: input.provider,
      name: input.name,
      version: input.version,
      capabilities: input.capabilities,
      contextWindowTokens: input.contextWindowTokens,
      modalities: input.modalities ?? ["text"],
      costRank: input.costRank ?? 50,
      latencyRank: input.latencyRank ?? 50,
      reliability: input.reliability ?? 1,
      retainsInputs: input.retainsInputs ?? false,
      trainsOnInputs: input.trainsOnInputs ?? false,
      dataPolicyRef: input.dataPolicyRef ?? "",
      jurisdiction: input.jurisdiction ?? "",
      deploymentLocation: input.deploymentLocation ?? "centralized_cloud",
      supplyChainVerified: input.supplyChainVerified ?? false,
      approvedForProduction: input.approvedForProduction ?? false,
      createdAt: now,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Model routing (Section 16), cascade (17), fallback (18)
 * ────────────────────────────────────────────────────────────*/

export interface ModelRoutingCriteria {
  task: IntelligenceCapability;
  /** Required modality. */
  modality?: AiModelModality;
  maxLatencyRank?: number;
  maxCostRank?: number;
  riskLevel?: AiRiskLevel;
  /** Privacy requirement: inputs must not be retained/trained on. */
  requiresNoRetention?: boolean;
}

/**
 * Model routing (Section 16): select an approved model by task, complexity,
 * latency, cost, risk, modality, privacy requirements, and availability.
 */
export function routeModel(
  criteria: ModelRoutingCriteria,
  candidates: AiModelDefinition[],
): AiModelDefinition | null {
  const eligible = candidates.filter((m) => {
    if (!m.capabilities.includes(criteria.task)) return false;
    if (criteria.modality && !m.modalities.includes(criteria.modality)) return false;
    if (criteria.maxLatencyRank !== undefined && m.latencyRank > criteria.maxLatencyRank)
      return false;
    if (criteria.maxCostRank !== undefined && m.costRank > criteria.maxCostRank) return false;
    if (criteria.requiresNoRetention && m.retainsInputs) return false;
    if (criteria.riskLevel === "high" || criteria.riskLevel === "critical") {
      // High-risk tasks require production-approved models (Section 132 promotion).
      if (!m.approvedForProduction) return false;
      if (!m.supplyChainVerified) return false;
    }
    return true;
  });
  if (eligible.length === 0) return null;
  // Deterministic preference: lowest latency, then lowest cost, then reliability.
  return [...eligible].sort((a, b) => {
    if (a.latencyRank !== b.latencyRank) return a.latencyRank - b.latencyRank;
    if (a.costRank !== b.costRank) return a.costRank - b.costRank;
    return b.reliability - a.reliability;
  })[0];
}

/**
 * Model fallback (Section 18): if a preferred model fails, select an approved
 * fallback while preserving policy/context and recording the fallback.
 */
export function selectModelFallback(
  preferredId: AiModelId,
  candidates: AiModelDefinition[],
): AiModelDefinition | null {
  const others = candidates
    .filter((m) => m.id !== preferredId && m.approvedForProduction)
    .sort((a, b) => a.latencyRank - b.latencyRank);
  return others[0] ?? null;
}

/**
 * Model cascade (Section 17): small model → evaluation → larger model →
 * specialist → human escalation. Returns the model to escalate to, or null
 * when human escalation is required.
 */
export function escalateModelCascade(
  currentModel: AiModelDefinition,
  candidates: AiModelDefinition[],
  evaluationFailed: boolean,
): AiModelDefinition | null {
  if (!evaluationFailed) return currentModel;
  const larger = candidates
    .filter(
      (m) => m.contextWindowTokens > currentModel.contextWindowTokens && m.approvedForProduction,
    )
    .sort((a, b) => a.contextWindowTokens - b.contextWindowTokens);
  return larger[0] ?? null;
}

/* ─────────────────────────────────────────────────────────────
 * Model health (Section 19)
 * ────────────────────────────────────────────────────────────*/

export interface ModelHealthStatus {
  modelId: AiModelId;
  /** 0-1 availability over the window. */
  availability: number;
  errorRate: number;
  p95LatencyMs: number;
  /** Tracked hallucination rate over the window. */
  hallucinationRate: number;
  safetyIncidentCount: number;
  healthy: boolean;
  lastCheckedAt: string;
}

export function evaluateModelHealth(input: {
  modelId: AiModelId;
  availability: number;
  errorRate: number;
  p95LatencyMs: number;
  hallucinationRate: number;
  safetyIncidentCount: number;
  maxErrorRate?: number;
  maxLatencyMs?: number;
  now?: string;
}): ModelHealthStatus {
  const maxErrorRate = input.maxErrorRate ?? 0.05;
  const maxLatencyMs = input.maxLatencyMs ?? 10_000;
  const healthy =
    input.availability >= 0.95 &&
    input.errorRate <= maxErrorRate &&
    input.p95LatencyMs <= maxLatencyMs &&
    input.hallucinationRate <= 0.1 &&
    input.safetyIncidentCount === 0;
  return {
    modelId: input.modelId,
    availability: input.availability,
    errorRate: input.errorRate,
    p95LatencyMs: input.p95LatencyMs,
    hallucinationRate: input.hallucinationRate,
    safetyIncidentCount: input.safetyIncidentCount,
    healthy,
    lastCheckedAt: input.now ?? timeAuthority.now().at,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Inference gateway (Section 20)
 * All production model requests pass through the AI inference gateway.
 * ────────────────────────────────────────────────────────────*/

export interface InferenceGatewayResult {
  requestId: AiRequestId;
  modelId: AiModelId;
  /** True when an approved fallback was used (Section 18). */
  fallbackUsed: boolean;
  /** Confidence is degraded when a fallback was used. */
  degradedConfidence: boolean;
  startedAt: string;
  completedAt: string;
}
