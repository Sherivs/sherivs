/**
 * Charters for the eight additional agents (ENGINE-11, ADR-089).
 * Service levels and evaluation bars are starting values for the owner to ratify.
 */
import type { AgentCharter } from "../charter";
import { base, suites } from "./helpers";

export const COMPLIANCE_CHARTER: AgentCharter = {
  ...base,
  packCode: "compliance-agent",
  codename: "Themis",
  mission:
    "Keep the platform inside its data-protection duties by assessing requests, watching retention and preparing notices for human and counsel review.",
  agentTier: "department",
  accountable: "compliance",
  supervisor: "jarvis-executive",
  modelPolicy: {
    purposes: ["classification", "drafting", "summarization"],
    contextCeiling: "restricted",
    seesCustomerContent: true,
  },
  duties: {
    "scan.retention": "observe",
    "assess.data.request": "analyse",
    "draft.breach.assessment": "analyse",
    "send.data.notice": "originate",
    "escalate.counsel": "coordinate",
  },
  t3Rules: {},
  slos: [
    {
      id: "request-triage",
      metric: "Data requests assessed within 24 hours of receipt",
      target: 95,
      unit: "percent",
      window: "daily",
    },
    {
      id: "retention-clean",
      metric: "Retention sweeps completed each day",
      target: 1,
      unit: "count",
      window: "daily",
    },
  ],
  handoffs: [
    {
      to: "security-agent",
      workOrderKind: "personal-data.incident",
      when: "An assessment finds a possible personal-data breach",
    },
  ],
  review: {
    cadenceDays: 14,
    reviewer: "compliance",
  },
  killScope: "agent",
  evalSuites: suites("compliance-agent", [
    "assess.data.request",
    "send.data.notice",
    "escalate.counsel",
  ]),
};

export const RELIABILITY_CHARTER: AgentCharter = {
  ...base,
  packCode: "reliability-agent",
  codename: "Pulse",
  mission:
    "Detect incidents early, coordinate response with a clear record, and keep affected tenants informed through approved updates.",
  agentTier: "department",
  accountable: "operations",
  supervisor: "jarvis-executive",
  modelPolicy: {
    purposes: ["summarization", "drafting", "workflow_assistance"],
    contextCeiling: "internal",
    seesCustomerContent: false,
  },
  duties: {
    "detect.incident": "observe",
    "open.incident": "coordinate",
    "run.runbook": "coordinate",
    "draft.postmortem": "analyse",
    "publish.status.update": "originate",
  },
  t3Rules: {},
  slos: [
    {
      id: "detect-before-report",
      metric: "Incidents detected before a tenant reports them",
      target: 90,
      unit: "percent",
      window: "weekly",
    },
    {
      id: "postmortem",
      metric: "Postmortem drafts ready within 48 hours of resolution",
      target: 95,
      unit: "percent",
      window: "weekly",
    },
  ],
  handoffs: [
    {
      to: "engineering-agent",
      workOrderKind: "incident.fix",
      when: "An incident needs a code change or rollback",
    },
    {
      to: "archivist-agent",
      workOrderKind: "incident.postmortem",
      when: "A postmortem is ready for the knowledge base",
    },
  ],
  review: {
    cadenceDays: 30,
    reviewer: "operations",
  },
  killScope: "agent",
  evalSuites: suites("reliability-agent", [
    "open.incident",
    "run.runbook",
    "publish.status.update",
  ]),
};

export const CUSTOMER_SUCCESS_CHARTER: AgentCharter = {
  ...base,
  packCode: "customer-success-agent",
  codename: "Nia",
  mission:
    "Help every tenant succeed by spotting adoption risk early, planning onboarding and keeping contact warm and relevant.",
  agentTier: "department",
  accountable: "sales",
  supervisor: "jarvis-executive",
  modelPolicy: {
    purposes: ["classification", "drafting", "summarization"],
    contextCeiling: "internal",
    seesCustomerContent: true,
  },
  duties: {
    "score.health": "observe",
    "flag.churn.risk": "analyse",
    "plan.onboarding": "coordinate",
    "draft.checkin": "analyse",
    "send.checkin": "originate",
  },
  t3Rules: {},
  slos: [
    {
      id: "health-scored",
      metric: "Active tenants health-scored each week",
      target: 95,
      unit: "percent",
      window: "weekly",
    },
    {
      id: "risk-precision",
      metric: "Churn flags confirmed by a human",
      target: 70,
      unit: "percent",
      window: "weekly",
    },
  ],
  handoffs: [
    {
      to: "support-agent",
      workOrderKind: "support.case",
      when: "A tenant raises a problem during onboarding",
    },
  ],
  review: {
    cadenceDays: 30,
    reviewer: "sales",
  },
  killScope: "agent",
  evalSuites: suites("customer-success-agent", [
    "flag.churn.risk",
    "plan.onboarding",
    "send.checkin",
  ]),
};

export const REVENUE_ASSURANCE_CHARTER: AgentCharter = {
  ...base,
  packCode: "revenue-assurance-agent",
  codename: "Mint",
  mission:
    "Protect revenue and margin by finding cost and usage anomalies and following up overdue invoices, with every send approved.",
  agentTier: "department",
  accountable: "finance",
  supervisor: "jarvis-executive",
  modelPolicy: {
    purposes: ["classification", "extraction", "drafting"],
    contextCeiling: "internal",
    seesCustomerContent: false,
  },
  duties: {
    "detect.usage.anomaly": "observe",
    "forecast.cost": "analyse",
    "track.collections": "analyse",
    "draft.dunning.notice": "analyse",
    "send.payment.reminder": "originate",
  },
  t3Rules: {},
  slos: [
    {
      id: "anomaly-precision",
      metric: "Flagged anomalies confirmed by a human",
      target: 80,
      unit: "percent",
      window: "weekly",
    },
    {
      id: "collections-tracked",
      metric: "Overdue invoices tracked within a day",
      target: 99,
      unit: "percent",
      window: "daily",
    },
  ],
  handoffs: [
    {
      to: "finance-agent",
      workOrderKind: "finance.case",
      when: "A refund or billing correction is needed",
    },
  ],
  review: {
    cadenceDays: 14,
    reviewer: "finance",
  },
  killScope: "agent",
  evalSuites: suites("revenue-assurance-agent", ["track.collections", "send.payment.reminder"]),
};

export const SENTINEL_CHARTER: AgentCharter = {
  ...base,
  packCode: "sentinel-agent",
  codename: "Sentinel",
  mission:
    "Independently check ledgers, approvals and agent behaviour against charters, and report findings to the sheriff without acting on them.",
  agentTier: "assurance",
  accountable: "sheriff",
  supervisor: "sheriff",
  modelPolicy: {
    purposes: ["summarization", "classification"],
    contextCeiling: "internal",
    seesCustomerContent: false,
  },
  duties: {
    "review.ledger": "verify",
    "review.approvals": "verify",
    "review.agent.behaviour": "verify",
    "file.finding": "coordinate",
    "escalate.sheriff": "coordinate",
  },
  t3Rules: {},
  slos: [
    {
      id: "audit-daily",
      metric: "Daily audits completed",
      target: 1,
      unit: "count",
      window: "daily",
    },
    {
      id: "finding-precision",
      metric: "Findings accepted as valid by the sheriff",
      target: 85,
      unit: "percent",
      window: "weekly",
    },
  ],
  handoffs: [],
  review: {
    cadenceDays: 14,
    reviewer: "sheriff",
  },
  killScope: "agent",
  evalSuites: suites("sentinel-agent", [
    "review.agent.behaviour",
    "file.finding",
    "escalate.sheriff",
  ]),
};

export const ARCHIVIST_CHARTER: AgentCharter = {
  ...base,
  packCode: "archivist-agent",
  codename: "Sage",
  mission:
    "Make institutional knowledge findable and trustworthy by answering with sources and keeping runbooks current.",
  agentTier: "department",
  accountable: "engineering",
  supervisor: "jarvis-executive",
  modelPolicy: {
    purposes: ["summarization", "drafting", "extraction"],
    contextCeiling: "internal",
    seesCustomerContent: false,
  },
  duties: {
    "search.knowledge": "observe",
    "answer.with.sources": "analyse",
    "draft.runbook": "analyse",
    "update.knowledge.entry": "originate",
  },
  t3Rules: {},
  slos: [
    {
      id: "sourced-answers",
      metric: "Answers that cite a source",
      target: 98,
      unit: "percent",
      window: "weekly",
    },
    {
      id: "runbook-freshness",
      metric: "Runbooks reviewed within 90 days",
      target: 90,
      unit: "percent",
      window: "weekly",
    },
  ],
  handoffs: [],
  review: {
    cadenceDays: 30,
    reviewer: "engineering",
  },
  killScope: "agent",
  evalSuites: suites("archivist-agent", ["update.knowledge.entry"]),
};

export const PRODUCT_INTELLIGENCE_CHARTER: AgentCharter = {
  ...base,
  packCode: "product-intelligence-agent",
  codename: "Compass",
  mission:
    "Turn tenant feedback and usage into clear product insight for the founder to decide on.",
  agentTier: "department",
  accountable: "platform_admin",
  supervisor: "jarvis-executive",
  modelPolicy: {
    purposes: ["summarization", "classification", "drafting"],
    contextCeiling: "internal",
    seesCustomerContent: false,
  },
  duties: {
    "synthesise.feedback": "analyse",
    "analyse.usage": "analyse",
    "draft.product.brief": "analyse",
    "file.product.insight": "originate",
  },
  t3Rules: {},
  slos: [
    {
      id: "weekly-brief",
      metric: "Weekly product briefs delivered",
      target: 1,
      unit: "count",
      window: "weekly",
    },
    {
      id: "insight-use",
      metric: "Filed insights opened by a human",
      target: 60,
      unit: "percent",
      window: "weekly",
    },
  ],
  handoffs: [],
  review: {
    cadenceDays: 30,
    reviewer: "platform_admin",
  },
  killScope: "agent",
  evalSuites: suites("product-intelligence-agent", ["file.product.insight"]),
};

export const MARKET_INTELLIGENCE_CHARTER: AgentCharter = {
  ...base,
  packCode: "market-intelligence-agent",
  codename: "Scout",
  mission:
    "Watch competitors and education policy across the markets Sherivs serves and brief the founder on what changed and why it matters.",
  agentTier: "department",
  accountable: "platform_admin",
  supervisor: "jarvis-executive",
  modelPolicy: {
    purposes: ["summarization", "drafting", "extraction"],
    contextCeiling: "internal",
    seesCustomerContent: false,
  },
  duties: {
    "watch.competitors": "observe",
    "watch.policy": "observe",
    "draft.market.brief": "analyse",
    "file.market.insight": "originate",
  },
  t3Rules: {},
  slos: [
    {
      id: "weekly-brief",
      metric: "Weekly market briefs delivered",
      target: 1,
      unit: "count",
      window: "weekly",
    },
    {
      id: "source-quality",
      metric: "Claims in briefs backed by a cited source",
      target: 98,
      unit: "percent",
      window: "weekly",
    },
  ],
  handoffs: [],
  review: {
    cadenceDays: 30,
    reviewer: "platform_admin",
  },
  killScope: "agent",
  evalSuites: suites("market-intelligence-agent", ["file.market.insight"]),
};

export const EXPANSION_CHARTERS: readonly AgentCharter[] = Object.freeze([
  COMPLIANCE_CHARTER,
  RELIABILITY_CHARTER,
  CUSTOMER_SUCCESS_CHARTER,
  REVENUE_ASSURANCE_CHARTER,
  SENTINEL_CHARTER,
  ARCHIVIST_CHARTER,
  PRODUCT_INTELLIGENCE_CHARTER,
  MARKET_INTELLIGENCE_CHARTER,
]);
