import type { WorkflowAutonomyLevel } from "./workflow-runtime";

export const WORKFLOW_ACTION_KINDS = [
  "email",
  "in_app",
  "whatsapp",
  "sms",
  "task",
  "wait",
  "webhook",
] as const;

export type WorkflowActionKind = (typeof WORKFLOW_ACTION_KINDS)[number];

export const WORKFLOW_AUTONOMY_LEVELS = [
  "suggest",
  "draft",
  "act_with_approval",
  "act_and_report",
] as const;

export const WORKFLOW_ACTION_CATEGORY_CAPS = Object.freeze({
  money_movement: "draft",
  safeguarding: "draft",
  credential_change: "draft",
  public_publish: "draft",
  mass_message: "draft",
  external_authority_share: "draft",
} as const satisfies Readonly<Record<string, WorkflowAutonomyLevel>>);

export const WORKFLOW_MASS_RECIPIENT_THRESHOLD = 25;

const AUTONOMY_RANK: Readonly<Record<WorkflowAutonomyLevel, number>> = {
  suggest: 0,
  draft: 1,
  act_with_approval: 2,
  act_and_report: 3,
};

const EFFECTFUL_WORKFLOW_ACTIONS = new Set<WorkflowActionKind>([
  "email",
  "in_app",
  "whatsapp",
  "sms",
  "webhook",
]);

export function effectiveWorkflowAutonomy(input: {
  template: WorkflowAutonomyLevel;
  tenant: WorkflowAutonomyLevel;
  agent: WorkflowAutonomyLevel;
  actionClass: string;
}): WorkflowAutonomyLevel {
  const lowest = [input.template, input.tenant, input.agent].reduce((effective, level) =>
    AUTONOMY_RANK[level] < AUTONOMY_RANK[effective] ? level : effective,
  );
  const categoryCap =
    WORKFLOW_ACTION_CATEGORY_CAPS[input.actionClass as keyof typeof WORKFLOW_ACTION_CATEGORY_CAPS];
  const cap = categoryCap ?? (input.actionClass === "internal" ? "act_and_report" : "draft");
  return AUTONOMY_RANK[lowest] > AUTONOMY_RANK[cap] ? cap : lowest;
}

export function isWorkflowMassCommunication(input: {
  recipientCount: number;
  hasAudienceSelector: boolean;
}): boolean {
  return (
    !Number.isInteger(input.recipientCount) ||
    input.recipientCount < 0 ||
    input.recipientCount > WORKFLOW_MASS_RECIPIENT_THRESHOLD ||
    input.hasAudienceSelector
  );
}

export function isWorkflowEffectfulAction(kind: WorkflowActionKind): boolean {
  return EFFECTFUL_WORKFLOW_ACTIONS.has(kind);
}

export type WorkflowDeliveryMode = "off" | "sandbox" | "live";

export interface WorkflowDeliveryEnvironment {
  WORKFLOW_DELIVERY_MODE?: string;
  WORKFLOWS_ENABLED?: string;
  APP_ENV?: string;
}

export interface WorkflowDeliveryGateInput {
  env: WorkflowDeliveryEnvironment;
  orgWorkflowsEnabled: boolean;
  kind: WorkflowActionKind;
}

export type WorkflowDeliveryGate =
  | { allowed: true; mode: WorkflowDeliveryMode }
  | {
      allowed: false;
      mode: "off";
      reason:
        | "delivery_off"
        | "global_workflows_disabled"
        | "organization_workflows_disabled"
        | "live_requires_production";
    };

export function parseWorkflowDeliveryMode(value: string | undefined): WorkflowDeliveryMode {
  if (value === "sandbox" || value === "live") return value;
  return "off";
}

export function workflowDeliveryGate(input: WorkflowDeliveryGateInput): WorkflowDeliveryGate {
  if (!isWorkflowEffectfulAction(input.kind)) return { allowed: true, mode: "sandbox" };

  const requested = parseWorkflowDeliveryMode(input.env.WORKFLOW_DELIVERY_MODE);
  if (requested === "off") return { allowed: false, mode: "off", reason: "delivery_off" };
  if (input.env.WORKFLOWS_ENABLED !== "true") {
    return { allowed: false, mode: "off", reason: "global_workflows_disabled" };
  }
  if (input.orgWorkflowsEnabled !== true) {
    return { allowed: false, mode: "off", reason: "organization_workflows_disabled" };
  }
  if (requested === "live" && input.env.APP_ENV !== "production") {
    return { allowed: false, mode: "off", reason: "live_requires_production" };
  }
  return { allowed: true, mode: requested };
}

export function workflowActionHasMoneyEffect(effect: string): boolean {
  return effect === "money" || effect === "money_movement";
}
