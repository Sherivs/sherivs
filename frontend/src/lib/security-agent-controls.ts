/**
 * CoreGrid — Security Engine agent & tool security controls
 * (Phase 08, Sections N, O).
 *
 * Implements `architecture/phase-08-security-engine.md`:
 * - Agent Security (N): prevent AI agents from becoming uncontrolled security
 *   principals; every agent requires identity, permissions, scope, tenant
 *   context, tool permissions, resource permissions, action limits,
 *   execution budget, security policy (N.2). High-risk agent actions
 *   (financial, credential access, production deploy, DB modification,
 *   permission modification, bulk export, destructive ops, external comms,
 *   infra changes) require additional controls (N.3). An agent must never
 *   bypass the Security Engine because it is an AI system (N.4, Fail-Safe).
 * - Tool Security (O): every tool invocation must be evaluated (O.1);
 *   dangerous tools (shell exec, DB writes, infra changes, deployment,
 *   financial transactions, external messaging, bulk export) require
 *   stricter controls (O.3).
 *
 * Boundary (Section D.5): Phase 07 owns the agent operating system (agent
 * identity, lifecycle, execution runtime). This module does not duplicate
 * that ownership — it consumes Phase 07's `AgentDefinition` and evaluates
 * whether a specific agent action or tool invocation is *security*-permitted
 * right now, independent of whether Phase 07 considers the agent runtime
 * "ready" to attempt it. Phase 07 asks "can this agent attempt this?";
 * Phase 08 asks "is this action allowed to happen?". Both must agree.
 */

import type { AgentDefinition, AgentPermission } from "./agent-core";
import type { SecurityDecisionState } from "./security-core";

/* ─────────────────────────────────────────────────────────────
 * High-risk agent action categories (Section N.3)
 * ────────────────────────────────────────────────────────────*/

export type HighRiskAgentActionType =
  | "financial_operation"
  | "credential_access"
  | "production_deployment"
  | "database_modification"
  | "permission_modification"
  | "bulk_data_export"
  | "destructive_operation"
  | "external_communication"
  | "infrastructure_change";

export const HIGH_RISK_AGENT_ACTION_TYPES: readonly HighRiskAgentActionType[] = [
  "financial_operation",
  "credential_access",
  "production_deployment",
  "database_modification",
  "permission_modification",
  "bulk_data_export",
  "destructive_operation",
  "external_communication",
  "infrastructure_change",
] as const;

/* ─────────────────────────────────────────────────────────────
 * Dangerous tool categories (Section O.3)
 * ────────────────────────────────────────────────────────────*/

export type DangerousToolCategory =
  | "shell_execution"
  | "database_write"
  | "infrastructure_change"
  | "deployment"
  | "financial_transaction"
  | "external_messaging"
  | "bulk_export";

export const DANGEROUS_TOOL_CATEGORIES: readonly DangerousToolCategory[] = [
  "shell_execution",
  "database_write",
  "infrastructure_change",
  "deployment",
  "financial_transaction",
  "external_messaging",
  "bulk_export",
] as const;

export interface ToolDefinition {
  id: string;
  dangerousCategories: DangerousToolCategory[];
}

/* ─────────────────────────────────────────────────────────────
 * Agent security evaluation (Section N.2, N.4)
 * ────────────────────────────────────────────────────────────*/

export interface AgentSecurityEvaluationInput {
  agent: AgentDefinition;
  actionType: HighRiskAgentActionType | null;
  hasHumanApprovalContext: boolean;
}

export type AgentSecurityEvaluationResult =
  | { decision: "ALLOW"; reason: string }
  | { decision: "DENY"; reason: string }
  | { decision: "REVIEW"; reason: string };

/**
 * Evaluate whether a specific agent action is security-permitted.
 *
 * Fail-Safe rule (N.4): an agent must never bypass the Security Engine
 * because it is an AI system — this function does not grant any implicit
 * trust based on `agent.trustLevel` or `agent.riskClassification` alone;
 * those are Phase 07 runtime concepts. This evaluation is independent and
 * additive: even a "deployed" and "high-trust" agent (Phase 07) can still be
 * DENYed or sent to REVIEW here (Phase 08) for a specific high-risk action.
 */
export function evaluateAgentSecurity(
  input: AgentSecurityEvaluationInput,
): AgentSecurityEvaluationResult {
  // Agents without an active, deployed lifecycle state can never execute
  // security-relevant actions in production (fail closed).
  if (input.agent.lifecycleState !== "deployed" && input.agent.lifecycleState !== "monitoring") {
    return { decision: "DENY", reason: "Agent is not in a deployed/monitoring lifecycle state" };
  }
  if (input.agent.environment === "production" && input.actionType !== null) {
    // High-risk actions in production require explicit human approval
    // context regardless of the agent's own risk classification (N.3, N.4).
    if (!input.hasHumanApprovalContext) {
      return {
        decision: "REVIEW",
        reason: `High-risk action '${input.actionType}' requires human approval context (Section N.3)`,
      };
    }
  }
  return { decision: "ALLOW", reason: "Agent action passed security evaluation" };
}

/* ─────────────────────────────────────────────────────────────
 * Tool security evaluation (Section O.1, O.2, O.3)
 * ────────────────────────────────────────────────────────────*/

export interface ToolSecurityEvaluationInput {
  agent: AgentDefinition;
  tool: ToolDefinition;
  hasHumanApprovalContext: boolean;
}

export type ToolSecurityEvaluationResult =
  | { decision: "ALLOW"; reason: string }
  | { decision: "DENY"; reason: string }
  | { decision: "REVIEW"; reason: string };

/**
 * Every tool invocation must be evaluated (Section O.1). An agent's own
 * allow/deny tool lists (Phase 07) are necessary but not sufficient; this
 * function adds the Security Engine's independent evaluation for dangerous
 * tool categories (Section O.3).
 */
export function evaluateToolSecurity(
  input: ToolSecurityEvaluationInput,
): ToolSecurityEvaluationResult {
  // Phase 07 tool allow/deny lists must still be honored here; the Security
  // Engine does not override an explicit Phase 07 deny, but it may add
  // stricter controls on top of a Phase 07 allow.
  if (input.agent.deniedToolIds.includes(input.tool.id)) {
    return { decision: "DENY", reason: "Tool is on the agent's explicit deny list" };
  }
  if (!input.agent.allowedToolIds.includes(input.tool.id)) {
    return {
      decision: "DENY",
      reason: "Tool is not on the agent's explicit allow list (Section U)",
    };
  }
  if (input.tool.dangerousCategories.length > 0 && !input.hasHumanApprovalContext) {
    return {
      decision: "REVIEW",
      reason: `Dangerous tool categories [${input.tool.dangerousCategories.join(", ")}] require human approval (Section O.3)`,
    };
  }
  return { decision: "ALLOW", reason: "Tool invocation passed security evaluation" };
}

/* ─────────────────────────────────────────────────────────────
 * Acting-as-user permission check (bridges to Phase 07 AgentPermission)
 * ────────────────────────────────────────────────────────────*/

/**
 * When an agent acts on behalf of a user (Phase 07 `acting_as_user`
 * permission), the Security Engine must verify that permission was granted
 * explicitly, not inferred from the agent's general trust level (N.2, N.4).
 */
export function canActAsUser(permissions: AgentPermission[], userId: string): boolean {
  return permissions.some((p) => p.kind === "acting_as_user" && p.userId === userId);
}

/**
 * Map a tool/agent security evaluation outcome onto the Phase 08 canonical
 * SecurityDecisionState (Section F.2), so agent/tool decisions compose
 * cleanly with the rest of the Security Engine's decision contract.
 */
export function toSecurityDecisionState(
  outcome: "ALLOW" | "DENY" | "REVIEW",
): SecurityDecisionState {
  return outcome;
}
