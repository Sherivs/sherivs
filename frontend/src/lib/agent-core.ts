/**
 * CoreGrid — AI Agent System core identity and lifecycle.
 *
 * Implements `architecture/phase-07-ai-agent-system.md`:
 * - Agent definition: a controlled software entity capable of action within
 *   explicitly defined boundaries (Section F).
 * - Agent types: conversational, task, workflow, research, monitoring, planning,
 *   execution, supervisory, coordinator, specialist, reviewer, evaluator,
 *   autonomous, human-assist (Section G).
 * - Agent identity: every agent requires a stable identity (Section H).
 * - Agent registry: the authoritative catalog of deployed and available agents
 *   recording identity, version, capabilities, permissions, model configuration,
 *   tools, memory requirements, lifecycle state, deployment state, evaluation
 *   status, owner, environment (Section I).
 * - Agent versioning: agents must be versioned; a new version must not silently
 *   alter the behavior of existing critical workflows (Section J).
 * - Agent lifecycle: proposed → review → approved → deployed → monitored →
 *   suspended → reviewed → retired (Sections K, L).
 * - Agent creation requires identity, purpose, owner, capabilities, allowed tools,
 *   permissions, model policy, memory policy, execution limits, evaluation
 *   requirements (Section M).
 * - Production agents require explicit approval per risk classification (Section N).
 * - Risk classification determines approval, permissions, monitoring, autonomy,
 *   human review, execution limits (Section O).
 * - Trust level is explicit; never inferred from model quality (Section P).
 * - Agent permissions are least privilege (Section BX).
 * - Agent identity must be included in authorization decisions (Section BZ).
 * - Acting-as-user must preserve delegating identity and initiating authority (CA).
 * - Non-repudiation: actions attributable to the actual agent and initiating
 *   authority (Section CB).
 * - Tenant boundary: every tenant-scoped agent execution carries tenant context
 *   (Section E2). Cross-tenant leaks are prohibited (Section FO).
 */

import type { TenantId } from "./tenant-core";
import type { ExecutionContext } from "./runtime-core";

/* ─────────────────────────────────────────────────────────────
 * Branded IDs
 * ────────────────────────────────────────────────────────────*/

export type AgentId = string & { readonly __brand: "AgentId" };
export type AgentVersionId = string & { readonly __brand: "AgentVersionId" };
export type AgentDefinitionId = string & { readonly __brand: "AgentDefinitionId" };
export type AgentSessionId = string & { readonly __brand: "AgentSessionId" };
export type AgentExecutionId = string & { readonly __brand: "AgentExecutionId" };
export type AgentCorrelationId = string & { readonly __brand: "AgentCorrelationId" };

export function agentId(raw: string): AgentId {
  return raw as AgentId;
}

export function agentVersionId(raw: string): AgentVersionId {
  return raw as AgentVersionId;
}

export function agentDefinitionId(raw: string): AgentDefinitionId {
  return raw as AgentDefinitionId;
}

export function agentSessionId(raw: string): AgentSessionId {
  return raw as AgentSessionId;
}

export function agentExecutionId(raw: string): AgentExecutionId {
  return raw as AgentExecutionId;
}

export function agentCorrelationId(raw: string): AgentCorrelationId {
  return raw as AgentCorrelationId;
}

/* ─────────────────────────────────────────────────────────────
 * Agent types (Section G)
 * ────────────────────────────────────────────────────────────*/

export type AgentType =
  | "conversational"
  | "task"
  | "workflow"
  | "research"
  | "monitoring"
  | "planning"
  | "execution"
  | "supervisory"
  | "coordinator"
  | "specialist"
  | "reviewer"
  | "evaluator"
  | "autonomous"
  | "human_assist";

export const AGENT_TYPES: readonly AgentType[] = [
  "conversational",
  "task",
  "workflow",
  "research",
  "monitoring",
  "planning",
  "execution",
  "supervisory",
  "coordinator",
  "specialist",
  "reviewer",
  "evaluator",
  "autonomous",
  "human_assist",
] as const;

/* ─────────────────────────────────────────────────────────────
 * Agent lifecycle states (Sections K, L)
 * ────────────────────────────────────────────────────────────*/

export type AgentLifecycleState =
  | "proposed"
  | "in_review"
  | "approved"
  | "deployed"
  | "monitoring"
  | "suspended"
  | "in_review_after_suspension"
  | "retired";

export const AGENT_LIFECYCLE_STATES: readonly AgentLifecycleState[] = [
  "proposed",
  "in_review",
  "approved",
  "deployed",
  "monitoring",
  "suspended",
  "in_review_after_suspension",
  "retired",
] as const;

export interface AgentLifecycleTransition {
  from: AgentLifecycleState;
  to: AgentLifecycleState;
  allowed: boolean;
  requiresApproval: boolean;
}

export const AGENT_LIFECYCLE_TRANSITIONS: readonly AgentLifecycleTransition[] = [
  { from: "proposed", to: "in_review", allowed: true, requiresApproval: false },
  { from: "in_review", to: "approved", allowed: true, requiresApproval: true },
  { from: "in_review", to: "retired", allowed: true, requiresApproval: true },
  { from: "approved", to: "deployed", allowed: true, requiresApproval: true },
  { from: "deployed", to: "monitoring", allowed: true, requiresApproval: false },
  { from: "monitoring", to: "suspended", allowed: true, requiresApproval: true },
  { from: "deployed", to: "suspended", allowed: true, requiresApproval: true },
  { from: "suspended", to: "in_review_after_suspension", allowed: true, requiresApproval: true },
  { from: "in_review_after_suspension", to: "deployed", allowed: true, requiresApproval: true },
  { from: "in_review_after_suspension", to: "retired", allowed: true, requiresApproval: true },
  { from: "monitoring", to: "retired", allowed: true, requiresApproval: true },
  { from: "deployed", to: "retired", allowed: true, requiresApproval: true },
] as const;

export function isAgentLifecycleTransitionAllowed(
  from: AgentLifecycleState,
  to: AgentLifecycleState,
): { allowed: boolean; requiresApproval: boolean } {
  const transition = AGENT_LIFECYCLE_TRANSITIONS.find((t) => t.from === from && t.to === to);
  if (!transition) {
    return { allowed: false, requiresApproval: false };
  }
  return { allowed: transition.allowed, requiresApproval: transition.requiresApproval };
}

/* ─────────────────────────────────────────────────────────────
 * Agent risk & trust classification (Sections O, P)
 * ────────────────────────────────────────────────────────────*/

export type AgentRiskClassification = "low" | "medium" | "high" | "critical";

export const AGENT_RISK_CLASSIFICATIONS: readonly AgentRiskClassification[] = [
  "low",
  "medium",
  "high",
  "critical",
] as const;

export type AgentTrustLevel = "untrusted" | "limited" | "standard" | "elevated" | "high";

export const AGENT_TRUST_LEVELS: readonly AgentTrustLevel[] = [
  "untrusted",
  "limited",
  "standard",
  "elevated",
  "high",
] as const;

export interface RiskControlProfile {
  classification: AgentRiskClassification;
  requiresApprovalForDeployment: boolean;
  requiresHumanInLoop: boolean;
  allowsAutonomous: boolean;
  maxToolCallBudget: number;
  maxTimeBudgetMinutes: number;
  requiresSandbox: boolean;
  requiresMonitoring: boolean;
}

export const RISK_CONTROL_PROFILES: Record<AgentRiskClassification, RiskControlProfile> = {
  low: {
    classification: "low",
    requiresApprovalForDeployment: false,
    requiresHumanInLoop: false,
    allowsAutonomous: true,
    maxToolCallBudget: 20,
    maxTimeBudgetMinutes: 30,
    requiresSandbox: false,
    requiresMonitoring: false,
  },
  medium: {
    classification: "medium",
    requiresApprovalForDeployment: false,
    requiresHumanInLoop: false,
    allowsAutonomous: true,
    maxToolCallBudget: 50,
    maxTimeBudgetMinutes: 120,
    requiresSandbox: false,
    requiresMonitoring: true,
  },
  high: {
    classification: "high",
    requiresApprovalForDeployment: true,
    requiresHumanInLoop: true,
    allowsAutonomous: false,
    maxToolCallBudget: 100,
    maxTimeBudgetMinutes: 240,
    requiresSandbox: true,
    requiresMonitoring: true,
  },
  critical: {
    classification: "critical",
    requiresApprovalForDeployment: true,
    requiresHumanInLoop: true,
    allowsAutonomous: false,
    maxToolCallBudget: 200,
    maxTimeBudgetMinutes: 480,
    requiresSandbox: true,
    requiresMonitoring: true,
  },
};

/* ─────────────────────────────────────────────────────────────
 * Agent model / permission / memory policy (Sections CK, BX)
 * ────────────────────────────────────────────────────────────*/

export interface AgentModelPolicy {
  /** Providers the agent is permitted to use (OpenAI, DeepSeek, OpenRouter, ...). */
  allowedProviders: string[];
  /** Data classification that may be sent to the model (Section FU). */
  maxDataClassification: "PUBLIC" | "TENANT_INTERNAL" | "CONFIDENTIAL" | "SENSITIVE" | "RESTRICTED";
  /** Maximum input tokens per request. */
  maxInputTokens: number;
  /** Maximum output tokens per request. */
  maxOutputTokens: number;
  /** Whether the model may route across providers (Section CI). */
  allowFallback: boolean;
}

export interface AgentMemoryPolicy {
  /** Whether the agent may write to persistent memory (Section AT). */
  allowPersistentWrite: boolean;
  /** Memory categories the agent may access (Section AR). */
  allowedMemoryCategories: AgentMemoryCategory[];
  /** Whether agent-generated memory must be marked as inference (Section AU). */
  requireInferenceMarking: boolean;
}

export type AgentMemoryCategory = "working" | "episodic" | "semantic" | "task" | "procedural";

export const AGENT_MEMORY_CATEGORIES: readonly AgentMemoryCategory[] = [
  "working",
  "episodic",
  "semantic",
  "task",
  "procedural",
] as const;

/* ─────────────────────────────────────────────────────────────
 * Agent permission model (Sections BY, BZ, CA, CB)
 * ────────────────────────────────────────────────────────────*/

export type AgentPermission =
  | { kind: "capability"; capabilityId: string }
  | { kind: "tool"; toolId: string }
  | { kind: "resource"; resourceType: string; resourceId: string | null }
  | { kind: "tenant"; tenantId: TenantId }
  | { kind: "acting_as_user"; userId: string }
  | { kind: "external_action"; actionType: string };

export interface AgentScope {
  tenantId: TenantId | null;
  workspaceIds: string[];
  resourceTypes: string[];
  maxDataClassification: "PUBLIC" | "TENANT_INTERNAL" | "CONFIDENTIAL" | "SENSITIVE" | "RESTRICTED";
}

/* ─────────────────────────────────────────────────────────────
 * Agent definition & registry (Sections H, I, M)
 * ────────────────────────────────────────────────────────────*/

export interface AgentDefinition {
  id: AgentDefinitionId;
  /** Stable human-readable agent identity. */
  agentId: AgentId;
  /** Tenant scope; null = CrossGrid platform agent. */
  tenantId: TenantId | null;
  name: string;
  purpose: string;
  type: AgentType;
  ownerUserId: string;
  version: string;
  lifecycleState: AgentLifecycleState;
  riskClassification: AgentRiskClassification;
  trustLevel: AgentTrustLevel;
  capabilities: string[];
  allowedToolIds: string[];
  deniedToolIds: string[];
  permissions: AgentPermission[];
  modelPolicy: AgentModelPolicy;
  memoryPolicy: AgentMemoryPolicy;
  scope: AgentScope;
  environment: "production" | "staging" | "test" | "development";
  deploymentState: "not_deployed" | "deploying" | "deployed" | "retracting" | "retracted";
  evaluationStatus: "not_evaluated" | "in_evaluation" | "passed" | "failed" | "pending_review";
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentDefinitionInput {
  tenantId: TenantId | null;
  name: string;
  purpose: string;
  type: AgentType;
  ownerUserId: string;
  version: string;
  riskClassification: AgentRiskClassification;
  trustLevel: AgentTrustLevel;
  capabilities: string[];
  allowedToolIds: string[];
  deniedToolIds?: string[];
  permissions?: AgentPermission[];
  modelPolicy: AgentModelPolicy;
  memoryPolicy: AgentMemoryPolicy;
  scope: AgentScope;
  environment?: "production" | "staging" | "test" | "development";
  now: string;
}

export type CreateAgentDefinitionResult =
  { ok: true; definition: AgentDefinition } | { ok: false; error: string };

export function createAgentDefinition(
  input: CreateAgentDefinitionInput,
): CreateAgentDefinitionResult {
  if (input.name.trim() === "") {
    return { ok: false, error: "Agent name is required" };
  }
  if (input.purpose.trim() === "") {
    return { ok: false, error: "Agent purpose is required" };
  }
  if (!AGENT_TYPES.includes(input.type)) {
    return { ok: false, error: `Unknown agent type: ${input.type}` };
  }
  if (input.ownerUserId.trim() === "") {
    return { ok: false, error: "Agent owner is required (Section IO)" };
  }
  if (input.version.trim() === "") {
    return { ok: false, error: "Agent version is required" };
  }

  const agentIdValue = agentId(`${input.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`);

  const definition: AgentDefinition = {
    id: agentDefinitionId(`${agentIdValue}:${input.version}`),
    agentId: agentIdValue,
    tenantId: input.tenantId,
    name: input.name,
    purpose: input.purpose,
    type: input.type,
    ownerUserId: input.ownerUserId,
    version: input.version,
    lifecycleState: "proposed",
    riskClassification: input.riskClassification,
    trustLevel: input.trustLevel,
    capabilities: input.capabilities,
    allowedToolIds: input.allowedToolIds,
    deniedToolIds: input.deniedToolIds ?? [],
    permissions: input.permissions ?? [],
    modelPolicy: input.modelPolicy,
    memoryPolicy: input.memoryPolicy,
    scope: input.scope,
    environment: input.environment ?? "test",
    deploymentState: "not_deployed",
    evaluationStatus: "not_evaluated",
    createdAt: input.now,
    updatedAt: input.now,
  };

  return { ok: true, definition };
}

export interface ChangeAgentLifecycleInput {
  definition: AgentDefinition;
  to: AgentLifecycleState;
  actorId: string;
  reason: string | null;
  now: string;
}

export type ChangeAgentLifecycleResult =
  { ok: true; definition: AgentDefinition } | { ok: false; error: string };

export function changeAgentLifecycle(input: ChangeAgentLifecycleInput): ChangeAgentLifecycleResult {
  // Retired agents lose production authority (Section HB).
  if (input.definition.lifecycleState === "retired") {
    return { ok: false, error: "Retired agents cannot change lifecycle state" };
  }

  const transition = isAgentLifecycleTransitionAllowed(input.definition.lifecycleState, input.to);
  if (!transition.allowed) {
    return {
      ok: false,
      error: `Agent lifecycle transition ${input.definition.lifecycleState} → ${input.to} is not allowed`,
    };
  }

  // Critical/high-risk agents require approval for deployment (Section N).
  if (
    input.to === "deployed" &&
    input.definition.riskClassification !== "low" &&
    input.definition.riskClassification !== "medium" &&
    (input.reason === null || input.reason.trim() === "")
  ) {
    return {
      ok: false,
      error: "Deployment of high/critical-risk agents requires approval context",
    };
  }

  return {
    ok: true,
    definition: {
      ...input.definition,
      lifecycleState: input.to,
      deploymentState: input.to === "deployed" ? "deployed" : input.definition.deploymentState,
      updatedAt: input.now,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Agent session & context (Sections E2, BZ, CA)
 * ────────────────────────────────────────────────────────────*/

export interface AgentExecutionContext {
  agentId: AgentId;
  sessionId: AgentSessionId;
  executionId: AgentExecutionId;
  correlationId: AgentCorrelationId;
  tenantId: TenantId | null;
  /** Who initiated this execution (human or supervisory agent). */
  initiatingActorId: string | null;
  /** If acting on behalf of a user, who that user is (Section CA). */
  actingForUserId: string | null;
  /** The context package (Section AW) — task, permissions, memory, constraints. */
  contextPackageVersion: string;
  riskClassification: AgentRiskClassification;
  startedAt: string;
  executionContext: ExecutionContext;
}

export function createAgentExecutionContext(
  agent: AgentDefinition,
  sessionId: AgentSessionId,
  executionId: AgentExecutionId,
  correlationId: AgentCorrelationId,
  initiatingActorId: string | null,
  actingForUserId: string | null,
  startedAt: string,
  executionContext: ExecutionContext,
): AgentExecutionContext {
  return {
    agentId: agent.agentId,
    sessionId,
    executionId,
    correlationId,
    tenantId: agent.tenantId,
    initiatingActorId,
    actingForUserId,
    contextPackageVersion: `cprim-1-${agent.version}`,
    riskClassification: agent.riskClassification,
    startedAt,
    executionContext,
  };
}

export function validateAgentExecutionContext(
  context: AgentExecutionContext,
): { ok: true } | { ok: false; error: string } {
  // Cross-tenant agent execution is prohibited (Section FO).
  if (context.executionContext.isCrossTenantOperation) {
    return { ok: false, error: "Cross-tenant agent execution is prohibited" };
  }
  // Tenant scope must match the agent's scope (Section E2).
  if (context.tenantId !== null && context.executionContext.tenantId !== null) {
    if (context.tenantId !== context.executionContext.tenantId) {
      return { ok: false, error: "Agent tenant scope does not match execution tenant context" };
    }
  }
  return { ok: true };
}
