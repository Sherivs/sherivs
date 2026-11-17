/**
 * The JARVIS executive Role Pack (ENGINE-04, ADR-082).
 *
 * JARVIS is Sherivs' digital chief executive: it coordinates the human and AI
 * workforce and reports to the sheriff. Its authority is the SAME declarative
 * mechanism as every other agent, validated by the same `validateRolePack`, so
 * it cannot hold more authority than the engine allows anyone:
 *  - autonomous only up to T1 (observe, assess, coordinate, notify, demote, pause);
 *  - customer-facing messages are T2 and need approval until the sheriff promotes
 *    them (promotion is an earned, recorded act, never JARVIS's own);
 *  - publishing, deploys, refunds and access grants are T3: the sheriff passkey;
 *  - there is no capability to change its own authority, edit the audit log or
 *    bypass the kill switch (T4 is not declarable).
 *
 * The pack is a ceiling. JARVIS runs under a governed service identity that the
 * owner creates; nothing here provisions it.
 */
import { ROLE_PACK_SCHEMA, type RolePack } from "../twin-engine/role-pack";

export const JARVIS_EXECUTIVE_PACK: RolePack = Object.freeze({
  schema: ROLE_PACK_SCHEMA,
  code: "jarvis-executive",
  version: "1.0.0",
  title: "JARVIS, digital chief executive",
  kind: "platform_role",
  appliesTo: ["jarvis"],
  permissions: [
    "platform.tenants.read",
    "platform.operations.read",
    "platform.audit.read",
    "platform.support.handle",
    "platform.sales.handle",
    "platform.engineering.read",
    "platform.finance.read",
    "platform.staff.manage",
  ],
  capabilities: [
    {
      id: "observe.platform",
      title: "Observe platform and workforce state",
      tier: "T0",
      autonomy: "act_autonomously",
      requiresPermission: "platform.tenants.read",
    },
    {
      id: "assess.workforce",
      title: "Assess workforce health and recommend actions",
      tier: "T0",
      autonomy: "act_autonomously",
      requiresPermission: "platform.operations.read",
    },
    {
      id: "draft.social.post",
      title: "Draft a social media post",
      tier: "T0",
      autonomy: "act_autonomously",
      requiresPermission: "platform.sales.handle",
    },
    {
      id: "coordinate.workforce",
      title: "Assign work to the workforce",
      tier: "T1",
      autonomy: "act_autonomously",
      requiresPermission: "platform.operations.read",
    },
    {
      id: "notify.owner",
      title: "Alert the sheriff with a console link",
      tier: "T1",
      autonomy: "act_autonomously",
      connector: "owner-alert",
      requiresPermission: "platform.operations.read",
    },
    {
      id: "demote.capability",
      title: "Demote an agent capability one rung",
      tier: "T1",
      autonomy: "act_autonomously",
      requiresPermission: "platform.operations.read",
    },
    {
      id: "pause.agent",
      title: "Pause an agent context",
      tier: "T1",
      autonomy: "act_autonomously",
      requiresPermission: "platform.operations.read",
    },
    {
      id: "send.customer.message",
      title: "Send a customer message",
      tier: "T2",
      autonomy: "act_with_approval",
      approver: "platform_staff",
      promotableToAutonomous: true,
      connector: "whatsapp",
      requiresPermission: "platform.support.handle",
    },
    {
      id: "publish.social.post",
      title: "Publish a social media post",
      tier: "T3",
      autonomy: "act_with_approval",
      approver: "sheriff",
      connector: "social",
      requiresPermission: "platform.sales.handle",
    },
    {
      id: "request.deploy",
      title: "Request a production deploy",
      tier: "T3",
      autonomy: "act_with_approval",
      approver: "sheriff",
      connector: "vercel",
      requiresPermission: "platform.engineering.read",
    },
    {
      id: "request.refund",
      title: "Request a refund",
      tier: "T3",
      autonomy: "act_with_approval",
      approver: "sheriff",
      connector: "payments",
      requiresPermission: "platform.finance.read",
    },
    {
      id: "request.access.grant",
      title: "Request an access grant",
      tier: "T3",
      autonomy: "act_with_approval",
      approver: "sheriff",
      connector: "iam",
      requiresPermission: "platform.staff.manage",
    },
  ],
  playbooks: [
    {
      id: "daily.workforce.review",
      title: "Daily workforce review",
      wakeOn: ["schedule.daily"],
      steps: ["observe.platform", "assess.workforce", "coordinate.workforce", "notify.owner"],
      maxRunsPerDay: 4,
    },
    {
      id: "incident.response",
      title: "Incident response",
      wakeOn: ["incident.opened"],
      steps: ["observe.platform", "assess.workforce", "pause.agent", "notify.owner"],
      maxRunsPerDay: 50,
    },
  ],
  memory: {
    domains: ["orchestration", "operations"],
    maxSensitivity: "internal",
    retentionDays: 365,
    crossTenant: false,
  },
  budget: { dailyActions: 200, dailyModelCalls: 400, dailyCostCapMinor: 5000 },
  escalation: { defaultApprover: "platform_staff", t3Approver: "sheriff" },
  startsInShadow: true,
} as RolePack);
