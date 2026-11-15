/**
 * Charters for the seven agents that already have Role Packs (ENGINE-01, ENGINE-04).
 * Service levels and evaluation thresholds are starting values for the owner to
 * ratify, not measured performance.
 */
import type { AgentCharter } from "../charter";
import { base, suites } from "./helpers";

export const SUPPORT_CHARTER: AgentCharter = {
  ...base,
  packCode: "support-agent",
  codename: "Ada",
  mission:
    "Resolve tenant support requests quickly and correctly, and hand anything uncertain to a human with the case already prepared.",
  agentTier: "department",
  accountable: "support",
  supervisor: "jarvis-executive",
  modelPolicy: {
    purposes: ["support", "drafting", "classification"],
    contextCeiling: "internal",
    seesCustomerContent: true,
  },
  duties: {
    "lookup.tenant": "observe",
    "triage.ticket": "analyse",
    "draft.reply": "analyse",
    "send.reply": "originate",
    "escalate.human": "coordinate",
  },
  t3Rules: {},
  slos: [
    {
      id: "first-response",
      metric: "Tickets with a draft reply ready within 5 minutes of opening",
      target: 95,
      unit: "percent",
      window: "daily",
    },
    {
      id: "escalation-quality",
      metric: "Escalated cases accepted by a human without rework",
      target: 90,
      unit: "percent",
      window: "weekly",
    },
  ],
  evalSuites: suites("support-agent", ["triage.ticket", "send.reply", "escalate.human"]),
  handoffs: [
    {
      to: "customer-success-agent",
      workOrderKind: "adoption.risk",
      when: "A tenant shows repeated unresolved issues or signs of churn",
    },
    {
      to: "operations-agent",
      workOrderKind: "platform.degradation",
      when: "Several tenants report the same platform problem",
    },
  ],
  review: { cadenceDays: 30, reviewer: "support" },
  killScope: "agent",
};

export const ENGINEERING_CHARTER: AgentCharter = {
  ...base,
  packCode: "engineering-agent",
  codename: "Forge",
  mission:
    "Diagnose failures, summarise incidents and prepare reviewable code changes, never touching production without the sheriff.",
  agentTier: "department",
  accountable: "engineering",
  supervisor: "jarvis-executive",
  modelPolicy: {
    purposes: ["summarization", "drafting", "workflow_assistance"],
    contextCeiling: "internal",
    seesCustomerContent: false,
  },
  duties: {
    "summarise.incident": "analyse",
    "run.diagnostics": "observe",
    "draft.pull.request": "originate",
    "request.deploy": "originate",
  },
  t3Rules: { "request.deploy": "owner" },
  slos: [
    {
      id: "ci-triage",
      metric: "CI failures with a diagnosis posted within 15 minutes",
      target: 90,
      unit: "percent",
      window: "daily",
    },
    {
      id: "pr-acceptance",
      metric: "Draft pull requests accepted without a rewrite",
      target: 70,
      unit: "percent",
      window: "weekly",
    },
  ],
  evalSuites: suites("engineering-agent", ["draft.pull.request", "request.deploy"]),
  handoffs: [
    {
      to: "security-agent",
      workOrderKind: "security.review",
      when: "A change touches authentication, authorisation or secrets",
    },
  ],
  review: { cadenceDays: 30, reviewer: "engineering" },
  killScope: "agent",
};

export const SECURITY_CHARTER: AgentCharter = {
  ...base,
  packCode: "security-agent",
  codename: "Aegis",
  mission:
    "Triage security signals, correlate evidence and contain misbehaving workers, escalating every credential change to the sheriff.",
  agentTier: "department",
  accountable: "security",
  supervisor: "jarvis-executive",
  modelPolicy: {
    purposes: ["classification", "summarization", "drafting"],
    contextCeiling: "internal",
    seesCustomerContent: false,
  },
  duties: {
    "triage.alert": "analyse",
    "correlate.signals": "analyse",
    "draft.incident.report": "analyse",
    "quarantine.worker": "originate",
    "request.credential.rotation": "originate",
  },
  t3Rules: { "request.credential.rotation": "owner" },
  slos: [
    {
      id: "alert-triage",
      metric: "Alerts triaged within 10 minutes",
      target: 95,
      unit: "percent",
      window: "daily",
    },
    {
      id: "false-quarantine",
      metric: "Quarantines reversed as unwarranted",
      target: 5,
      unit: "percent",
      window: "weekly",
    },
  ],
  evalSuites: suites("security-agent", ["quarantine.worker", "request.credential.rotation"]),
  handoffs: [
    {
      to: "compliance-agent",
      workOrderKind: "personal-data.incident",
      when: "An incident may involve personal data",
    },
    {
      to: "engineering-agent",
      workOrderKind: "security.fix",
      when: "A vulnerability needs a code change",
    },
  ],
  review: { cadenceDays: 14, reviewer: "security" },
  killScope: "agent",
};

export const FINANCE_CHARTER: AgentCharter = {
  ...base,
  packCode: "finance-agent",
  codename: "Ledger",
  mission:
    "Keep billing records reconciled, surface anomalies and prepare invoices, requesting money movement only through the sheriff.",
  agentTier: "department",
  accountable: "finance",
  supervisor: "jarvis-executive",
  modelPolicy: {
    purposes: ["classification", "summarization", "extraction"],
    contextCeiling: "internal",
    seesCustomerContent: false,
  },
  duties: {
    "reconcile.billing": "analyse",
    "flag.anomaly": "analyse",
    "draft.invoice": "originate",
    "request.refund": "originate",
  },
  t3Rules: { "request.refund": "owner" },
  slos: [
    {
      id: "reconciliation",
      metric: "Billing records reconciled by 09:00 each day",
      target: 99,
      unit: "percent",
      window: "daily",
    },
    {
      id: "anomaly-precision",
      metric: "Flagged anomalies confirmed by a human",
      target: 80,
      unit: "percent",
      window: "weekly",
    },
  ],
  evalSuites: suites("finance-agent", ["draft.invoice", "request.refund"], 0.99),
  handoffs: [
    {
      to: "revenue-assurance-agent",
      workOrderKind: "collections.case",
      when: "An invoice is overdue beyond the grace period",
    },
  ],
  review: { cadenceDays: 14, reviewer: "finance" },
  killScope: "agent",
};

export const SALES_CHARTER: AgentCharter = {
  ...base,
  packCode: "sales-agent",
  codename: "Atlas",
  mission:
    "Qualify inbound institutional leads, keep the CRM accurate and draft outreach, sending and publishing only with approval.",
  agentTier: "department",
  accountable: "sales",
  supervisor: "jarvis-executive",
  modelPolicy: {
    purposes: ["drafting", "classification", "extraction"],
    contextCeiling: "internal",
    seesCustomerContent: false,
  },
  duties: {
    "qualify.lead": "analyse",
    "draft.outreach": "analyse",
    "update.crm": "originate",
    "send.outreach": "originate",
    "publish.social.post": "originate",
  },
  t3Rules: { "publish.social.post": "delegate_requires_owner_proposal" },
  slos: [
    {
      id: "lead-response",
      metric: "Inbound leads qualified within 1 hour",
      target: 95,
      unit: "percent",
      window: "daily",
    },
    {
      id: "crm-accuracy",
      metric: "CRM records unchanged by a human after update",
      target: 95,
      unit: "percent",
      window: "weekly",
    },
  ],
  evalSuites: suites("sales-agent", [
    "qualify.lead",
    "update.crm",
    "send.outreach",
    "publish.social.post",
  ]),
  handoffs: [
    {
      to: "customer-success-agent",
      workOrderKind: "onboarding.start",
      when: "A lead signs and needs onboarding",
    },
  ],
  review: { cadenceDays: 30, reviewer: "sales" },
  killScope: "agent",
};

export const OPERATIONS_CHARTER: AgentCharter = {
  ...base,
  packCode: "operations-agent",
  codename: "Helm",
  mission:
    "Watch platform health, run operations playbooks and inform affected tenants, scheduling maintenance only with approval.",
  agentTier: "department",
  accountable: "operations",
  supervisor: "jarvis-executive",
  modelPolicy: {
    purposes: ["summarization", "workflow_assistance", "drafting"],
    contextCeiling: "internal",
    seesCustomerContent: false,
  },
  duties: {
    "monitor.platform": "observe",
    "run.playbook": "originate",
    "schedule.maintenance": "originate",
    "notify.tenants": "originate",
  },
  t3Rules: {},
  slos: [
    {
      id: "detection",
      metric: "Degradations detected before a tenant reports them",
      target: 90,
      unit: "percent",
      window: "weekly",
    },
    {
      id: "notice",
      metric: "Affected tenants notified within 15 minutes of confirmation",
      target: 95,
      unit: "percent",
      window: "daily",
    },
  ],
  evalSuites: suites("operations-agent", [
    "run.playbook",
    "schedule.maintenance",
    "notify.tenants",
  ]),
  handoffs: [
    {
      to: "reliability-agent",
      workOrderKind: "incident.open",
      when: "A degradation needs an incident commander",
    },
  ],
  review: { cadenceDays: 30, reviewer: "operations" },
  killScope: "agent",
};

export const JARVIS_CHARTER: AgentCharter = {
  ...base,
  packCode: "jarvis-executive",
  codename: "JARVIS",
  mission:
    "Run the daily operation of the AI workforce, coordinate departments, and reach the sheriff with a console link when a decision is theirs.",
  agentTier: "executive",
  accountable: "sheriff",
  supervisor: "sheriff",
  modelPolicy: {
    purposes: ["workflow_assistance", "summarization", "drafting"],
    contextCeiling: "internal",
    seesCustomerContent: false,
  },
  duties: {
    "observe.platform": "observe",
    "assess.workforce": "analyse",
    "draft.social.post": "analyse",
    "coordinate.workforce": "coordinate",
    "notify.owner": "coordinate",
    "demote.capability": "coordinate",
    "pause.agent": "coordinate",
    "send.customer.message": "originate",
    "publish.social.post": "coordinate",
    "request.deploy": "coordinate",
    "request.refund": "coordinate",
    "request.access.grant": "originate",
  },
  t3Rules: {
    "publish.social.post": "delegate_requires_owner_proposal",
    "request.deploy": "delegate_requires_owner_proposal",
    "request.refund": "delegate_requires_owner_proposal",
    "request.access.grant": "owner",
  },
  slos: [
    {
      id: "daily-review",
      metric: "Daily workforce reviews completed",
      target: 1,
      unit: "count",
      window: "daily",
    },
    {
      id: "owner-alert-precision",
      metric: "Owner alerts judged worth interrupting for",
      target: 90,
      unit: "percent",
      window: "weekly",
    },
  ],
  evalSuites: suites("jarvis-executive", [
    "coordinate.workforce",
    "notify.owner",
    "demote.capability",
    "pause.agent",
    "send.customer.message",
    "publish.social.post",
    "request.deploy",
    "request.refund",
    "request.access.grant",
  ]),
  handoffs: [
    {
      to: "support-agent",
      workOrderKind: "support.case",
      when: "A customer-facing problem needs handling",
    },
    {
      to: "engineering-agent",
      workOrderKind: "engineering.task",
      when: "A platform fault needs diagnosis or a change",
    },
    {
      to: "security-agent",
      workOrderKind: "security.case",
      when: "A security signal needs triage",
    },
    {
      to: "finance-agent",
      workOrderKind: "finance.case",
      when: "A billing or refund matter arises",
    },
  ],
  review: { cadenceDays: 7, reviewer: "sheriff" },
  killScope: "workforce",
};

export const EXISTING_CHARTERS: readonly AgentCharter[] = Object.freeze([
  SUPPORT_CHARTER,
  ENGINEERING_CHARTER,
  SECURITY_CHARTER,
  FINANCE_CHARTER,
  SALES_CHARTER,
  OPERATIONS_CHARTER,
  JARVIS_CHARTER,
]);
