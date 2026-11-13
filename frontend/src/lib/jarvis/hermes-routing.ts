/**
 * JARVIS routing through the existing Hermes coordinator (SV1-JARVIS-05).
 *
 * There is no second agent runtime: every routed action is classified by the
 * existing `classifyHermesAction` (Hermes' fail-closed policy gate) and is also
 * checked against its playbook (JARVIS-04). The stricter outcome wins. This
 * module is pure; it starts no loop, timer, worker or I/O.
 *
 * Controls:
 * - Kill switch: checked first; while engaged every request is denied
 *   immediately and consumes nothing. Anyone may engage it (the safe
 *   direction); only a verified human sheriff with passkey step-up may release.
 * - Budget: a per-window cap on routed requests (denials included, so a runaway
 *   loop is stopped) and on escalations. At the cap everything is denied.
 */

import { classifyHermesAction } from "../hermes/hermes-classifier";
import type { HermesActionClass, HermesClassifierVerdict } from "../hermes/hermes-contract";
import {
  decidePlaybookAction,
  JARVIS_PLAYBOOKS,
  type EscalationApprover,
  type Playbook,
  type PlaybookWorkspaceId,
} from "./playbooks";
import {
  JARVIS_RISK_POLICY_VERSION,
  JARVIS_RISK_TIER_POLICY,
  type JarvisRiskActionId,
  type JarvisRiskTier,
} from "./risk-policy";

/**
 * How each JARVIS action is expressed to Hermes. Reads and recommendations are
 * recorded observability acts; requesting approval is human escalation;
 * coordination and mission initiation use the repair-intent path (so Hermes'
 * critical-action check applies to the underlying action); everything T2/T3 is a
 * critical action that Hermes always routes to a human.
 */
export const JARVIS_TO_HERMES_CLASS: Readonly<Record<JarvisRiskActionId, HermesActionClass>> = {
  observe_platform_state: "record_cycle_memory",
  inspect_mission_state: "record_cycle_memory",
  summarize_events: "record_cycle_memory",
  recommend_action: "record_cycle_memory",
  request_approval: "escalate_to_human",
  coordinate_workers: "open_repair_intent",
  initiate_governed_mission: "open_repair_intent",
  send_customer_communications: "execute_critical_action",
  change_platform_configuration: "execute_critical_action",
  issue_refund_under_threshold: "execute_critical_action",
  invite_privileged_staff: "execute_critical_action",
  suspend_organization: "execute_critical_action",
  change_subscription: "execute_critical_action",
  export_tenant_data: "execute_critical_action",
  mutate_production_database: "execute_critical_action",
  deploy_production: "deploy",
  access_secrets: "execute_critical_action",
  spend_money: "execute_critical_action",
  delete_audit_records: "delete_data",
  disable_guardrails: "modify_governance",
  mix_cross_tenant_data: "purge_production_state",
};

export interface RoutingBudget {
  readonly windowStartedAt: string;
  readonly windowMs: number;
  readonly maxRequests: number;
  readonly maxEscalations: number;
  readonly requests: number;
  readonly escalations: number;
}

export interface KillSwitch {
  readonly engaged: boolean;
  readonly engagedBy: string | null;
  readonly engagedAt: string | null;
}

export interface RoutingControls {
  readonly killSwitch: KillSwitch;
  readonly budget: RoutingBudget;
}

export function createRoutingControls(input: {
  readonly now: string;
  readonly windowMs: number;
  readonly maxRequests: number;
  readonly maxEscalations: number;
}): RoutingControls {
  return {
    killSwitch: { engaged: false, engagedBy: null, engagedAt: null },
    budget: {
      windowStartedAt: input.now,
      windowMs: input.windowMs,
      maxRequests: input.maxRequests,
      maxEscalations: input.maxEscalations,
      requests: 0,
      escalations: 0,
    },
  };
}

export function engageKillSwitch(
  controls: RoutingControls,
  actorRef: string,
  now: string,
): RoutingControls {
  if (controls.killSwitch.engaged) return controls;
  return {
    ...controls,
    killSwitch: {
      engaged: true,
      engagedBy: typeof actorRef === "string" && actorRef.trim() !== "" ? actorRef : "unknown",
      engagedAt: now,
    },
  };
}

export type ReleaseResult =
  | { readonly ok: true; readonly controls: RoutingControls }
  | {
      readonly ok: false;
      readonly code: "human_sheriff_passkey_required";
      readonly controls: RoutingControls;
    };

export function releaseKillSwitch(
  controls: RoutingControls,
  actor: {
    readonly identityKind: "human" | "ai";
    readonly humanIdentityVerified: boolean;
    readonly role: "platform_staff" | "sheriff";
    readonly passkeyStepUpVerified: boolean;
  },
): ReleaseResult {
  if (
    actor.identityKind !== "human" ||
    actor.humanIdentityVerified !== true ||
    actor.role !== "sheriff" ||
    actor.passkeyStepUpVerified !== true
  ) {
    return { ok: false, code: "human_sheriff_passkey_required", controls };
  }
  return {
    ok: true,
    controls: { ...controls, killSwitch: { engaged: false, engagedBy: null, engagedAt: null } },
  };
}

export interface RouteRequest {
  readonly requestId: string;
  readonly playbookId: string;
  readonly actionId: string;
  readonly actionRef: string;
}

export type RouteDenyCode =
  | "invalid_request"
  | "kill_switch_engaged"
  | "budget_exhausted"
  | "unknown_playbook"
  | "invalid_playbook"
  | "not_declared"
  | "hermes_denied";

export type RouteDecision =
  | {
      readonly decision: "allow";
      readonly workspace: PlaybookWorkspaceId;
      readonly tier: JarvisRiskTier;
      readonly hermes: HermesClassifierVerdict;
    }
  | {
      readonly decision: "escalate";
      readonly workspace: PlaybookWorkspaceId;
      readonly tier: JarvisRiskTier;
      readonly approver: EscalationApprover;
      readonly hermes: HermesClassifierVerdict;
    }
  | {
      readonly decision: "deny";
      readonly code: RouteDenyCode;
      readonly workspace: PlaybookWorkspaceId | null;
      readonly tier: JarvisRiskTier | null;
      readonly hermes: HermesClassifierVerdict | null;
    };

export interface RouteLogEntry {
  readonly at: string;
  readonly workspace: PlaybookWorkspaceId | null;
  readonly decision: RouteDecision["decision"];
  readonly tier: JarvisRiskTier | null;
  readonly code: RouteDenyCode | null;
}

export interface RouteResult {
  readonly policyVersion: typeof JARVIS_RISK_POLICY_VERSION;
  readonly result: RouteDecision;
  readonly controls: RoutingControls;
  readonly log: RouteLogEntry;
}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

function rolledBudget(budget: RoutingBudget, now: number): RoutingBudget {
  const started = Date.parse(budget.windowStartedAt);
  if (Number.isFinite(started) && now >= started + budget.windowMs) {
    return { ...budget, windowStartedAt: new Date(now).toISOString(), requests: 0, escalations: 0 };
  }
  return budget;
}

export function routeJarvisAction(
  request: RouteRequest,
  controls: RoutingControls,
  now: string,
  playbooks: readonly Playbook[] = JARVIS_PLAYBOOKS,
): RouteResult {
  const finish = (
    result: RouteDecision,
    next: RoutingControls,
    workspace: PlaybookWorkspaceId | null,
  ): RouteResult => ({
    policyVersion: JARVIS_RISK_POLICY_VERSION,
    result,
    controls: next,
    log: {
      at: now,
      workspace,
      decision: result.decision,
      tier: result.tier,
      code: result.decision === "deny" ? result.code : null,
    },
  });
  const deny = (
    code: RouteDenyCode,
    next: RoutingControls,
    workspace: PlaybookWorkspaceId | null = null,
    tier: JarvisRiskTier | null = null,
    hermes: HermesClassifierVerdict | null = null,
  ): RouteResult => finish({ decision: "deny", code, workspace, tier, hermes }, next, workspace);

  const nowMs = Date.parse(now);
  if (
    !Number.isFinite(nowMs) ||
    !nonEmpty(request?.requestId) ||
    !nonEmpty(request?.playbookId) ||
    !nonEmpty(request?.actionId) ||
    !nonEmpty(request?.actionRef)
  ) {
    return deny("invalid_request", controls);
  }
  // 1. Kill switch halts routing immediately and consumes nothing.
  if (controls.killSwitch.engaged) return deny("kill_switch_engaged", controls);

  // 2. Budget: every routed request counts (denials too), so loops stop.
  const budget = rolledBudget(controls.budget, nowMs);
  if (budget.requests >= budget.maxRequests) {
    return deny("budget_exhausted", { ...controls, budget });
  }
  const counted: RoutingBudget = { ...budget, requests: budget.requests + 1 };
  const next = (b: RoutingBudget): RoutingControls => ({ ...controls, budget: b });

  // 3. Playbook declaration.
  const playbook = playbooks.find((p) => p.id === request.playbookId);
  const workspace = playbook?.workspace ?? null;
  const declared = decidePlaybookAction(request.playbookId, request.actionId, playbooks);
  if (declared.decision === "deny") return deny(declared.code, next(counted), workspace);

  // 4. Hermes classification (the only policy gate for the action class).
  const actionId = request.actionId as JarvisRiskActionId;
  const tier = JARVIS_RISK_TIER_POLICY[actionId];
  const hermes = classifyHermesAction({
    actionClass: JARVIS_TO_HERMES_CLASS[actionId],
    underlyingAction: request.actionId,
  });
  if (hermes.decision === "DENY") {
    return deny("hermes_denied", next(counted), workspace, tier, hermes);
  }

  // Stricter outcome wins.
  const mustEscalate = declared.decision === "escalate" || hermes.decision === "REQUIRE_APPROVAL";
  if (mustEscalate) {
    if (counted.escalations >= counted.maxEscalations) {
      return deny("budget_exhausted", next(counted), workspace, tier, hermes);
    }
    const approver: EscalationApprover =
      declared.decision === "escalate"
        ? declared.approver
        : tier === "T3"
          ? "sheriff"
          : "platform_staff";
    return finish(
      { decision: "escalate", workspace: workspace as PlaybookWorkspaceId, tier, approver, hermes },
      next({ ...counted, escalations: counted.escalations + 1 }),
      workspace,
    );
  }
  return finish(
    { decision: "allow", workspace: workspace as PlaybookWorkspaceId, tier, hermes },
    next(counted),
    workspace,
  );
}
