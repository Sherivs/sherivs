/**
 * Versioned JARVIS risk-tier policy. It evaluates proposals only; execution
 * remains behind the existing governed worker, approval, and audit boundaries.
 */

import type { AgentRiskClassification } from "../agent-core";
import type { PlatformAgentAuthorityContext } from "../workforce/platform-agent-authority";

export const JARVIS_RISK_POLICY_VERSION = "1.0.0" as const;

export const JARVIS_RISK_TIERS = ["T0", "T1", "T2", "T3", "T4"] as const;
export type JarvisRiskTier = (typeof JARVIS_RISK_TIERS)[number];

export const JARVIS_RISK_TIER_POLICY = {
  observe_platform_state: "T0",
  inspect_mission_state: "T0",
  summarize_events: "T0",
  recommend_action: "T0",
  request_approval: "T1",
  coordinate_workers: "T1",
  initiate_governed_mission: "T1",
  send_customer_communications: "T2",
  change_platform_configuration: "T2",
  issue_refund_under_threshold: "T2",
  invite_privileged_staff: "T3",
  suspend_organization: "T3",
  change_subscription: "T3",
  export_tenant_data: "T3",
  mutate_production_database: "T3",
  deploy_production: "T3",
  access_secrets: "T3",
  spend_money: "T3",
  delete_audit_records: "T4",
  disable_guardrails: "T4",
  mix_cross_tenant_data: "T4",
} as const satisfies Readonly<Record<string, JarvisRiskTier>>;

export type JarvisRiskActionId = keyof typeof JARVIS_RISK_TIER_POLICY;

export interface JarvisHumanApprovalEvidence {
  readonly approvalId: string;
  readonly actionId: string;
  readonly actionRef: string;
  readonly agentDefinitionId: string;
  readonly platformRef: string;
  readonly decision: "approved";
  readonly identityKind: "human";
  readonly humanIdentityVerified: boolean;
  readonly approverId: string;
  readonly approverRole: "platform_staff" | "sheriff";
  readonly channel: "console";
  readonly passkeyStepUpVerified: boolean;
  readonly recordedAt: string;
  readonly expiresAt: string;
  /** The approval is fetched and checked again immediately before execution. */
  readonly revalidatedAt: string;
}

export type JarvisPolicyDecision =
  | {
      readonly decision: "allow";
      readonly policyVersion: typeof JARVIS_RISK_POLICY_VERSION;
      readonly actionId: string;
      readonly actionRef: string;
      readonly riskTier: JarvisRiskTier;
      readonly approvalId: string | null;
      readonly reason: string;
    }
  | {
      readonly decision: "require_approval";
      readonly policyVersion: typeof JARVIS_RISK_POLICY_VERSION;
      readonly actionId: string;
      readonly actionRef: string;
      readonly riskTier: JarvisRiskTier;
      readonly reason: string;
    }
  | {
      readonly decision: "deny";
      readonly policyVersion: typeof JARVIS_RISK_POLICY_VERSION;
      readonly actionId: string;
      readonly actionRef: string;
      readonly riskTier: JarvisRiskTier | null;
      readonly code: string;
      readonly reason: string;
    };

const RISK_CLASS_FOR_TIER: Readonly<Record<JarvisRiskTier, AgentRiskClassification>> = {
  T0: "low",
  T1: "low",
  T2: "medium",
  T3: "high",
  T4: "critical",
};

const RISK_CLASS_RANK: Readonly<Record<AgentRiskClassification, number>> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

function deny(
  actionId: string,
  actionRef: string,
  riskTier: JarvisRiskTier | null,
  code: string,
  reason: string,
): JarvisPolicyDecision {
  return {
    decision: "deny",
    policyVersion: JARVIS_RISK_POLICY_VERSION,
    actionId,
    actionRef,
    riskTier,
    code,
    reason,
  };
}

function authorityIsFresh(
  value: unknown,
  evaluatedAt: number,
): value is PlatformAgentAuthorityContext {
  if (value === null || typeof value !== "object") return false;
  const authority = value as PlatformAgentAuthorityContext;
  if (
    authority.scope === null ||
    typeof authority.scope !== "object" ||
    typeof authority.definitionId !== "string" ||
    authority.definitionId.trim().length === 0 ||
    typeof authority.identityRef !== "string" ||
    authority.identityRef.trim().length === 0 ||
    typeof authority.grantId !== "string" ||
    authority.grantId.trim().length === 0 ||
    typeof authority.resolvedAt !== "string" ||
    typeof authority.grantExpiresAt !== "string" ||
    !Array.isArray(authority.capabilities) ||
    authority.capabilities.some(
      (capability) =>
        capability === null ||
        typeof capability !== "object" ||
        typeof capability.capabilityId !== "string",
    ) ||
    !Object.hasOwn(RISK_CLASS_RANK, authority.maxRiskClass) ||
    !Number.isFinite(Date.parse(authority.resolvedAt)) ||
    !Number.isFinite(Date.parse(authority.grantExpiresAt))
  ) {
    return false;
  }
  return (
    authority.classification === "ai" &&
    authority.lifecycle === "active" &&
    authority.scope.kind === "platform" &&
    authority.scope.platformRef === "coregrid" &&
    authority.scope.resourceScope === "platform:control-plane" &&
    authority.scope.tenantRef === null &&
    Date.parse(authority.resolvedAt) === evaluatedAt &&
    Date.parse(authority.grantExpiresAt) > evaluatedAt
  );
}

function approvalIsValid(
  approval: JarvisHumanApprovalEvidence | undefined,
  actionId: string,
  actionRef: string,
  authority: PlatformAgentAuthorityContext,
  tier: "T2" | "T3",
  evaluatedAt: number,
): boolean {
  const recordedAt = Date.parse(approval?.recordedAt ?? "");
  const expiresAt = Date.parse(approval?.expiresAt ?? "");
  const revalidatedAt = Date.parse(approval?.revalidatedAt ?? "");
  if (
    approval === undefined ||
    typeof approval.approvalId !== "string" ||
    approval.approvalId.trim().length === 0 ||
    approval.decision !== "approved" ||
    approval.identityKind !== "human" ||
    approval.humanIdentityVerified !== true ||
    approval.channel !== "console" ||
    approval.actionId !== actionId ||
    approval.actionRef !== actionRef ||
    approval.agentDefinitionId !== authority.definitionId ||
    approval.platformRef !== authority.scope.platformRef ||
    typeof approval.approverId !== "string" ||
    approval.approverId.trim().length === 0 ||
    approval.approverId === authority.identityRef ||
    !Number.isFinite(recordedAt) ||
    recordedAt > evaluatedAt ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= evaluatedAt ||
    !Number.isFinite(revalidatedAt) ||
    revalidatedAt !== evaluatedAt
  ) {
    return false;
  }
  if (tier === "T3") {
    return approval.approverRole === "sheriff" && approval.passkeyStepUpVerified === true;
  }
  return approval.approverRole === "platform_staff" || approval.approverRole === "sheriff";
}

export function evaluateJarvisRiskPolicy(input: {
  readonly actionId: string;
  /** Stable proposal/resource digest; approvals bind to this exact operation. */
  readonly actionRef: string;
  readonly phase: "proposal" | "execution";
  readonly evaluatedAt: string;
  readonly authority: PlatformAgentAuthorityContext;
  readonly approval?: JarvisHumanApprovalEvidence;
}): JarvisPolicyDecision {
  const actionId = typeof input.actionId === "string" ? input.actionId : "";
  const actionRef = typeof input.actionRef === "string" ? input.actionRef : "";
  const hasPolicy = Object.hasOwn(JARVIS_RISK_TIER_POLICY, actionId);
  const tier = hasPolicy ? JARVIS_RISK_TIER_POLICY[actionId as JarvisRiskActionId] : null;

  if (tier === null) {
    return deny(
      actionId,
      actionRef,
      null,
      "unknown_action",
      "Action is unmapped; policy fails closed",
    );
  }
  if (tier === "T4") {
    return deny(actionId, actionRef, tier, "forbidden_tier", "T4 actions are always denied");
  }
  if (actionRef.trim().length === 0) {
    return deny(
      actionId,
      actionRef,
      tier,
      "invalid_action_ref",
      "A stable action reference is required",
    );
  }
  if (input.phase !== "proposal" && input.phase !== "execution") {
    return deny(
      actionId,
      actionRef,
      tier,
      "invalid_decision_phase",
      "A recognized decision phase is required",
    );
  }

  const evaluatedAt =
    typeof input.evaluatedAt === "string" ? Date.parse(input.evaluatedAt) : Number.NaN;
  if (!Number.isFinite(evaluatedAt)) {
    return deny(
      actionId,
      actionRef,
      tier,
      "invalid_decision_time",
      "A valid decision time is required",
    );
  }
  if (!authorityIsFresh(input.authority, evaluatedAt)) {
    return deny(
      actionId,
      actionRef,
      tier,
      "authority_unavailable_or_stale",
      "Platform worker authority and delegation must be revalidated for this decision",
    );
  }

  const capability = input.authority.capabilities.find(
    (registered) => registered.capabilityId === actionId,
  );
  const requiredRiskClass = RISK_CLASS_FOR_TIER[tier];
  if (
    capability === undefined ||
    capability.riskClass !== requiredRiskClass ||
    RISK_CLASS_RANK[capability.riskClass] > RISK_CLASS_RANK[input.authority.maxRiskClass]
  ) {
    return deny(
      actionId,
      actionRef,
      tier,
      "capability_or_risk_unregistered",
      "The action is not covered by a registered, delegated capability within the worker risk ceiling",
    );
  }

  if (tier === "T0" || tier === "T1") {
    return {
      decision: "allow",
      policyVersion: JARVIS_RISK_POLICY_VERSION,
      actionId,
      actionRef,
      riskTier: tier,
      approvalId: null,
      reason: `${tier} action is within the active platform delegation`,
    };
  }
  if (input.phase === "proposal") {
    return {
      decision: "require_approval",
      policyVersion: JARVIS_RISK_POLICY_VERSION,
      actionId,
      actionRef,
      riskTier: tier,
      reason: `${tier} action must be approved in the console before execution`,
    };
  }
  if (!approvalIsValid(input.approval, actionId, actionRef, input.authority, tier, evaluatedAt)) {
    return deny(
      actionId,
      actionRef,
      tier,
      tier === "T3" ? "sheriff_passkey_approval_required" : "human_approval_required",
      "A current, action-bound console approval is required at execution time",
    );
  }
  return {
    decision: "allow",
    policyVersion: JARVIS_RISK_POLICY_VERSION,
    actionId,
    actionRef,
    riskTier: tier,
    approvalId: input.approval?.approvalId ?? null,
    reason: `${tier} action has a current recorded human console approval`,
  };
}
