import { z } from "zod";
import { EgressAllowlist } from "../ai-gateway/egress-allowlist";

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

export const workflowActionDefinitionSchema = z
  .strictObject({
    kind: z.enum(WORKFLOW_ACTION_KINDS),
    templateRef: z
      .string()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/)
      .optional(),
    templateParams: z
      .record(
        z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
        z.union([z.string().max(512), z.number().finite(), z.boolean()]),
      )
      .default({}),
    recipientIds: z
      .array(z.string().uuid())
      .max(500)
      .refine((ids) => new Set(ids).size === ids.length)
      .default([]),
    audienceSelector: z.enum(["whole_class", "all_guardians", "all_staff"]).optional(),
    dataClass: z.string().max(64).optional(),
    targetUrl: z.string().url().max(2048).optional(),
  })
  .refine(
    (action) =>
      !["email", "whatsapp", "sms", "in_app"].includes(action.kind) || !!action.templateRef,
  )
  .refine((action) => action.kind !== "webhook" || !!action.targetUrl)
  .refine(
    (action) =>
      !Object.keys(action.templateParams).some((key) =>
        ["body", "message", "text", "html", "subject", "to", "email", "phone", "url"].includes(
          key.toLowerCase(),
        ),
      ),
  );

export type WorkflowActionDefinition = z.infer<typeof workflowActionDefinitionSchema>;

export function workflowActionDefinitionIsValid(
  candidate: unknown,
): candidate is WorkflowActionDefinition {
  return workflowActionDefinitionSchema.safeParse(candidate).success;
}

export const WORKFLOW_AUTONOMY_LEVELS = [
  "suggest",
  "draft",
  "act_with_approval",
  "act_and_report",
] as const;

export type WorkflowAutonomyLevel = (typeof WORKFLOW_AUTONOMY_LEVELS)[number];

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
const WORKFLOW_ACTION_AUTONOMY_CEILINGS: Readonly<Record<string, WorkflowAutonomyLevel>> = {
  internal: "act_and_report",
  communication: "act_and_report",
  task: "act_and_report",
  wait: "act_and_report",
};
const hasOwnCategory = (
  record: Readonly<Record<string, WorkflowAutonomyLevel>>,
  category: string,
) => Object.prototype.hasOwnProperty.call(record, category);

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
  const categoryCap = hasOwnCategory(WORKFLOW_ACTION_CATEGORY_CAPS, input.actionClass)
    ? WORKFLOW_ACTION_CATEGORY_CAPS[input.actionClass as keyof typeof WORKFLOW_ACTION_CATEGORY_CAPS]
    : hasOwnCategory(WORKFLOW_ACTION_AUTONOMY_CEILINGS, input.actionClass)
      ? WORKFLOW_ACTION_AUTONOMY_CEILINGS[input.actionClass]!
      : "draft";
  return AUTONOMY_RANK[lowest] > AUTONOMY_RANK[categoryCap] ? categoryCap : lowest;
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

export function isWorkflowConfidentialDataClass(dataClass: string | undefined): boolean {
  const normalized = dataClass
    ?.trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
  return normalized === "confidential" || normalized === "minor-sensitive";
}

export function workflowActionCategory(input: {
  actionClass: string;
  recipientCount: number;
  hasAudienceSelector: boolean;
  dataClass?: string;
}): string {
  if (
    isWorkflowMassCommunication({
      recipientCount: input.recipientCount,
      hasAudienceSelector: input.hasAudienceSelector,
    }) ||
    isWorkflowConfidentialDataClass(input.dataClass)
  ) {
    return "mass_message";
  }
  return input.actionClass;
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

export function isWorkflowWebhookTargetAllowed(input: {
  targetUrl: string;
  registeredTargetUrl: string | null;
  now?: () => string;
}): boolean {
  if (!input.registeredTargetUrl || input.targetUrl !== input.registeredTargetUrl) return false;
  let pathname: string;
  try {
    pathname = new URL(input.registeredTargetUrl).pathname;
  } catch {
    return false;
  }
  try {
    const allowlist = new EgressAllowlist({
      bindings: [
        {
          providerClass: "workflow-webhook",
          endpoint: input.registeredTargetUrl,
          pathPrefix: pathname,
          methods: ["POST"],
        },
      ],
      ...(input.now ? { now: input.now } : {}),
    });
    return (
      allowlist.decide({
        url: input.targetUrl,
        method: "POST",
        providerClass: "workflow-webhook",
      }).verdict === "allow"
    );
  } catch {
    return false;
  }
}
