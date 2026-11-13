/**
 * JARVIS bounded internal role playbooks (SV1-JARVIS-04).
 *
 * Five playbooks map onto the six V1 console workspaces; the Personal
 * Workspace has no agent playbook (no external mutation tools). A playbook is
 * pure data plus a decision function. It declares:
 * - `direct`: T0/T1 actions the agent may take within its delegation,
 * - `escalated`: T2/T3 actions the agent may only *propose*; each goes through
 *   the approval inbox (ADR-036) with the stated approver role,
 * - an escalation path for approvals.
 * Anything undeclared is denied, T4 is never declarable, and a playbook can
 * never carry a standing credential. Playbooks reuse the existing capability
 * registry contract; they add no role engine and no agent runtime.
 */

import type { CapabilityRegistrationInput } from "../workforce/capability-registry";
import {
  JARVIS_RISK_TIER_POLICY,
  type JarvisRiskActionId,
  type JarvisRiskTier,
} from "./risk-policy";

export const PLAYBOOK_WORKSPACES = [
  "platform_operations",
  "platform_administration",
  "operations",
  "engineering",
  "support",
] as const;
export type PlaybookWorkspaceId = (typeof PLAYBOOK_WORKSPACES)[number];

export type EscalationApprover = "platform_staff" | "sheriff";

export interface EscalatedAction {
  readonly actionId: JarvisRiskActionId;
  readonly approver: EscalationApprover;
}

export interface Playbook {
  readonly id: string;
  readonly workspace: PlaybookWorkspaceId;
  readonly title: string;
  readonly purpose: string;
  readonly direct: readonly JarvisRiskActionId[];
  readonly escalated: readonly EscalatedAction[];
  /** Ladder for pending approvals; the console inbox is always first. */
  readonly escalationPath: readonly ["console_inbox", "whatsapp", "voice"];
  /** Agents hold no standing privileged credentials; access is brokered per action. */
  readonly credentials: "none";
}

const PATH = ["console_inbox", "whatsapp", "voice"] as const;

const READ_ONLY = [
  "observe_platform_state",
  "inspect_mission_state",
  "summarize_events",
  "recommend_action",
] as const satisfies readonly JarvisRiskActionId[];

export const JARVIS_PLAYBOOKS: readonly Playbook[] = [
  {
    id: "playbook.platform_operations",
    workspace: "platform_operations",
    title: "Platform Operations",
    purpose:
      "Read-only organization lifecycle, onboarding attention and verified health summaries; any mutation is escalated.",
    direct: [...READ_ONLY, "request_approval", "coordinate_workers"],
    escalated: [
      { actionId: "suspend_organization", approver: "sheriff" },
      { actionId: "change_subscription", approver: "sheriff" },
    ],
    escalationPath: PATH,
    credentials: "none",
  },
  {
    id: "playbook.platform_administration",
    workspace: "platform_administration",
    title: "Platform Administration",
    purpose:
      "Review staff capabilities and invitations; role grants and privileged invitations are proposals for human approval. Never grants super-admin.",
    direct: [...READ_ONLY, "request_approval"],
    escalated: [{ actionId: "invite_privileged_staff", approver: "sheriff" }],
    escalationPath: PATH,
    credentials: "none",
  },
  {
    id: "playbook.operations",
    workspace: "operations",
    title: "Operations",
    purpose:
      "Onboarding submissions, permitted state transitions and provisioning follow-up; activation or suspension is escalated.",
    direct: [...READ_ONLY, "request_approval", "initiate_governed_mission", "coordinate_workers"],
    escalated: [
      { actionId: "send_customer_communications", approver: "platform_staff" },
      { actionId: "suspend_organization", approver: "sheriff" },
    ],
    escalationPath: PATH,
    credentials: "none",
  },
  {
    id: "playbook.engineering",
    workspace: "engineering",
    title: "Engineering",
    purpose:
      "Verified health, runtime availability and provisioning diagnostics. No secrets, no deploys; configuration changes are escalated.",
    direct: [...READ_ONLY, "request_approval"],
    escalated: [{ actionId: "change_platform_configuration", approver: "platform_staff" }],
    escalationPath: PATH,
    credentials: "none",
  },
  {
    id: "playbook.support",
    workspace: "support",
    title: "Support",
    purpose:
      "Assigned-organization onboarding, invitation and access issues using aggregates only; data access beyond aggregates is escalated.",
    direct: [...READ_ONLY, "request_approval"],
    escalated: [
      { actionId: "send_customer_communications", approver: "platform_staff" },
      { actionId: "export_tenant_data", approver: "sheriff" },
    ],
    escalationPath: PATH,
    credentials: "none",
  },
];

/** Actions no playbook may ever declare, direct or escalated. */
export const PLAYBOOK_NEVER_DECLARABLE: readonly JarvisRiskActionId[] = [
  "access_secrets",
  "deploy_production",
  "mutate_production_database",
  "spend_money",
];

const tierOf = (actionId: string): JarvisRiskTier | null =>
  Object.hasOwn(JARVIS_RISK_TIER_POLICY, actionId)
    ? JARVIS_RISK_TIER_POLICY[actionId as JarvisRiskActionId]
    : null;

/** Structural check; returns every problem found (empty means valid). */
export function validatePlaybook(playbook: Playbook): readonly string[] {
  const problems: string[] = [];
  if (playbook.credentials !== "none") problems.push("standing credentials are not allowed");
  if (!PLAYBOOK_WORKSPACES.includes(playbook.workspace)) problems.push("unknown workspace");
  if (playbook.escalationPath[0] !== "console_inbox") {
    problems.push("escalation must start at the console inbox");
  }
  const seen = new Set<string>();
  for (const actionId of playbook.direct) {
    const tier = tierOf(actionId);
    if (tier === null) problems.push(`unmapped direct action ${actionId}`);
    else if (tier !== "T0" && tier !== "T1") problems.push(`direct action ${actionId} is ${tier}`);
    if (seen.has(actionId)) problems.push(`duplicate action ${actionId}`);
    seen.add(actionId);
  }
  for (const item of playbook.escalated) {
    const tier = tierOf(item.actionId);
    if (tier === null) problems.push(`unmapped escalated action ${item.actionId}`);
    else if (tier !== "T2" && tier !== "T3") {
      problems.push(`escalated action ${item.actionId} is ${tier}`);
    } else if (tier === "T3" && item.approver !== "sheriff") {
      problems.push(`T3 action ${item.actionId} requires the sheriff`);
    }
    if (seen.has(item.actionId)) problems.push(`duplicate action ${item.actionId}`);
    seen.add(item.actionId);
  }
  for (const banned of PLAYBOOK_NEVER_DECLARABLE) {
    if (seen.has(banned)) problems.push(`never-declarable action ${banned}`);
  }
  return problems;
}

export type PlaybookDecision =
  | { readonly decision: "allow"; readonly actionId: string; readonly tier: JarvisRiskTier }
  | {
      readonly decision: "escalate";
      readonly actionId: string;
      readonly tier: JarvisRiskTier;
      readonly approver: EscalationApprover;
    }
  | {
      readonly decision: "deny";
      readonly actionId: string;
      readonly code: "unknown_playbook" | "invalid_playbook" | "not_declared";
    };

/**
 * Decide what a playbook permits for an action. This is the declaration check
 * only; the risk policy and approval inbox still apply to anything allowed or
 * escalated here.
 */
export function decidePlaybookAction(
  playbookId: string,
  actionId: string,
  playbooks: readonly Playbook[] = JARVIS_PLAYBOOKS,
): PlaybookDecision {
  const playbook = playbooks.find((p) => p.id === playbookId);
  if (playbook === undefined) return { decision: "deny", actionId, code: "unknown_playbook" };
  if (validatePlaybook(playbook).length > 0) {
    return { decision: "deny", actionId, code: "invalid_playbook" };
  }
  const tier = tierOf(actionId);
  if (tier !== null && playbook.direct.includes(actionId as JarvisRiskActionId)) {
    return { decision: "allow", actionId, tier };
  }
  const escalated = playbook.escalated.find((e) => e.actionId === actionId);
  if (tier !== null && escalated !== undefined) {
    return { decision: "escalate", actionId, tier, approver: escalated.approver };
  }
  return { decision: "deny", actionId, code: "not_declared" };
}

const RISK_CLASS: Readonly<Record<JarvisRiskTier, CapabilityRegistrationInput["riskClass"]>> = {
  T0: "low",
  T1: "low",
  T2: "medium",
  T3: "high",
  T4: "critical",
};

/** Capability registrations for the existing capability registry, one per declared action. */
export function playbookCapabilityRegistrations(
  playbook: Playbook,
): readonly CapabilityRegistrationInput[] {
  const ids = [...playbook.direct, ...playbook.escalated.map((e) => e.actionId)];
  return ids.map((capabilityId) => ({
    capabilityId,
    contract: `${playbook.title} playbook: ${capabilityId}`,
    riskClass: RISK_CLASS[JARVIS_RISK_TIER_POLICY[capabilityId]],
    evidenceRequirements: ["policy-decision"],
  }));
}
