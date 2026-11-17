/**
 * The shipped platform tool catalog (ENGINE-03, ADR-081).
 *
 * Names and tiers only. A tool names a connector; the credential lives behind a
 * vault reference the owner configures. Nothing here claims a connector API
 * exists: a tool with no active binding is denied by the broker.
 */
import { parseToolDefinition, TOOL_DEFINITION_SCHEMA, type ToolDefinition } from "./tool-contract";

type Row = readonly [
  id: string,
  title: string,
  connector: string,
  direction: "read" | "write",
  effect: ToolDefinition["effect"],
  tier: ToolDefinition["tier"],
  idempotent: boolean,
  platformOnly: boolean,
  maxCallsPerHour: number,
];

const ROWS: readonly Row[] = [
  ["github.read", "GitHub read", "github", "read", "none", "T0", true, false, 600],
  [
    "github.pr.draft",
    "GitHub draft pull request",
    "github",
    "write",
    "internal_state",
    "T1",
    true,
    false,
    30,
  ],
  ["supabase.read", "Supabase read-only query", "supabase", "read", "none", "T0", true, true, 300],
  ["vercel.read", "Vercel read deployments", "vercel", "read", "none", "T0", true, true, 300],
  [
    "vercel.deploy.request",
    "Vercel production deploy request",
    "vercel",
    "write",
    "prod_config",
    "T3",
    true,
    true,
    5,
  ],
  ["slack.read", "Slack read", "slack", "read", "none", "T0", true, true, 300],
  [
    "slack.post.internal",
    "Slack internal post",
    "slack",
    "write",
    "internal_state",
    "T1",
    true,
    true,
    60,
  ],
  [
    "email.send.customer",
    "Email to a customer",
    "email",
    "write",
    "customer_visible",
    "T2",
    true,
    false,
    100,
  ],
  [
    "whatsapp.send.customer",
    "WhatsApp to a customer",
    "whatsapp",
    "write",
    "customer_visible",
    "T2",
    true,
    false,
    100,
  ],
  [
    "sms.send.customer",
    "SMS to a customer",
    "sms",
    "write",
    "customer_visible",
    "T2",
    true,
    false,
    100,
  ],
  ["crm.note.write", "CRM internal note", "crm", "write", "internal_state", "T1", true, false, 120],
  ["social.read", "Social media read", "social", "read", "none", "T0", true, true, 300],
  [
    "social.post.publish",
    "Social media public post",
    "social",
    "write",
    "public_post",
    "T3",
    true,
    true,
    10,
  ],
  ["payments.refund.issue", "Issue a refund", "payments", "write", "money", "T3", true, true, 10],
  [
    "n8n.workflow.trigger",
    "n8n workflow trigger",
    "n8n",
    "write",
    "internal_state",
    "T1",
    true,
    true,
    60,
  ],
  [
    "owner.alert.send",
    "Alert the sheriff (call, text or WhatsApp with a console link)",
    "owner-alert",
    "write",
    "internal_state",
    "T1",
    true,
    true,
    20,
  ],
  ["iam.access.grant", "Grant access", "iam", "write", "access_grant", "T3", true, true, 5],
  [
    "workflow.action.email",
    "Workflow email action",
    "email",
    "write",
    "customer_visible",
    "T2",
    true,
    false,
    100,
  ],
  [
    "workflow.action.in_app",
    "Workflow in-app action",
    "in_app",
    "write",
    "internal_state",
    "T1",
    true,
    false,
    120,
  ],
  [
    "workflow.action.whatsapp",
    "Workflow WhatsApp action",
    "whatsapp",
    "write",
    "customer_visible",
    "T2",
    true,
    false,
    100,
  ],
  [
    "workflow.action.sms",
    "Workflow SMS action",
    "sms",
    "write",
    "customer_visible",
    "T2",
    true,
    false,
    100,
  ],
  [
    "workflow.action.webhook",
    "Workflow registered webhook action",
    "http-webhook",
    "write",
    "customer_visible",
    "T2",
    true,
    false,
    60,
  ],
];

export const PLATFORM_TOOLS: readonly ToolDefinition[] = Object.freeze(
  ROWS.map(
    ([id, title, connector, direction, effect, tier, idempotent, platformOnly, maxCallsPerHour]) =>
      parseToolDefinition({
        schema: TOOL_DEFINITION_SCHEMA,
        id,
        version: "1.0.0",
        title,
        connector,
        direction,
        effect,
        tier,
        idempotent,
        maxCallsPerHour,
        platformOnly,
      }),
  ),
);

/**
 * T4: never registered, never autonomous, whatever an agent or JARVIS asks.
 * The broker has no tool for these, and the list exists so a request naming one
 * is recognised and refused rather than treated as an unknown tool.
 */
export const FORBIDDEN_ACTIONS: readonly string[] = Object.freeze([
  "github.merge.production",
  "deploy.production.unattended",
  "authority.change.own",
  "audit.log.alter",
  "kill_switch.bypass",
]);

export const isForbiddenAction = (id: string): boolean => FORBIDDEN_ACTIONS.includes(id);

export const toolById = (id: string): ToolDefinition | undefined =>
  PLATFORM_TOOLS.find((t) => t.id === id);
