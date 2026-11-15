/**
 * Sherivs internal AI workforce — platform Role Packs (ENGINE-01, ADR-079).
 *
 * One department agent per internal platform role. Each platform staff member
 * gets a twin context on their ONE person twin; the department pack defines how
 * that agent works: what it watches (wake events), what it may do alone, what it
 * must route for approval and to whom, and what it can never touch.
 *
 * Operating model for every department agent:
 *  1. Wake on an event or a schedule; do the playbook; go back to sleep.
 *  2. Observe and draft freely (T0). Make reversible internal changes (T1).
 *  3. Anything customer-visible, financial or production-affecting is routed
 *     (T2 to platform staff, T3 to the sheriff with passkey step-up).
 *  4. Hand off through work orders; write a shift report every run.
 *  5. Every capability starts in shadow and earns autonomy from evals.
 *
 * Permission ids are the capability strings seeded for the matching platform
 * role in the platform-staff migration (a test cross-checks them).
 */
import { ROLE_PACK_SCHEMA, type RolePack } from "../role-pack";

const memory = (
  domains: readonly string[],
  maxSensitivity: "internal" | "restricted" = "internal",
) => ({ domains: [...domains], maxSensitivity, retentionDays: 365, crossTenant: false as const });

const escalation = { defaultApprover: "platform_staff", t3Approver: "sheriff" } as const;

export const PLATFORM_WORKFORCE_PACKS: readonly RolePack[] = Object.freeze([
  {
    schema: ROLE_PACK_SCHEMA,
    code: "support-agent",
    version: "1.0.0",
    title: "Customer support agent",
    kind: "platform_role",
    appliesTo: ["support"],
    permissions: ["platform.tenants.read", "platform.support.handle"],
    capabilities: [
      {
        id: "lookup.tenant",
        title: "Look up a tenant's state",
        tier: "T0",
        autonomy: "act_autonomously",
        requiresPermission: "platform.tenants.read",
      },
      {
        id: "triage.ticket",
        title: "Classify and prioritise a ticket",
        tier: "T1",
        autonomy: "act_autonomously",
        requiresPermission: "platform.support.handle",
      },
      {
        id: "draft.reply",
        title: "Draft a customer reply",
        tier: "T0",
        autonomy: "act_autonomously",
        requiresPermission: "platform.support.handle",
      },
      {
        id: "send.reply",
        title: "Send a customer reply",
        tier: "T2",
        autonomy: "act_with_approval",
        approver: "platform_staff",
        promotableToAutonomous: true,
        connector: "whatsapp",
        requiresPermission: "platform.support.handle",
      },
      {
        id: "escalate.human",
        title: "Hand a case to a human",
        tier: "T1",
        autonomy: "act_autonomously",
        requiresPermission: "platform.support.handle",
      },
    ],
    playbooks: [
      {
        id: "ticket.opened",
        title: "New ticket",
        wakeOn: ["ticket.opened"],
        steps: ["lookup.tenant", "triage.ticket", "draft.reply", "send.reply"],
        maxRunsPerDay: 500,
      },
      {
        id: "ticket.stale",
        title: "Stale ticket sweep",
        wakeOn: ["schedule.hourly"],
        steps: ["triage.ticket", "escalate.human"],
        maxRunsPerDay: 24,
      },
    ],
    memory: memory(["support-case", "tenant-profile"]),
    budget: { dailyActions: 800, dailyModelCalls: 400, dailyCostCapMinor: 3000 },
    escalation,
    startsInShadow: true,
  },
  {
    schema: ROLE_PACK_SCHEMA,
    code: "engineering-agent",
    version: "1.0.0",
    title: "Engineering agent",
    kind: "platform_role",
    appliesTo: ["engineering"],
    permissions: ["platform.engineering.read", "platform.config.read"],
    capabilities: [
      {
        id: "summarise.incident",
        title: "Summarise an incident",
        tier: "T0",
        autonomy: "act_autonomously",
        requiresPermission: "platform.engineering.read",
      },
      {
        id: "run.diagnostics",
        title: "Run read-only diagnostics",
        tier: "T0",
        autonomy: "act_autonomously",
        requiresPermission: "platform.engineering.read",
      },
      {
        id: "draft.pull.request",
        title: "Open a draft pull request",
        tier: "T1",
        autonomy: "act_with_approval",
        approver: "platform_staff",
        connector: "github",
        requiresPermission: "platform.engineering.read",
      },
      {
        id: "request.deploy",
        title: "Request a production deploy",
        tier: "T3",
        autonomy: "act_with_approval",
        approver: "sheriff",
        connector: "github",
        requiresPermission: "platform.config.read",
      },
    ],
    playbooks: [
      {
        id: "incident.opened",
        title: "Incident opened",
        wakeOn: ["incident.opened"],
        steps: ["run.diagnostics", "summarise.incident"],
        maxRunsPerDay: 50,
      },
      {
        id: "ci.failed",
        title: "CI failed",
        wakeOn: ["ci.failed"],
        steps: ["run.diagnostics", "draft.pull.request"],
        maxRunsPerDay: 50,
      },
    ],
    memory: memory(["engineering-notes", "incident-history"]),
    budget: { dailyActions: 300, dailyModelCalls: 200, dailyCostCapMinor: 4000 },
    escalation,
    startsInShadow: true,
  },
  {
    schema: ROLE_PACK_SCHEMA,
    code: "security-agent",
    version: "1.0.0",
    title: "Security agent",
    kind: "platform_role",
    appliesTo: ["security"],
    permissions: ["platform.security.read", "platform.audit.read"],
    capabilities: [
      {
        id: "triage.alert",
        title: "Triage a security alert",
        tier: "T0",
        autonomy: "act_autonomously",
        requiresPermission: "platform.security.read",
      },
      {
        id: "correlate.signals",
        title: "Correlate audit signals",
        tier: "T0",
        autonomy: "act_autonomously",
        requiresPermission: "platform.audit.read",
      },
      {
        id: "draft.incident.report",
        title: "Draft an incident report",
        tier: "T0",
        autonomy: "act_autonomously",
        requiresPermission: "platform.security.read",
      },
      {
        id: "quarantine.worker",
        title: "Quarantine a misbehaving worker",
        tier: "T2",
        autonomy: "act_with_approval",
        approver: "platform_staff",
        requiresPermission: "platform.security.read",
      },
      {
        id: "request.credential.rotation",
        title: "Request a credential rotation",
        tier: "T3",
        autonomy: "act_with_approval",
        approver: "sheriff",
        requiresPermission: "platform.security.read",
      },
    ],
    playbooks: [
      {
        id: "alert.raised",
        title: "Alert raised",
        wakeOn: ["alert.raised"],
        steps: ["triage.alert", "correlate.signals", "draft.incident.report"],
        maxRunsPerDay: 200,
      },
      {
        id: "worker.anomaly",
        title: "Worker anomaly",
        wakeOn: ["worker.anomaly"],
        steps: ["correlate.signals", "quarantine.worker"],
        maxRunsPerDay: 50,
      },
    ],
    memory: memory(["security-case"], "restricted"),
    budget: { dailyActions: 400, dailyModelCalls: 150, dailyCostCapMinor: 2500 },
    escalation,
    startsInShadow: true,
  },
  {
    schema: ROLE_PACK_SCHEMA,
    code: "finance-agent",
    version: "1.0.0",
    title: "Finance operations agent",
    kind: "platform_role",
    appliesTo: ["finance"],
    permissions: ["platform.finance.read"],
    capabilities: [
      {
        id: "reconcile.billing",
        title: "Reconcile billing records",
        tier: "T0",
        autonomy: "act_autonomously",
        requiresPermission: "platform.finance.read",
      },
      {
        id: "flag.anomaly",
        title: "Flag a billing anomaly",
        tier: "T0",
        autonomy: "act_autonomously",
        requiresPermission: "platform.finance.read",
      },
      {
        id: "draft.invoice",
        title: "Draft an invoice",
        tier: "T1",
        autonomy: "act_with_approval",
        approver: "platform_staff",
        requiresPermission: "platform.finance.read",
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
    ],
    playbooks: [
      {
        id: "daily.reconcile",
        title: "Daily reconciliation",
        wakeOn: ["schedule.daily"],
        steps: ["reconcile.billing", "flag.anomaly"],
        maxRunsPerDay: 2,
      },
      {
        id: "refund.asked",
        title: "Refund asked",
        wakeOn: ["refund.requested"],
        steps: ["flag.anomaly", "request.refund"],
        maxRunsPerDay: 100,
      },
    ],
    memory: memory(["billing-summary"], "restricted"),
    budget: { dailyActions: 200, dailyModelCalls: 60, dailyCostCapMinor: 1500 },
    escalation,
    startsInShadow: true,
  },
  {
    schema: ROLE_PACK_SCHEMA,
    code: "sales-agent",
    version: "1.0.0",
    title: "Sales agent",
    kind: "platform_role",
    appliesTo: ["sales"],
    permissions: ["platform.tenants.read", "platform.sales.handle"],
    capabilities: [
      {
        id: "qualify.lead",
        title: "Qualify an inbound lead",
        tier: "T1",
        autonomy: "act_autonomously",
        requiresPermission: "platform.sales.handle",
      },
      {
        id: "draft.outreach",
        title: "Draft outreach",
        tier: "T0",
        autonomy: "act_autonomously",
        requiresPermission: "platform.sales.handle",
      },
      {
        id: "update.crm",
        title: "Update the CRM record",
        tier: "T1",
        autonomy: "act_autonomously",
        connector: "crm",
        requiresPermission: "platform.sales.handle",
      },
      {
        id: "send.outreach",
        title: "Send outreach",
        tier: "T2",
        autonomy: "act_with_approval",
        approver: "platform_staff",
        promotableToAutonomous: true,
        connector: "email",
        requiresPermission: "platform.sales.handle",
      },
      {
        id: "publish.social.post",
        title: "Publish a social post",
        tier: "T3",
        autonomy: "act_with_approval",
        approver: "sheriff",
        connector: "social",
        requiresPermission: "platform.sales.handle",
      },
    ],
    playbooks: [
      {
        id: "lead.arrived",
        title: "Lead arrived",
        wakeOn: ["lead.created"],
        steps: ["qualify.lead", "update.crm", "draft.outreach", "send.outreach"],
        maxRunsPerDay: 300,
      },
    ],
    memory: memory(["pipeline", "tenant-profile"]),
    budget: { dailyActions: 300, dailyModelCalls: 150, dailyCostCapMinor: 2000 },
    escalation,
    startsInShadow: true,
  },
  {
    schema: ROLE_PACK_SCHEMA,
    code: "operations-agent",
    version: "1.0.0",
    title: "Platform operations agent",
    kind: "platform_role",
    appliesTo: ["operations"],
    permissions: ["platform.operations.read", "platform.config.read"],
    capabilities: [
      {
        id: "monitor.platform",
        title: "Monitor platform health",
        tier: "T0",
        autonomy: "act_autonomously",
        requiresPermission: "platform.operations.read",
      },
      {
        id: "run.playbook",
        title: "Run an operations playbook",
        tier: "T1",
        autonomy: "act_autonomously",
        requiresPermission: "platform.operations.read",
      },
      {
        id: "schedule.maintenance",
        title: "Schedule maintenance",
        tier: "T2",
        autonomy: "act_with_approval",
        approver: "platform_staff",
        requiresPermission: "platform.config.read",
      },
      {
        id: "notify.tenants",
        title: "Notify affected tenants",
        tier: "T2",
        autonomy: "act_with_approval",
        approver: "platform_staff",
        connector: "whatsapp",
        requiresPermission: "platform.operations.read",
      },
    ],
    playbooks: [
      {
        id: "health.degraded",
        title: "Health degraded",
        wakeOn: ["health.degraded"],
        steps: ["monitor.platform", "run.playbook", "notify.tenants"],
        maxRunsPerDay: 100,
      },
      {
        id: "hourly.watch",
        title: "Hourly watch",
        wakeOn: ["schedule.hourly"],
        steps: ["monitor.platform"],
        maxRunsPerDay: 24,
      },
    ],
    memory: memory(["operations-log"]),
    budget: { dailyActions: 500, dailyModelCalls: 120, dailyCostCapMinor: 2000 },
    escalation,
    startsInShadow: true,
  },
] satisfies readonly RolePack[]);
